import type { Activity, ActivityStatus } from "../entities/activity.js";
import type { ActivityVote } from "../entities/activity-vote.js";
import type { TripRole } from "../entities/trip-member.js";
import type { Trip } from "../entities/trip.js";
import type { AsyncResult } from "../types/result.js";
import type { ObjectId } from "../value-objects/object-id.js";

/** All reads use the same Trip and persistence snapshot. */
export interface TripVoteReadScope {
  findMemberRole: (userId: ObjectId) => AsyncResult<TripRole | undefined>;
  findTrip: () => AsyncResult<Pick<Trip, "id" | "votingEnabled"> | undefined>;
  findActivity: (activityId: ObjectId) => AsyncResult<Pick<Activity, "id" | "tripId" | "status"> | undefined>;
  findVote: (activityId: ObjectId, userId: ObjectId) => AsyncResult<ActivityVote | undefined>;
}

export interface TripVoteScope extends TripVoteReadScope {
  /** Upsert only this activity/user pair; preserve its identity and original creation time. */
  save: (vote: ActivityVote) => AsyncResult<ActivityVote>;
  setActivityStatus: (activityId: ObjectId, status: ActivityStatus) => AsyncResult<void>;
}

export interface TripVotePort {
  withReadSnapshot: <T>(tripId: ObjectId, work: (scope: TripVoteReadScope) => AsyncResult<T>) => AsyncResult<T>;
  /** Serialize with Trip/activity deletion, configuration and expulsion; errors abort all writes. */
  withTransaction: <T>(tripId: ObjectId, work: (scope: TripVoteScope) => AsyncResult<T>) => AsyncResult<T>;
}
