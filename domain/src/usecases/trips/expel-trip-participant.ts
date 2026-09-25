import { TripMemberNotFoundError } from "../../errors/trip-member-not-found-error.js";
import { UnauthorizedError } from "../../errors/unauthorized-error.js";
import type { TripMemberManagementPort } from "../../ports/trip-member-management-port.js";
import type { TaggedError } from "../../types/error.js";
import { err } from "../../types/result.js";
import type { UseCase } from "../../types/usecase.js";
import type { ObjectId } from "../../value-objects/object-id.js";

export interface ExpelTripParticipantDependencies<TError extends TaggedError = TaggedError> {
  members: TripMemberManagementPort<TError>;
}

export interface ExpelTripParticipantPayload {
  tripId: ObjectId;
  actorUserId: ObjectId;
  targetUserId: ObjectId;
}

export const expelTripParticipant: UseCase<
  ExpelTripParticipantDependencies,
  ExpelTripParticipantPayload,
  void,
  TaggedError
> = {
  execute: async ({ members }, { tripId, actorUserId, targetUserId }) => {
    const actor = await members.findByTripAndUser(tripId, actorUserId);
    if (!actor.ok) return actor;
    if (actor.value?.role !== "admin" || actor.value.tripId !== tripId || actor.value.userId !== actorUserId) {
      return err(new UnauthorizedError());
    }

    const target = await members.findByTripAndUser(tripId, targetUserId);
    if (!target.ok) return target;
    if (target.value === undefined) return err(new TripMemberNotFoundError());
    if (target.value.role !== "participant" || target.value.tripId !== tripId || target.value.userId !== targetUserId) {
      return err(new UnauthorizedError());
    }
    return members.removeParticipant(target.value.id);
  },
};
