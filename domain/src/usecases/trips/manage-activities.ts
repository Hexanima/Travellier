import { createActivity, type Activity } from "../../entities/activity.js";
import { createActivityParticipation, type ActivityParticipation } from "../../entities/activity-participation.js";
import { findAgendaConflicts, type ActivityConflict } from "../../entities/activity-conflict.js";
import { ActivityNotFoundError } from "../../errors/activity-not-found-error.js";
import { TripNotFoundError } from "../../errors/trip-not-found-error.js";
import { ValidationError } from "../../errors/validation-error.js";
import type { TripActivityPort, TripActivityReadScope } from "../../ports/trip-activity-port.js";
import type { TaggedError } from "../../types/error.js";
import { err, ok, type AsyncResult } from "../../types/result.js";
import type { UseCase } from "../../types/usecase.js";
import type { ObjectId } from "../../value-objects/object-id.js";
import { parseConfirmed, parseConfirmedActivity, sameSnapshot } from "./agenda-confirmation.js";

export interface TripActivityPayload { tripId: ObjectId; authenticatedUserId: ObjectId }
export interface ActivityDetailPayload extends TripActivityPayload { activityId: ObjectId }
export type ActivityEditableFields = Pick<Activity, "dayId" | "title" | "scheduledAt" | "durationMinutes" | "description" | "mapsUrl">;
export type CreateTripActivityPayload = TripActivityPayload &
  Omit<ActivityEditableFields, "description" | "mapsUrl" | "durationMinutes"> & {
  description?: string | null; mapsUrl?: string | null; durationMinutes?: number | null;
  /** Conflicts the author saw when confirming the plan change. */ confirmedConflicts?: unknown;
  /** Schedule of the new activity the author saw when confirming. */ confirmedActivity?: unknown;
};
/** Created (with the author's going) or an explicit plan-change confirmation is needed (nothing written). */
export type CreateTripActivityResult =
  | { outcome: "created"; activity: Activity; participation: ActivityParticipation }
  | { outcome: "confirmation_required"; conflicts: ActivityConflict[]; activity: { scheduledAt: Date; durationMinutes: number | null } };
export type UpdateTripActivityPayload = ActivityDetailPayload & Partial<ActivityEditableFields>;
interface Dependencies { activities: TripActivityPort }
interface CreationDependencies extends Dependencies { createId: () => ObjectId; now: () => Date }

const authorize = async (scope: TripActivityReadScope, payload: TripActivityPayload) => {
  const member = await scope.findMemberRole(payload.authenticatedUserId);
  if (!member.ok) return member;
  if (member.value !== "admin" && member.value !== "participant") return err(new TripNotFoundError());
  const trip = await scope.findTrip();
  if (!trip.ok) return trip;
  return trip.value?.id === payload.tripId ? ok(trip.value) : err(new TripNotFoundError());
};
const find = async (scope: TripActivityReadScope, payload: ActivityDetailPayload): AsyncResult<Activity> => {
  const activity = await scope.find(payload.activityId);
  if (!activity.ok) return activity;
  return activity.value?.id === payload.activityId && activity.value.tripId === payload.tripId
    ? ok(activity.value) : err(new ActivityNotFoundError());
};

export const createTripActivity: UseCase<CreationDependencies, CreateTripActivityPayload, CreateTripActivityResult, TaggedError> = {
  execute: ({ activities, createId, now }, payload) => activities.withTransaction<CreateTripActivityResult>(payload.tripId, async (scope) => {
    const trip = await authorize(scope, payload);
    if (!trip.ok) return trip;
    const days = await scope.listDays();
    if (!days.ok) return days;
    const createdAt = now();
    const activity = createActivity({ id: createId(), tripId: payload.tripId, createdBy: payload.authenticatedUserId,
      createdAt, dayId: payload.dayId, title: payload.title, scheduledAt: payload.scheduledAt,
      durationMinutes: payload.durationMinutes, description: payload.description, mapsUrl: payload.mapsUrl }, { trip: trip.value, days: days.value });
    if (!activity.ok) return activity;
    const confirmed = parseConfirmed(payload.confirmedConflicts);
    if (!confirmed.ok) return confirmed;
    const confirmedActivity = parseConfirmedActivity(payload.confirmedActivity);
    if (confirmedActivity === "invalid") {
      return err(new ValidationError([{ field: "confirmedActivity", code: "invalid", message: "Confirmed activity must include scheduledAt and durationMinutes." }]));
    }
    const userId = payload.authenticatedUserId;
    const existing = await scope.list();
    if (!existing.ok) return existing;
    const records = await scope.listUserParticipations(userId);
    if (!records.ok) return records;
    const conflicts = findAgendaConflicts({ candidate: activity.value, userId, tripId: payload.tripId,
      activities: existing.value, participations: records.value });
    if (conflicts.length > 0) {
      // The confirmation must match the conflict set and the schedule as they are right now; nothing is inserted before it.
      const schedule = { scheduledAt: activity.value.scheduledAt.getTime(), durationMinutes: activity.value.durationMinutes ?? null };
      if (confirmed.value === undefined || confirmedActivity === undefined || !sameSnapshot(confirmed.value, conflicts) ||
        confirmedActivity.scheduledAt !== schedule.scheduledAt || confirmedActivity.durationMinutes !== schedule.durationMinutes) {
        return ok({ outcome: "confirmation_required" as const, conflicts,
          activity: { scheduledAt: activity.value.scheduledAt, durationMinutes: activity.value.durationMinutes ?? null } });
      }
    }
    const inserted = await scope.insert(activity.value);
    if (!inserted.ok) return inserted;
    for (const conflict of conflicts) {
      const previous = records.value.find((r) => r.activityId === conflict.activityId);
      const declined = createActivityParticipation({ id: previous?.id ?? createId(), tripId: payload.tripId,
        activityId: conflict.activityId, userId, status: "not_going", updatedAt: createdAt });
      if (!declined.ok) return declined;
      const saved = await scope.saveParticipation(declined.value);
      if (!saved.ok) return saved;
    }
    const own = createActivityParticipation({ id: createId(), tripId: payload.tripId, activityId: activity.value.id,
      userId, status: "going", updatedAt: createdAt });
    if (!own.ok) return own;
    const saved = await scope.saveParticipation(own.value);
    return saved.ok ? ok({ outcome: "created" as const, activity: activity.value, participation: saved.value }) : saved;
  }),
};

export const listTripActivities: UseCase<Dependencies, TripActivityPayload, Activity[], TaggedError> = {
  execute: ({ activities }, payload) => activities.withReadSnapshot(payload.tripId, async (scope) => {
    const trip = await authorize(scope, payload);
    if (!trip.ok) return trip;
    const result = await scope.list();
    return result.ok ? ok(result.value.filter((a) => a.tripId === payload.tripId)
      .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime() || a.id.localeCompare(b.id))) : result;
  }),
};

export const getTripActivity: UseCase<Dependencies, ActivityDetailPayload, Activity, TaggedError> = {
  execute: ({ activities }, payload) => activities.withReadSnapshot(payload.tripId, async (scope) => {
    const trip = await authorize(scope, payload);
    return trip.ok ? find(scope, payload) : trip;
  }),
};

export const updateTripActivity: UseCase<Dependencies, UpdateTripActivityPayload, Activity, TaggedError> = {
  execute: ({ activities }, payload) => activities.withTransaction(payload.tripId, async (scope) => {
    const trip = await authorize(scope, payload);
    if (!trip.ok) return trip;
    const current = await find(scope, payload);
    if (!current.ok) return current;
    const fields = ["dayId", "title", "scheduledAt", "durationMinutes", "description", "mapsUrl"] as const;
    if (!fields.some((field) => Object.hasOwn(payload, field))) {
      return err(new ValidationError([{ field: "activity", code: "required", message: "An editable field is required." }]));
    }
    const days = await scope.listDays();
    if (!days.ok) return days;
    // Validate the merged entity against the current itinerary.
    const validated = createActivity({ ...current.value,
      ...Object.fromEntries(fields.filter((field) => Object.hasOwn(payload, field)).map((field) => [field, payload[field]])),
    }, { trip: trip.value, days: days.value });
    if (!validated.ok) return validated;
    const activity = validated.value;
    const saved = await scope.replace(activity);
    return saved.ok ? ok(activity) : saved;
  }),
};

export const deleteTripActivity: UseCase<Dependencies, ActivityDetailPayload, void, TaggedError> = {
  execute: ({ activities }, payload) => activities.withTransaction(payload.tripId, async (scope) => {
    const trip = await authorize(scope, payload);
    if (!trip.ok) return trip;
    const current = await find(scope, payload);
    return current.ok ? scope.remove(payload.activityId) : current;
  }),
};
