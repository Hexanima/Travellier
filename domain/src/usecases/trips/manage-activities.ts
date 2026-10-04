import { createActivity, type Activity } from "../../entities/activity.js";
import { ActivityNotFoundError } from "../../errors/activity-not-found-error.js";
import { TripNotFoundError } from "../../errors/trip-not-found-error.js";
import { ValidationError } from "../../errors/validation-error.js";
import type { TripActivityPort, TripActivityReadScope } from "../../ports/trip-activity-port.js";
import type { TaggedError } from "../../types/error.js";
import { err, ok, type AsyncResult } from "../../types/result.js";
import type { UseCase } from "../../types/usecase.js";
import type { ObjectId } from "../../value-objects/object-id.js";

export interface TripActivityPayload { tripId: ObjectId; authenticatedUserId: ObjectId }
export interface ActivityDetailPayload extends TripActivityPayload { activityId: ObjectId }
export type ActivityEditableFields = Pick<Activity, "dayId" | "title" | "scheduledAt" | "description" | "mapsUrl">;
export type CreateTripActivityPayload = TripActivityPayload & Omit<ActivityEditableFields, "description" | "mapsUrl"> & {
  description?: string | null; mapsUrl?: string | null;
};
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

export const createTripActivity: UseCase<CreationDependencies, CreateTripActivityPayload, Activity, TaggedError> = {
  execute: ({ activities, createId, now }, payload) => activities.withTransaction(payload.tripId, async (scope) => {
    const trip = await authorize(scope, payload);
    if (!trip.ok) return trip;
    const days = await scope.listDays();
    if (!days.ok) return days;
    const activity = createActivity({ id: createId(), tripId: payload.tripId, createdBy: payload.authenticatedUserId,
      createdAt: now(), dayId: payload.dayId, title: payload.title, scheduledAt: payload.scheduledAt,
      description: payload.description, mapsUrl: payload.mapsUrl }, { trip: trip.value, days: days.value });
    if (!activity.ok) return activity;
    const saved = await scope.insert(activity.value);
    return saved.ok ? activity : saved;
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
    const fields = ["dayId", "title", "scheduledAt", "description", "mapsUrl"] as const;
    if (!fields.some((field) => Object.hasOwn(payload, field))) {
      return err(new ValidationError([{ field: "activity", code: "required", message: "An editable field is required." }]));
    }
    const days = await scope.listDays();
    if (!days.ok) return days;
    // Validate the merged entity through T35; editing does not transition its status.
    const validated = createActivity({ ...current.value,
      ...Object.fromEntries(fields.filter((field) => Object.hasOwn(payload, field)).map((field) => [field, payload[field]])),
    }, { trip: trip.value, days: days.value });
    if (!validated.ok) return validated;
    const activity = { ...validated.value, status: current.value.status };
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
