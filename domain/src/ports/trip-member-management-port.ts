import type { TripMember } from "../entities/trip-member.js";
import type { TaggedError } from "../types/error.js";
import type { AsyncResult } from "../types/result.js";
import type { ObjectId } from "../value-objects/object-id.js";

export interface TripMemberManagementPort<TError extends TaggedError = TaggedError> {
  findByTripAndUser: (tripId: ObjectId, userId: ObjectId) => AsyncResult<TripMember | undefined, TError>;
  removeParticipant: (membershipId: ObjectId) => AsyncResult<void, TError>;
}
