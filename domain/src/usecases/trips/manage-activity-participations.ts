import { createActivityParticipation, type ActivityParticipation } from "../../entities/activity-participation.js";
import { ActivityNotFoundError } from "../../errors/activity-not-found-error.js";
import { TripNotFoundError } from "../../errors/trip-not-found-error.js";
import type { TripParticipationPort, TripParticipationReadScope } from "../../ports/trip-participation-port.js";
import type { TaggedError } from "../../types/error.js";
import { err, ok } from "../../types/result.js";
import type { UseCase } from "../../types/usecase.js";
import type { ObjectId } from "../../value-objects/object-id.js";
import type { ActivityDetailPayload } from "./manage-activities.js";

export type SetTripActivityParticipationPayload = ActivityDetailPayload & { status: unknown };
interface Dependencies { participations: TripParticipationPort }
interface WriteDependencies extends Dependencies { createId: () => ObjectId; now: () => Date }

const authorize = async (scope: TripParticipationReadScope, payload: ActivityDetailPayload) => {
  const member = await scope.findMemberRole(payload.authenticatedUserId);
  if (!member.ok) return member;
  if (member.value !== "admin" && member.value !== "participant") return err(new TripNotFoundError());
  const trip = await scope.findTrip();
  if (!trip.ok) return trip;
  if (trip.value?.id !== payload.tripId) return err(new TripNotFoundError());
  const activity = await scope.findActivity(payload.activityId);
  if (!activity.ok) return activity;
  return activity.value?.id === payload.activityId && activity.value.tripId === payload.tripId
    ? ok(undefined) : err(new ActivityNotFoundError());
};

export const getTripActivityParticipation: UseCase<Dependencies, ActivityDetailPayload, ActivityParticipation | null, TaggedError> = {
  execute: ({ participations }, payload) => participations.withReadSnapshot(payload.tripId, async (scope) => {
    const access = await authorize(scope, payload);
    if (!access.ok) return access;
    const current = await scope.findParticipation(payload.activityId, payload.authenticatedUserId);
    return current.ok ? ok(current.value ?? null) : current;
  }),
};

export const setTripActivityParticipation: UseCase<WriteDependencies, SetTripActivityParticipationPayload, ActivityParticipation, TaggedError> = {
  execute: ({ participations, createId, now }, payload) => participations.withTransaction(payload.tripId, async (scope) => {
    const access = await authorize(scope, payload);
    if (!access.ok) return access;
    const current = await scope.findParticipation(payload.activityId, payload.authenticatedUserId);
    if (!current.ok) return current;
    const participation = createActivityParticipation({ id: current.value?.id ?? createId(), tripId: payload.tripId,
      activityId: payload.activityId, userId: payload.authenticatedUserId, status: payload.status, updatedAt: now() });
    return participation.ok ? scope.save(participation.value) : participation;
  }),
};
