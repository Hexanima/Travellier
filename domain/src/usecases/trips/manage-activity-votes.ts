import type { ActivityStatus } from "../../entities/activity.js";
import { createActivityVote, type ActivityVote } from "../../entities/activity-vote.js";
import { ActivityNotFoundError } from "../../errors/activity-not-found-error.js";
import { ActivityVotingDisabledError } from "../../errors/activity-voting-disabled-error.js";
import { TripNotFoundError } from "../../errors/trip-not-found-error.js";
import type { TripVotePort, TripVoteReadScope } from "../../ports/trip-vote-port.js";
import { transitionAfterActivityVote } from "../../services/activity-voting-policy.js";
import type { TaggedError } from "../../types/error.js";
import { err, ok } from "../../types/result.js";
import type { UseCase } from "../../types/usecase.js";
import type { ObjectId } from "../../value-objects/object-id.js";
import type { ActivityDetailPayload } from "./manage-activities.js";

export type SetTripActivityVotePayload = ActivityDetailPayload & { value: unknown };
export interface TripActivityVoteView { vote: ActivityVote | null; activityStatus: ActivityStatus }
export type SetTripActivityVoteResult = TripActivityVoteView & { vote: ActivityVote };
interface Dependencies { votes: TripVotePort }
interface WriteDependencies extends Dependencies { createId: () => ObjectId; now: () => Date }

const authorize = async (scope: TripVoteReadScope, payload: ActivityDetailPayload) => {
  const member = await scope.findMemberRole(payload.authenticatedUserId);
  if (!member.ok) return member;
  if (member.value !== "admin" && member.value !== "participant") return err(new TripNotFoundError());
  const trip = await scope.findTrip();
  if (!trip.ok) return trip;
  if (trip.value?.id !== payload.tripId) return err(new TripNotFoundError());
  const activity = await scope.findActivity(payload.activityId);
  if (!activity.ok) return activity;
  return activity.value?.id === payload.activityId && activity.value.tripId === payload.tripId
    ? ok({ trip: trip.value, activity: activity.value }) : err(new ActivityNotFoundError());
};

export const getTripActivityVote: UseCase<Dependencies, ActivityDetailPayload, TripActivityVoteView, TaggedError> = {
  execute: ({ votes }, payload) => votes.withReadSnapshot(payload.tripId, async (scope) => {
    const access = await authorize(scope, payload);
    if (!access.ok) return access;
    const current = await scope.findVote(payload.activityId, payload.authenticatedUserId);
    return current.ok ? ok({ vote: current.value ?? null, activityStatus: access.value.activity.status }) : current;
  }),
};

export const setTripActivityVote: UseCase<WriteDependencies, SetTripActivityVotePayload, SetTripActivityVoteResult, TaggedError> = {
  execute: ({ votes, createId, now }, payload) => votes.withTransaction(payload.tripId, async (scope) => {
    const access = await authorize(scope, payload);
    if (!access.ok) return access;
    if (!access.value.trip.votingEnabled) return err(new ActivityVotingDisabledError());
    const nextStatus = transitionAfterActivityVote(access.value.activity.status);
    if (!nextStatus.ok) return nextStatus;
    const current = await scope.findVote(payload.activityId, payload.authenticatedUserId);
    if (!current.ok) return current;
    const vote = createActivityVote({ id: current.value?.id ?? createId(), tripId: payload.tripId,
      activityId: payload.activityId, userId: payload.authenticatedUserId, value: payload.value,
      createdAt: current.value?.createdAt ?? now() });
    if (!vote.ok) return vote;
    const saved = await scope.save(vote.value);
    if (!saved.ok) return saved;
    if (nextStatus.value !== access.value.activity.status) {
      const updated = await scope.setActivityStatus(payload.activityId, nextStatus.value);
      if (!updated.ok) return updated;
    }
    return ok({ vote: saved.value, activityStatus: nextStatus.value });
  }),
};
