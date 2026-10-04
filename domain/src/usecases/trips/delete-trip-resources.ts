import { DeletionConflictError, LastDestinationError } from "../../errors/deletion-conflict-error.js";
import { DestinationNotFoundError } from "../../errors/destination-not-found-error.js";
import { TripNotFoundError } from "../../errors/trip-not-found-error.js";
import { UnauthorizedError } from "../../errors/unauthorized-error.js";
import type { TripDeletionPort } from "../../ports/trip-deletion-port.js";
import { err } from "../../types/result.js";
import type { TaggedError } from "../../types/error.js";
import type { UseCase } from "../../types/usecase.js";
import type { ObjectId } from "../../value-objects/object-id.js";

export interface DeleteTripPayload {
  authenticatedUserId: ObjectId;
  tripId: ObjectId;
}

export interface DeleteJourneyDestinationPayload extends DeleteTripPayload {
  destinationId: ObjectId;
}

export const deleteTrip: UseCase<{ deletion: TripDeletionPort }, DeleteTripPayload, void, TaggedError> = {
  execute: ({ deletion }, payload) => deletion.withTransaction(payload.tripId, async (scope) => {
    const member = await scope.findMemberRole(payload.authenticatedUserId);
    if (!member.ok) return member;
    if (member.value === undefined) return err(new TripNotFoundError());
    if (member.value !== "admin") return err(new UnauthorizedError());
    return scope.removeTrip();
  }),
};

export const deleteJourneyDestination: UseCase<{ deletion: TripDeletionPort }, DeleteJourneyDestinationPayload, void, TaggedError> = {
  execute: ({ deletion }, payload) => deletion.withTransaction(payload.tripId, async (scope) => {
    const member = await scope.findMemberRole(payload.authenticatedUserId);
    if (!member.ok) return member;
    if (member.value === undefined) return err(new TripNotFoundError());
    const destinations = await scope.listDestinations();
    if (!destinations.ok) return destinations;
    if (!destinations.value.some((destination) => destination.id === payload.destinationId)) return err(new DestinationNotFoundError());
    if (destinations.value.length <= 1) return err(new LastDestinationError());
    const records = await scope.hasDestinationRecords(payload.destinationId);
    if (!records.ok) return records;
    return records.value ? err(new DeletionConflictError()) : scope.removeDestination(payload.destinationId);
  }),
};
