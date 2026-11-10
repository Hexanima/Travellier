import { TripNotFoundError } from "../../errors/trip-not-found-error.js";
import type { TripMembershipRepository } from "../../ports/trip-invitation-port.js";
import type { PublicTripPreview, TripManagementPort } from "../../ports/trip-management-port.js";
import type { TaggedError } from "../../types/error.js";
import { err, ok } from "../../types/result.js";
import type { UseCase } from "../../types/usecase.js";
import type { ObjectId } from "../../value-objects/object-id.js";
import { memberJoinedNotifier, type JoinTripByCodeResult } from "./join-trip-by-code.js";

export interface ListPublicTripsPayload {
  authenticatedUserId: ObjectId;
}

export interface JoinPublicTripPayload extends ListPublicTripsPayload {
  tripId: ObjectId;
}

type PublicTripRepository = Pick<TripManagementPort, "listPublic">;

export const listPublicTrips: UseCase<
  { trips: PublicTripRepository },
  ListPublicTripsPayload,
  PublicTripPreview[],
  TaggedError
> = {
  execute: ({ trips }) => trips.listPublic(),
};

export const joinPublicTrip: UseCase<
  { members: Pick<TripMembershipRepository, "addPublicParticipant">; now: () => Date },
  JoinPublicTripPayload,
  JoinTripByCodeResult,
  TaggedError
> = {
  execute: async ({ members, now }, { authenticatedUserId, tripId }) => {
    const joined = await members.addPublicParticipant(tripId, authenticatedUserId, memberJoinedNotifier({ tripId, userId: authenticatedUserId, now }));
    if (!joined.ok) return joined;
    return joined.value === undefined
      ? err(new TripNotFoundError())
      : ok({ tripId, joined: joined.value });
  },
};
