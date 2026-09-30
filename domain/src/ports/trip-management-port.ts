import type { TripDestination } from "../entities/trip-destination.js";
import type { TripMember } from "../entities/trip-member.js";
import type { Trip, TripExpenseMode, TripVisibility } from "../entities/trip.js";
import type { TaggedError } from "../types/error.js";
import type { AsyncResult } from "../types/result.js";
import type { ObjectId } from "../value-objects/object-id.js";

export interface TripView extends Trip {
  primaryDestination: TripDestination;
}

export interface PublicTripPreview {
  id: ObjectId;
  name: string;
  description: string | null;
  visibility: "public";
  primaryDestination: { name: string };
}

export type TripDetail = TripView | PublicTripPreview;

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
  findByIdForViewer: (tripId: ObjectId, userId: ObjectId) => AsyncResult<TripDetail | undefined, TError>;
  listForMember: (userId: ObjectId) => AsyncResult<TripView[], TError>;
  listPublic: () => AsyncResult<PublicTripPreview[], TError>;
  findPublicById: (tripId: ObjectId) => AsyncResult<{ id: ObjectId } | undefined, TError>;
  updateConfigurationForMember: (
    tripId: ObjectId,
    userId: ObjectId,
    update: TripConfigurationUpdate,
  ) => AsyncResult<TripView | undefined, TError>;
}
