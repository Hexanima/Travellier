import type { TripMember, TripMemberSummary } from "../entities/trip-member.js";
import type { TripNotificationDraft } from "../entities/trip-notification.js";
import type { TaggedError } from "../types/error.js";
import type { AsyncResult } from "../types/result.js";
import type { ObjectId } from "../value-objects/object-id.js";

export interface TripMemberManagementPort<TError extends TaggedError = TaggedError> {
  findByTripAndUser: (tripId: ObjectId, userId: ObjectId) => AsyncResult<TripMember | undefined, TError>;
  /** `notifications` (T91: the notice of the expelled user alone) are written in the same transaction, only when the membership was really deleted. */
  removeParticipant: (membershipId: ObjectId, tripId: ObjectId, userId: ObjectId, notifications: readonly TripNotificationDraft[]) => AsyncResult<boolean, TError>;
}

export interface TripMemberListingPort<TError extends TaggedError = TaggedError> {
  findByTripAndUser: TripMemberManagementPort<TError>["findByTripAndUser"];
  listByTrip: (tripId: ObjectId) => AsyncResult<TripMemberSummary[], TError>;
}
