import { buildTripNotifications, notificationRecipients } from "../../entities/trip-notification.js";
import { TripMemberNotFoundError } from "../../errors/trip-member-not-found-error.js";
import { TripNotFoundError } from "../../errors/trip-not-found-error.js";
import { TripOwnerProtectedError } from "../../errors/trip-owner-protected-error.js";
import type { TripMemberAdministrationPort } from "../../ports/trip-member-administration-port.js";
import type { TaggedError } from "../../types/error.js";
import { err, ok } from "../../types/result.js";
import type { UseCase } from "../../types/usecase.js";
import type { ObjectId } from "../../value-objects/object-id.js";

export interface LeaveTripDependencies {
  administration: TripMemberAdministrationPort;
  now: () => Date;
}

export interface LeaveTripPayload {
  tripId: ObjectId;
  actorUserId: ObjectId;
}

/**
 * Any current member leaves; the owner must transfer ownership or delete the Trip first.
 * Membership and owner are read inside the Trip transaction and the leaving instant is taken once the lock is held;
 * it shares the cleanup of future participations with the expulsion (removeMember). The remaining members get `member.left` in the
 * same transaction; the expulsion does not emit it (only the expelled user is notified).
 */
export const leaveTrip: UseCase<LeaveTripDependencies, LeaveTripPayload, void, TaggedError> = {
  execute: ({ administration, now }, { tripId, actorUserId }) => administration.withTransaction(tripId, async (scope) => {
    const member = await scope.findMember(actorUserId);
    if (!member.ok) return member;
    if (member.value === undefined) return err(new TripNotFoundError());
    const ownerId = await scope.findOwnerId();
    if (!ownerId.ok) return ownerId;
    if (ownerId.value === actorUserId) return err(new TripOwnerProtectedError());
    // Without an owner who is a member and admin (inconsistent data), an admin leaving could leave the Trip without admin.
    if (member.value.role === "admin") {
      const owner = ownerId.value === undefined ? undefined : await scope.findMember(ownerId.value);
      if (owner !== undefined && !owner.ok) return owner;
      if (owner?.value === undefined || owner.value.role !== "admin") return err(new TripOwnerProtectedError());
    }
    // Members who stay, read with the lock held: the leaver is not a recipient. One instant for the notices and the participations cleanup.
    const memberIds = await scope.listMemberIds();
    if (!memberIds.ok) return memberIds;
    const at = now();
    const notices = buildTripNotifications({ type: "member.left", tripId, operationRef: member.value.id, actorId: actorUserId,
      recipients: notificationRecipients(memberIds.value, [actorUserId]), payload: { memberId: member.value.id, userId: actorUserId }, createdAt: at });
    const removed = await scope.removeMember(member.value.id, actorUserId, notices, at);
    if (!removed.ok) return removed;
    return removed.value ? ok(undefined) : err(new TripMemberNotFoundError());
  }),
};
