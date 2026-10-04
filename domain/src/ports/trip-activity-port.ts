import type { Activity } from "../entities/activity.js";
import type { ItineraryDay } from "../entities/itinerary-day.js";
import type { TripRole } from "../entities/trip-member.js";
import type { Trip } from "../entities/trip.js";
import type { AsyncResult } from "../types/result.js";
import type { ObjectId } from "../value-objects/object-id.js";

/** Every operation uses the same Trip and persistence snapshot. */
export interface TripActivityReadScope {
  findMemberRole: (userId: ObjectId) => AsyncResult<TripRole | undefined>;
  findTrip: () => AsyncResult<Pick<Trip, "id" | "votingEnabled"> | undefined>;
  listDays: () => AsyncResult<ItineraryDay[]>;
  list: () => AsyncResult<Activity[]>;
  find: (activityId: ObjectId) => AsyncResult<Activity | undefined>;
}

export interface TripActivityScope extends TripActivityReadScope {
  insert: (activity: Activity) => AsyncResult<void>;
  replace: (activity: Activity) => AsyncResult<void>;
  /** Detach posts, remove votes/participations and delete the activity atomically. */
  remove: (activityId: ObjectId) => AsyncResult<void>;
}

export interface TripActivityPort {
  withReadSnapshot: <T>(tripId: ObjectId, work: (scope: TripActivityReadScope) => AsyncResult<T>) => AsyncResult<T>;
  /** Serialize with itinerary/Trip mutations; Result.err aborts every write. */
  withTransaction: <T>(tripId: ObjectId, work: (scope: TripActivityScope) => AsyncResult<T>) => AsyncResult<T>;
}
