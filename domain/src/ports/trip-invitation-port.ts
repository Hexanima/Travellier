import type { TripNotificationDraft } from "../entities/trip-notification.js";
import type { TaggedError } from "../types/error.js";
import type { AsyncResult } from "../types/result.js";
import type { ObjectId } from "../value-objects/object-id.js";

export interface TripInvitationRepository<TError extends TaggedError = TaggedError> {
  findByInviteCode: (code: string) => AsyncResult<{ id: ObjectId } | undefined, TError>;
}

/** What the adapter knows only inside the join transaction: the new membership and the current members (the new one included). */
export interface MembershipJoinInfo { membershipId: ObjectId; memberUserIds: readonly ObjectId[] }
/** Builds the events of a NEW membership (T91); the adapter runs it inside the transaction and only when the membership was really created. */
export type MembershipNotificationBuilder = (info: MembershipJoinInfo) => TripNotificationDraft[];

export interface TripMembershipRepository<TError extends TaggedError = TaggedError> {
  addParticipant: (tripId: ObjectId, userId: ObjectId, notify: MembershipNotificationBuilder) => AsyncResult<boolean, TError>;
  addPublicParticipant: (tripId: ObjectId, userId: ObjectId, notify: MembershipNotificationBuilder) => AsyncResult<boolean | undefined, TError>;
}
