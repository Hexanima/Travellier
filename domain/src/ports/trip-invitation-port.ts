import type { TaggedError } from "../types/error.js";
import type { AsyncResult } from "../types/result.js";
import type { ObjectId } from "../value-objects/object-id.js";

export interface TripInvitationRepository<TError extends TaggedError = TaggedError> {
  findByInviteCode: (code: string) => AsyncResult<{ id: ObjectId } | undefined, TError>;
}

export interface TripMembershipRepository<TError extends TaggedError = TaggedError> {
  addParticipant: (tripId: ObjectId, userId: ObjectId) => AsyncResult<boolean, TError>;
}
