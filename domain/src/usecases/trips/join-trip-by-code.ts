import { InvalidInviteCodeError } from "../../errors/invalid-invite-code-error.js";
import { ValidationError } from "../../errors/validation-error.js";
import type { TripInvitationRepository, TripMembershipRepository } from "../../ports/trip-invitation-port.js";
import type { TaggedError } from "../../types/error.js";
import { err, ok } from "../../types/result.js";
import type { UseCase } from "../../types/usecase.js";
import type { ObjectId } from "../../value-objects/object-id.js";

export interface JoinTripByCodeDependencies<TError extends TaggedError = TaggedError> {
  trips: TripInvitationRepository<TError>;
  members: TripMembershipRepository<TError>;
}

export interface JoinTripByCodePayload {
  authenticatedUserId: ObjectId;
  code: string;
}

export interface JoinTripByCodeResult {
  tripId: ObjectId;
  joined: boolean;
}

export const joinTripByCode: UseCase<
  JoinTripByCodeDependencies,
  JoinTripByCodePayload,
  JoinTripByCodeResult,
  TaggedError | InvalidInviteCodeError | ValidationError
> = {
  execute: async ({ trips, members }, { authenticatedUserId, code }) => {
    if (code.trim() === "") {
      return err(new ValidationError([{ field: "code", code: "required", message: "Invitation code is required." }]));
    }

    const trip = await trips.findByInviteCode(code);
    if (!trip.ok) return trip;
    if (trip.value === undefined) return err(new InvalidInviteCodeError());

    const joined = await members.addParticipant(trip.value.id, authenticatedUserId);
    return joined.ok
      ? ok({ tripId: trip.value.id, joined: joined.value })
      : joined;
  },
};
