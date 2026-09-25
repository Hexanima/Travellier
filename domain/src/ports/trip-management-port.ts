import type { TripDestination } from "../entities/trip-destination.js";
import type { TripMember } from "../entities/trip-member.js";
import type { Trip, TripExpenseMode, TripVisibility } from "../entities/trip.js";
import type { TaggedError } from "../types/error.js";
import type { AsyncResult } from "../types/result.js";
import type { ObjectId } from "../value-objects/object-id.js";

export interface TripView extends Trip {
  primaryDestination: TripDestination;
}

export interface TripCreationRecord {
  trip: Trip;
  creatorMembership: TripMember;
  primaryDestination: TripDestination;
}

export interface TripConfigurationUpdate {
  visibility?: TripVisibility;
  votingEnabled?: boolean;
  expenseMode?: TripExpenseMode;
}

export interface TripManagementPort<TError extends TaggedError = TaggedError> {
  createWithAdminAndDestination: (record: TripCreationRecord) => AsyncResult<void, TError>;
  findByIdForMember: (tripId: ObjectId, userId: ObjectId) => AsyncResult<TripView | undefined, TError>;
  listForMember: (userId: ObjectId) => AsyncResult<TripView[], TError>;
  updateConfigurationForMember: (
    tripId: ObjectId,
    userId: ObjectId,
    update: TripConfigurationUpdate,
  ) => AsyncResult<TripView | undefined, TError>;
}
