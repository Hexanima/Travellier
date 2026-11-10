import { buildTripNotifications } from "../../entities/trip-notification.js";
import { TripMemberNotFoundError } from "../../errors/trip-member-not-found-error.js";
import { UnauthorizedError } from "../../errors/unauthorized-error.js";
import type { TripMemberManagementPort } from "../../ports/trip-member-management-port.js";
import type { TaggedError } from "../../types/error.js";
import { err, ok } from "../../types/result.js";
import type { UseCase } from "../../types/usecase.js";
import type { ObjectId } from "../../value-objects/object-id.js";

export interface ExpelTripParticipantDependencies<TError extends TaggedError = TaggedError> {
  members: TripMemberManagementPort<TError>;
  now: () => Date;
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
  execute: async ({ members, now }, { tripId, actorUserId, targetUserId }) => {
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
    // The expelled user is the only recipient: no actor, no data of the Trip, nothing for the rest of the members.
    const notices = buildTripNotifications({ type: "member.expelled", tripId, operationRef: target.value.id, actorId: null,
      recipients: [targetUserId], payload: { tripId }, createdAt: now() });
    const removed = await members.removeParticipant(target.value.id, tripId, targetUserId, notices);
    if (!removed.ok) return removed;
    return removed.value ? ok(undefined) : err(new TripMemberNotFoundError());
  },
};
