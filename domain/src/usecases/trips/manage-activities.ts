import { createActivity, type Activity } from "../../entities/activity.js";
import { createActivityParticipation, type ActivityParticipation, type ParticipationDecisionRequired } from "../../entities/activity-participation.js";
import { findAgendaConflicts, type ActivityConflict } from "../../entities/activity-conflict.js";
import { activityUpdatedFields, participantUnlinkedPayload } from "../../entities/trip-notification.js";
import { ActivityNotFoundError } from "../../errors/activity-not-found-error.js";
import { TripNotFoundError } from "../../errors/trip-not-found-error.js";
import { ValidationError } from "../../errors/validation-error.js";
import type { TripActivityPort, TripActivityReadScope } from "../../ports/trip-activity-port.js";
import type { TaggedError } from "../../types/error.js";
import { err, ok, type AsyncResult } from "../../types/result.js";
import type { UseCase } from "../../types/usecase.js";
import type { ObjectId } from "../../value-objects/object-id.js";
import { applyAuthorPlan, evaluatePlanChange } from "./agenda-plan-change.js";
import { emitToMembers, type MemberNotification } from "./notification-emission.js";

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
/** `affected` lists the participations moved to pending with a decision marker (for notifications); it is not exposed over HTTP. */
export type UpdateTripActivityResult = { activity: Activity; affected: ActivityParticipation[] };
interface Dependencies { activities: TripActivityPort }
interface UpdateDependencies extends Dependencies { createId: () => ObjectId; now: () => Date }
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
    const userId = payload.authenticatedUserId;
    const existing = await scope.list();
    if (!existing.ok) return existing;
    const records = await scope.listUserParticipations(userId);
    if (!records.ok) return records;
    const plan = evaluatePlanChange({ candidate: activity.value, userId, tripId: payload.tripId, activities: existing.value,
      participations: records.value, confirmedConflicts: payload.confirmedConflicts, confirmedActivity: payload.confirmedActivity });
    if (!plan.ok) return plan;
    // Nothing is inserted before a required confirmation.
    if (plan.value.status === "confirmation_required") return ok({ outcome: "confirmation_required" as const,
      conflicts: plan.value.conflicts, activity: plan.value.activity });
    const inserted = await scope.insert(activity.value);
    if (!inserted.ok) return inserted;
    const saved = await applyAuthorPlan(scope, { activity: activity.value, userId, tripId: payload.tripId,
      conflicts: plan.value.conflicts, records: records.value, createId, updatedAt: createdAt });
    if (!saved.ok) return saved;
    // Last write, same transaction: the event exists only if the activity does.
    const emitted = await emitToMembers(scope, [{ type: "activity.created", tripId: payload.tripId, operationRef: activity.value.id, actorId: userId,
      exclude: [userId], createdAt, payload: { activityId: activity.value.id, actorId: userId, scheduledAt: activity.value.scheduledAt,
        durationMinutes: activity.value.durationMinutes } }]);
    return emitted.ok ? ok({ outcome: "created" as const, activity: activity.value, participation: saved.value }) : emitted;
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

/** Fields of a schedule edit, in canonical order; empty when neither start nor duration changed. */
export const changedScheduleFields = (before: Activity, after: Activity): ParticipationDecisionRequired["changedFields"] => {
  const changed: ParticipationDecisionRequired["changedFields"] = [];
  if (before.scheduledAt.getTime() !== after.scheduledAt.getTime()) changed.push("scheduledAt");
  if ((before.durationMinutes ?? null) !== (after.durationMinutes ?? null)) changed.push("durationMinutes");
  return changed;
};

/**
 * Pure: the decision marker for a going participant of the edited activity plus ALL the plans that now conflict, or undefined when the
 * new schedule is compatible with the rest of that user's agenda. Reuses the agenda conflict rule; reusable by T57 when schedules are relocated.
 */
export const computeDecisionRequired = (input: { edited: Activity; userId: ObjectId; tripId: ObjectId; activities: readonly Activity[];
  userGoing: readonly ActivityParticipation[]; changedFields: ParticipationDecisionRequired["changedFields"]; changedAt: Date }):
  { decisionRequired: ParticipationDecisionRequired; conflicts: ActivityConflict[] } | undefined => {
  const conflicts = findAgendaConflicts({ candidate: input.edited, userId: input.userId, tripId: input.tripId, activities: input.activities,
    participations: input.userGoing });
  return conflicts.length === 0 ? undefined
    : { decisionRequired: { reason: "schedule_conflict", changedFields: [...input.changedFields], changedAt: new Date(input.changedAt.getTime()) }, conflicts };
};

export const updateTripActivity: UseCase<UpdateDependencies, UpdateTripActivityPayload, UpdateTripActivityResult, TaggedError> = {
  execute: ({ activities, createId, now }, payload) => activities.withTransaction(payload.tripId, async (scope) => {
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
    const changedFields = changedScheduleFields(current.value, activity);
    // An edit that changes no stored field is not an event (also covers the retry of an edit that was already applied).
    const updatedFields = activityUpdatedFields(current.value, activity);
    const saved = await scope.replace(activity);
    if (!saved.ok) return saved;
    if (updatedFields.length === 0) return ok({ activity, affected: [] });
    // One operation id and one UTC instant per edit: they key and date the update and every unlinking of it.
    const changedAt = now(), operationId = createId();
    const affected: ActivityParticipation[] = [];
    const unlinked: MemberNotification[] = [];
    if (changedFields.length > 0) {
      // Review each current going participant's agenda with the new schedule.
      const going = await scope.listGoingParticipants(activity.id);
      if (!going.ok) return going;
      // Already pending (with or without marker) users are not in `going` and are never touched nor notified again.
      const users = going.value.map((p) => p.userId);
      if (users.length > 0) {
        const [all, goingByUser] = [await scope.list(), await scope.listGoingParticipationsByUsers(users)];
        if (!all.ok) return all;
        if (!goingByUser.ok) return goingByUser;
        for (const participation of going.value) {
          const review = computeDecisionRequired({ edited: activity, userId: participation.userId, tripId: payload.tripId,
            activities: all.value, userGoing: goingByUser.value.filter((p) => p.userId === participation.userId), changedFields, changedAt });
          if (review === undefined) continue;
          const pending = createActivityParticipation({ id: participation.id, tripId: participation.tripId, activityId: participation.activityId,
            userId: participation.userId, status: "pending", updatedAt: changedAt, decisionRequired: review.decisionRequired });
          if (!pending.ok) return pending;
          const written = await scope.saveParticipation(pending.value);
          if (!written.ok) return written;
          affected.push(written.value);
          unlinked.push({ type: "activity.participant_unlinked", tripId: payload.tripId, operationRef: operationId, actorId: payload.authenticatedUserId,
            only: [participation.userId], createdAt: changedAt,
            payload: participantUnlinkedPayload({ activity, changedFields, changedAt, conflicts: review.conflicts }) });
        }
      }
    }
    // Last writes of the edit, same transaction: the update goes to the members except the editor and the unlinked ones, who get their own notice.
    const emitted = await emitToMembers(scope, [{ type: "activity.updated", tripId: payload.tripId, operationRef: operationId, actorId: payload.authenticatedUserId,
      exclude: [payload.authenticatedUserId, ...affected.map((p) => p.userId)], createdAt: changedAt,
      payload: { activityId: activity.id, actorId: payload.authenticatedUserId, changedFields: updatedFields } }, ...unlinked]);
    return emitted.ok ? ok({ activity, affected }) : emitted;
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
