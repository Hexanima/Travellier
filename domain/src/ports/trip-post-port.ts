import type { Activity } from "../entities/activity.js";
import type { ItineraryDay } from "../entities/itinerary-day.js";
import type { Post } from "../entities/post.js";
import type { Transport } from "../entities/transport.js";
import type { TripRole } from "../entities/trip-member.js";
import type { Trip } from "../entities/trip.js";
import type { AsyncResult } from "../types/result.js";
import type { ObjectId } from "../value-objects/object-id.js";

/** Authorization and all references are resolved in the same Trip snapshot. */
export interface TripPostReadScope {
  findMemberRole: (userId: ObjectId) => AsyncResult<TripRole | undefined>;
  findTrip: () => AsyncResult<Pick<Trip, "id" | "votingEnabled"> | undefined>;
  listDays: () => AsyncResult<ItineraryDay[]>;
  findActivity: (activityId: ObjectId) => AsyncResult<Pick<Activity, "id" | "tripId"> | undefined>;
  findTransport: (transportId: ObjectId) => AsyncResult<Pick<Transport, "id" | "tripId"> | undefined>;
  find: (postId: ObjectId) => AsyncResult<Post | undefined>;
  list: () => AsyncResult<Post[]>;
}

export interface TripPostScope extends TripPostReadScope {
  insert: (post: Post) => AsyncResult<void>;
  replace: (post: Post) => AsyncResult<void>;
  insertActivity: (activity: Activity) => AsyncResult<void>;
}

export interface TripPostPort {
  withReadSnapshot: <T>(tripId: ObjectId, work: (scope: TripPostReadScope) => AsyncResult<T>) => AsyncResult<T>;
  /** Serialize with Trip mutations; Result.err rolls back every write. */
  withTransaction: <T>(tripId: ObjectId, work: (scope: TripPostScope) => AsyncResult<T>) => AsyncResult<T>;
}
