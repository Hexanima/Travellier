import type { TripMemberSummary } from "../../entities/trip-member.js";
import { TripNotFoundError } from "../../errors/trip-not-found-error.js";
import type { TripMemberListingPort } from "../../ports/trip-member-management-port.js";
import type { TaggedError } from "../../types/error.js";
import { err } from "../../types/result.js";
import type { UseCase } from "../../types/usecase.js";
import type { ObjectId } from "../../value-objects/object-id.js";

export interface ListTripMembersPayload {
  tripId: ObjectId;
  authenticatedUserId: ObjectId;
}

export const listTripMembers: UseCase<
  { members: TripMemberListingPort },
  ListTripMembersPayload,
  TripMemberSummary[],
  TaggedError
> = {
  execute: async ({ members }, { tripId, authenticatedUserId }) => {
    const membership = await members.findByTripAndUser(tripId, authenticatedUserId);
    if (!membership.ok) return membership;
    if (membership.value?.tripId !== tripId || membership.value.userId !== authenticatedUserId) {
      return err(new TripNotFoundError());
    }
    return members.listByTrip(tripId);
  },
};
