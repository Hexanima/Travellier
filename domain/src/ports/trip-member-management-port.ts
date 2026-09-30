import type { TripMember, TripMemberSummary } from "../entities/trip-member.js";
import type { TaggedError } from "../types/error.js";
import type { AsyncResult } from "../types/result.js";
import type { ObjectId } from "../value-objects/object-id.js";

export interface TripMemberManagementPort<TError extends TaggedError = TaggedError> {
  findByTripAndUser: (tripId: ObjectId, userId: ObjectId) => AsyncResult<TripMember | undefined, TError>;
  removeParticipant: (membershipId: ObjectId, tripId: ObjectId, userId: ObjectId) => AsyncResult<boolean, TError>;
}

export interface TripMemberListingPort<TError extends TaggedError = TaggedError> {
  findByTripAndUser: TripMemberManagementPort<TError>["findByTripAndUser"];
  listByTrip: (tripId: ObjectId) => AsyncResult<TripMemberSummary[], TError>;
}
