import type { TripRole } from "../../entities/trip-member.js";
import { buildTripNotifications } from "../../entities/trip-notification.js";
import { TripMemberNotFoundError } from "../../errors/trip-member-not-found-error.js";
import { TripNotFoundError } from "../../errors/trip-not-found-error.js";
import { TripOwnerProtectedError } from "../../errors/trip-owner-protected-error.js";
import { UnauthorizedError } from "../../errors/unauthorized-error.js";
import { ValidationError } from "../../errors/validation-error.js";
import type { TripMemberAdministrationPort, TripMemberAdministrationScope } from "../../ports/trip-member-administration-port.js";
import type { TaggedError } from "../../types/error.js";
import { err, ok } from "../../types/result.js";
import type { AsyncResult } from "../../types/result.js";
import type { UseCase } from "../../types/usecase.js";
import type { ObjectId } from "../../value-objects/object-id.js";

export interface TripMemberAdministrationDependencies {
  administration: TripMemberAdministrationPort;
  now: () => Date;
  /** One new id per operation: it is the operation of its notice, so repeated changes on the same member are distinct notices. */
  createId: () => ObjectId;
}

export interface ChangeTripMemberRolePayload {
  tripId: ObjectId;
  actorUserId: ObjectId;
  targetUserId: ObjectId;
  role: TripRole;
}

export interface TransferTripOwnershipPayload {
  tripId: ObjectId;
  actorUserId: ObjectId;
  targetUserId: ObjectId;
}

/** Actor must be a current member (404 otherwise) and the owner (403 otherwise; a Trip without owner blocks everything). */
const requireOwner = async (scope: TripMemberAdministrationScope, actorUserId: ObjectId): AsyncResult<void, TaggedError> => {
  const actor = await scope.findMember(actorUserId);
  if (!actor.ok) return actor;
  if (actor.value === undefined) return err(new TripNotFoundError());
  const ownerId = await scope.findOwnerId();
  if (!ownerId.ok) return ownerId;
  if (ownerId.value === undefined || ownerId.value !== actorUserId) return err(new UnauthorizedError());
  return ok(undefined);
};

export const changeTripMemberRole: UseCase<TripMemberAdministrationDependencies, ChangeTripMemberRolePayload, void, TaggedError> = {
  execute: ({ administration, now, createId }, { tripId, actorUserId, targetUserId, role }) => administration.withTransaction(tripId, async (scope) => {
    const owner = await requireOwner(scope, actorUserId);
    if (!owner.ok) return owner;
    const target = await scope.findMember(targetUserId);
    if (!target.ok) return target;
    if (target.value === undefined) return err(new TripMemberNotFoundError());
    // Only the owner can be here: the target being the actor means being the owner.
    if (targetUserId === actorUserId && role === "participant") return err(new TripOwnerProtectedError());
    if (target.value.role === role) return ok(undefined);
    // Only the affected member is notified, and only when the role really changes.
    const notices = buildTripNotifications({ type: "member.role_changed", tripId, operationRef: createId(), actorId: actorUserId,
      recipients: [targetUserId], payload: { userId: targetUserId, role }, createdAt: now() });
    return scope.setRole(targetUserId, role, notices);
  }),
};

export const transferTripOwnership: UseCase<TripMemberAdministrationDependencies, TransferTripOwnershipPayload, void, TaggedError> = {
  execute: ({ administration, now, createId }, { tripId, actorUserId, targetUserId }) => administration.withTransaction(tripId, async (scope) => {
    const owner = await requireOwner(scope, actorUserId);
    if (!owner.ok) return owner;
    const target = await scope.findMember(targetUserId);
    if (!target.ok) return target;
    if (target.value === undefined) return err(new TripMemberNotFoundError());
    if (targetUserId === actorUserId) {
      return err(new ValidationError([{ field: "userId", code: "same_owner", message: "The new owner must be another member." }]));
    }
    // Only the new owner is notified (no other admin, no role notice on top of it).
    const notices = buildTripNotifications({ type: "trip.ownership_transferred", tripId, operationRef: createId(), actorId: actorUserId,
      recipients: [targetUserId], payload: { previousOwnerId: actorUserId }, createdAt: now() });
    return scope.transferOwnership(actorUserId, targetUserId, notices);
  }),
};
