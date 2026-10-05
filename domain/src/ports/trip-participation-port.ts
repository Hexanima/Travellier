import type { Activity } from "../entities/activity.js";
import type { ActivityParticipation } from "../entities/activity-participation.js";
import type { TripRole } from "../entities/trip-member.js";
import type { AsyncResult } from "../types/result.js";
import type { ObjectId } from "../value-objects/object-id.js";

/** All reads are scoped to the same Trip and persistence snapshot. */
export interface TripParticipationReadScope {
  findMemberRole: (userId: ObjectId) => AsyncResult<TripRole | undefined>;
  findTrip: () => AsyncResult<{ id: ObjectId } | undefined>;
  findActivity: (activityId: ObjectId) => AsyncResult<Pick<Activity, "id" | "tripId"> | undefined>;
  findParticipation: (activityId: ObjectId, userId: ObjectId) => AsyncResult<ActivityParticipation | undefined>;
}

export interface TripParticipationScope extends TripParticipationReadScope {
  /** Upsert only this activity/user pair; preserve its existing identity. */
  save: (participation: ActivityParticipation) => AsyncResult<ActivityParticipation>;
}

export interface TripParticipationPort {
  withReadSnapshot: <T>(tripId: ObjectId, work: (scope: TripParticipationReadScope) => AsyncResult<T>) => AsyncResult<T>;
  /** Serialize with activity/Trip deletion and membership revocation; errors abort writes. */
  withTransaction: <T>(tripId: ObjectId, work: (scope: TripParticipationScope) => AsyncResult<T>) => AsyncResult<T>;
}
