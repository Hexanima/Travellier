import type { TripDestination } from "../entities/trip-destination.js";
import type { TripRole } from "../entities/trip-member.js";
import type { AsyncResult } from "../types/result.js";
import type { ObjectId } from "../value-objects/object-id.js";

/** All operations are scoped to the Trip locked by withTransaction. */
export interface TripDeletionScope {
  findMemberRole: (userId: ObjectId) => AsyncResult<TripRole | undefined>;
  listDestinations: () => AsyncResult<TripDestination[]>;
  hasDestinationRecords: (destinationId: ObjectId) => AsyncResult<boolean>;
  removeDestination: (destinationId: ObjectId) => AsyncResult<void>;
  removeTrip: () => AsyncResult<void>;
}

export interface TripDeletionPort {
  findDestinationIdsWithRecords: (tripId: ObjectId) => AsyncResult<ObjectId[]>;
  withTransaction: <T>(tripId: ObjectId, work: (scope: TripDeletionScope) => AsyncResult<T>) => AsyncResult<T>;
}
