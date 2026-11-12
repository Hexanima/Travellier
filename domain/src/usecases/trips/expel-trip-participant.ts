import { buildTripNotifications } from "../../entities/trip-notification.js";
import { TripMemberNotFoundError } from "../../errors/trip-member-not-found-error.js";
import { TripNotFoundError } from "../../errors/trip-not-found-error.js";
import { UnauthorizedError } from "../../errors/unauthorized-error.js";
import type { TripMemberAdministrationPort } from "../../ports/trip-member-administration-port.js";
import type { TaggedError } from "../../types/error.js";
import { err, ok } from "../../types/result.js";
import type { UseCase } from "../../types/usecase.js";
import type { ObjectId } from "../../value-objects/object-id.js";

export interface ExpelTripParticipantDependencies {
  administration: TripMemberAdministrationPort;
  now: () => Date;
}

export interface ExpelTripParticipantPayload {
  tripId: ObjectId;
  actorUserId: ObjectId;
  targetUserId: ObjectId;
}

/**
 * Admins expel participants; only the owner expels admins; nobody expels the owner.
 * Actor, target and owner are read inside the Trip transaction, so a concurrent role change or transfer cannot be bypassed.
 */
export const expelTripParticipant: UseCase<
  ExpelTripParticipantDependencies,
  ExpelTripParticipantPayload,
  void,
  TaggedError
> = {
  execute: ({ administration, now }, { tripId, actorUserId, targetUserId }) => administration.withTransaction(tripId, async (scope) => {
    const actor = await scope.findMember(actorUserId);
    if (!actor.ok) return actor;
    // A non-member (stranger or former member) gets the same answer as a missing Trip, before any role or target check.
    if (actor.value === undefined) return err(new TripNotFoundError());
    if (actor.value.role !== "admin") return err(new UnauthorizedError());

    const target = await scope.findMember(targetUserId);
    if (!target.ok) return target;
    if (target.value === undefined) return err(new TripMemberNotFoundError());
    const ownerId = await scope.findOwnerId();
    if (!ownerId.ok) return ownerId;
    // The owner is protected whatever its role says (inconsistent data included).
    if (ownerId.value === targetUserId) return err(new UnauthorizedError());
    // Any admin can only be expelled by the owner (a Trip without owner blocks it).
    if (target.value.role === "admin" && (ownerId.value === undefined || ownerId.value !== actorUserId)) return err(new UnauthorizedError());
    // The expelled user is the only recipient: no actor, no data of the Trip, nothing for the rest of the members.
    // One instant (read with the lock held) for the notice and for the cleanup of future participations.
    const at = now();
    const notices = buildTripNotifications({ type: "member.expelled", tripId, operationRef: target.value.id, actorId: null,
      recipients: [targetUserId], payload: { tripId }, createdAt: at });
    const removed = await scope.removeMember(target.value.id, targetUserId, notices, at);
    if (!removed.ok) return removed;
    return removed.value ? ok(undefined) : err(new TripMemberNotFoundError());
  }),
};
