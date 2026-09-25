import { createTripWithAdmin, type TripExpenseMode, type TripVisibility } from "../../entities/trip.js";
import { TripNotFoundError } from "../../errors/trip-not-found-error.js";
import { UnknownError } from "../../errors/unknown-error.js";
import { ValidationError } from "../../errors/validation-error.js";
import type { TripConfigurationUpdate, TripManagementPort, TripView } from "../../ports/trip-management-port.js";
import type { TaggedError } from "../../types/error.js";
import { err, ok } from "../../types/result.js";
import type { UseCase } from "../../types/usecase.js";
import type { ObjectId } from "../../value-objects/object-id.js";

export interface TripManagementDependencies {
  trips: TripManagementPort;
}

export interface CreateTripDependencies extends TripManagementDependencies {
  createId: () => ObjectId;
  createInviteCode: () => string;
  now: () => Date;
}

export interface CreateTripPayload {
  authenticatedUserId: ObjectId;
  name: string;
  primaryDestination: string;
  description?: string | null;
}

export interface GetTripPayload {
  authenticatedUserId: ObjectId;
  tripId: ObjectId;
}

export interface ListUserTripsPayload {
  authenticatedUserId: ObjectId;
}

export interface UpdateTripConfigurationPayload extends GetTripPayload {
  visibility?: TripVisibility;
  votingEnabled?: boolean;
  expenseMode?: TripExpenseMode;
}

export const createTrip: UseCase<CreateTripDependencies, CreateTripPayload, TripView, TaggedError> = {
  execute: async ({ trips, createId, createInviteCode, now }, payload) => {
    if (payload.primaryDestination.trim() === "") {
      return err(new ValidationError([{ field: "primaryDestination", code: "required", message: "Primary destination is required." }]));
    }

    const tripId = createId();
    const creatorMembershipId = createId();
    const destinationId = createId();
    const createdAt = now();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const created = createTripWithAdmin({
        tripId,
        creatorMembershipId,
        creatorId: payload.authenticatedUserId,
        name: payload.name,
        description: payload.description,
        inviteCode: createInviteCode(),
        createdAt,
      });
      if (!created.ok) return created;

      const primaryDestination = {
        id: destinationId,
        tripId,
        name: payload.primaryDestination,
        order: 1,
        createdAt,
      };
      const result = await trips.createWithAdminAndDestination({
        ...created.value,
        primaryDestination,
      });
      if (result.ok) return ok({ ...created.value.trip, primaryDestination });
      if (result.error.tag !== "InviteCodeConflictError") return result;
    }

    return err(new UnknownError("Unable to generate a unique invitation code."));
  },
};

export const getTrip: UseCase<TripManagementDependencies, GetTripPayload, TripView, TaggedError> = {
  execute: async ({ trips }, { authenticatedUserId, tripId }) => {
    const result = await trips.findByIdForMember(tripId, authenticatedUserId);
    if (!result.ok) return result;
    return result.value === undefined ? err(new TripNotFoundError()) : ok(result.value);
  },
};

export const listUserTrips: UseCase<TripManagementDependencies, ListUserTripsPayload, TripView[], TaggedError> = {
  execute: ({ trips }, { authenticatedUserId }) => trips.listForMember(authenticatedUserId),
};

const validateConfiguration = (payload: UpdateTripConfigurationPayload): ValidationError | undefined => {
  const issues = [];
  if (payload.visibility === undefined && payload.votingEnabled === undefined && payload.expenseMode === undefined) {
    issues.push({ field: "configuration", code: "required", message: "At least one configuration field is required." });
  }
  if (payload.visibility !== undefined && payload.visibility !== "private" && payload.visibility !== "public") {
    issues.push({ field: "visibility", code: "invalid", message: "Trip visibility is invalid." });
  }
  if (payload.votingEnabled !== undefined && typeof payload.votingEnabled !== "boolean") {
    issues.push({ field: "votingEnabled", code: "invalid", message: "Trip voting mode is invalid." });
  }
  if (payload.expenseMode !== undefined && payload.expenseMode !== "register" && payload.expenseMode !== "balance") {
    issues.push({ field: "expenseMode", code: "invalid", message: "Trip expense mode is invalid." });
  }
  return issues.length === 0 ? undefined : new ValidationError(issues);
};

export const updateTripConfiguration: UseCase<TripManagementDependencies, UpdateTripConfigurationPayload, TripView, TaggedError> = {
  execute: async ({ trips }, payload) => {
    const validation = validateConfiguration(payload);
    if (validation !== undefined) return err(validation);

    const update: TripConfigurationUpdate = {
      ...(payload.visibility === undefined ? {} : { visibility: payload.visibility }),
      ...(payload.votingEnabled === undefined ? {} : { votingEnabled: payload.votingEnabled }),
      ...(payload.expenseMode === undefined ? {} : { expenseMode: payload.expenseMode }),
    };
    const result = await trips.updateConfigurationForMember(payload.tripId, payload.authenticatedUserId, update);
    if (!result.ok) return result;
    return result.value === undefined ? err(new TripNotFoundError()) : ok(result.value);
  },
};
