import { buildTripNotifications, notificationRecipients } from "../../entities/trip-notification.js";
import { InvalidInviteCodeError } from "../../errors/invalid-invite-code-error.js";
import { ValidationError } from "../../errors/validation-error.js";
import type { MembershipNotificationBuilder, TripInvitationRepository, TripMembershipRepository } from "../../ports/trip-invitation-port.js";
import type { TaggedError } from "../../types/error.js";
import { err, ok } from "../../types/result.js";
import type { UseCase } from "../../types/usecase.js";
import type { ObjectId } from "../../value-objects/object-id.js";

export interface JoinTripByCodeDependencies<TError extends TaggedError = TaggedError> {
  trips: TripInvitationRepository<TError>;
  members: TripMembershipRepository<TError>;
  now: () => Date;
}

export interface JoinTripByCodePayload {
  authenticatedUserId: ObjectId;
  code: string;
}

export interface JoinTripByCodeResult {
  tripId: ObjectId;
  joined: boolean;
}

/** `member.joined` for every current member except who joined; the adapter calls it only when the membership is new. */
export const memberJoinedNotifier = (input: { tripId: ObjectId; userId: ObjectId; now: () => Date }): MembershipNotificationBuilder =>
  ({ membershipId, memberUserIds }) => buildTripNotifications({ type: "member.joined", tripId: input.tripId, operationRef: membershipId,
    actorId: input.userId, recipients: notificationRecipients(memberUserIds, [input.userId]),
    payload: { memberId: membershipId, userId: input.userId }, createdAt: input.now() });

export const joinTripByCode: UseCase<
  JoinTripByCodeDependencies,
  JoinTripByCodePayload,
  JoinTripByCodeResult,
  TaggedError | InvalidInviteCodeError | ValidationError
> = {
  execute: async ({ trips, members, now }, { authenticatedUserId, code }) => {
    if (code.trim() === "") {
      return err(new ValidationError([{ field: "code", code: "required", message: "Invitation code is required." }]));
    }

    const trip = await trips.findByInviteCode(code);
    if (!trip.ok) return trip;
    if (trip.value === undefined) return err(new InvalidInviteCodeError());

    const joined = await members.addParticipant(trip.value.id, authenticatedUserId,
      memberJoinedNotifier({ tripId: trip.value.id, userId: authenticatedUserId, now }));
    return joined.ok
      ? ok({ tripId: trip.value.id, joined: joined.value })
      : joined;
  },
};
