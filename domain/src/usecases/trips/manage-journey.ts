import { createTripDestination, type TripDestination } from "../../entities/trip-destination.js";
import { createTransport, type Transport, type TransportDirection, type TransportType } from "../../entities/transport.js";
import { DestinationNotFoundError } from "../../errors/destination-not-found-error.js";
import { TransportNotFoundError } from "../../errors/transport-not-found-error.js";
import { TripNotFoundError } from "../../errors/trip-not-found-error.js";
import { ValidationError } from "../../errors/validation-error.js";
import type { TripMemberManagementPort } from "../../ports/trip-member-management-port.js";
import type { TripJourneyPort } from "../../ports/trip-journey-port.js";
import type { TaggedError } from "../../types/error.js";
import { err, ok, type AsyncResult } from "../../types/result.js";
import type { UseCase } from "../../types/usecase.js";
import type { ObjectId } from "../../value-objects/object-id.js";

interface JourneyDependencies { members: Pick<TripMemberManagementPort, "findByTripAndUser">; journeys: TripJourneyPort }
interface JourneyContext { authenticatedUserId: ObjectId; tripId: ObjectId }
interface DestinationContext extends JourneyContext { destinationId: ObjectId }
interface CreateDestinationDependencies extends JourneyDependencies { createId: () => ObjectId; now: () => Date }
interface TransportDependencies extends JourneyDependencies { createId: () => ObjectId }

export interface CreateJourneyDestinationPayload extends JourneyContext { name: string }
export interface UpdateJourneyDestinationPayload extends DestinationContext { name?: string; order?: number }
export interface JourneyTransportFields {
  direction: TransportDirection;
  type: TransportType;
  departurePlace: string;
  departureAt: Date;
  arrivalPlace: string;
  arrivalAt: Date;
  costPerPerson: number | null;
  details: Transport["details"];
}
export interface CreateJourneyTransportPayload extends DestinationContext, JourneyTransportFields {}
export interface UpdateJourneyTransportPayload extends CreateJourneyTransportPayload { transportId: ObjectId }

const authorize = async ({ members }: JourneyDependencies, { tripId, authenticatedUserId }: JourneyContext): AsyncResult<void> => {
  const membership = await members.findByTripAndUser(tripId, authenticatedUserId);
  if (!membership.ok) return membership;
  return membership.value?.tripId === tripId && membership.value.userId === authenticatedUserId
    ? ok(undefined) : err(new TripNotFoundError());
};

const invalid = (field: string, message: string) => err(new ValidationError([{ field, code: "invalid", message }]));
const transportFromPayload = (payload: CreateJourneyTransportPayload, id: ObjectId): Transport => ({
  id, tripId: payload.tripId, destinationId: payload.destinationId, direction: payload.direction, type: payload.type,
  departurePlace: payload.departurePlace, departureAt: payload.departureAt, arrivalPlace: payload.arrivalPlace,
  arrivalAt: payload.arrivalAt, costPerPerson: payload.costPerPerson, details: payload.details,
} as Transport);

export const listJourneyDestinations: UseCase<JourneyDependencies, JourneyContext, TripDestination[], TaggedError> = {
  execute: async (dependencies, payload) => {
    const access = await authorize(dependencies, payload);
    return access.ok ? dependencies.journeys.listDestinations(payload.tripId) : access;
  },
};

export const createJourneyDestination: UseCase<CreateDestinationDependencies, CreateJourneyDestinationPayload, TripDestination, TaggedError> = {
  execute: async (dependencies, payload) => {
    const access = await authorize(dependencies, payload);
    if (!access.ok) return access;
    const destination = createTripDestination({ id: dependencies.createId(), tripId: payload.tripId, name: payload.name, order: 1, createdAt: dependencies.now() });
    if (!destination.ok) return destination;
    const saved = await dependencies.journeys.appendDestination(destination.value);
    if (!saved.ok) return saved;
    return saved.value === undefined ? err(new TripNotFoundError()) : ok(saved.value);
  },
};

export const updateJourneyDestination: UseCase<JourneyDependencies, UpdateJourneyDestinationPayload, TripDestination, TaggedError> = {
  execute: async (dependencies, payload) => {
    const access = await authorize(dependencies, payload);
    if (!access.ok) return access;
    if (payload.name === undefined && payload.order === undefined) return invalid("destination", "A name or order is required.");
    if (payload.name !== undefined && (typeof payload.name !== "string" || payload.name.trim() === "")) return invalid("name", "Destination name is required.");
    if (payload.order !== undefined && (!Number.isSafeInteger(payload.order) || payload.order < 1)) return invalid("order", "Destination order must be a positive integer.");
    const result = await dependencies.journeys.updateDestination(payload.tripId, payload.destinationId, { ...(payload.name === undefined ? {} : { name: payload.name }), ...(payload.order === undefined ? {} : { order: payload.order }) });
    if (!result.ok) return result;
    return result.value === undefined ? err(new DestinationNotFoundError()) : ok(result.value);
  },
};

export const listJourneyTransports: UseCase<JourneyDependencies, DestinationContext, Transport[], TaggedError> = {
  execute: async (dependencies, payload) => {
    const access = await authorize(dependencies, payload);
    if (!access.ok) return access;
    const destination = await dependencies.journeys.findDestination(payload.tripId, payload.destinationId);
    if (!destination.ok) return destination;
    if (destination.value?.tripId !== payload.tripId) return err(new DestinationNotFoundError());
    return dependencies.journeys.listTransports(payload.tripId, payload.destinationId);
  },
};

export const createJourneyTransport: UseCase<TransportDependencies, CreateJourneyTransportPayload, Transport, TaggedError> = {
  execute: async (dependencies, payload) => {
    const access = await authorize(dependencies, payload);
    if (!access.ok) return access;
    const destination = await dependencies.journeys.findDestination(payload.tripId, payload.destinationId);
    if (!destination.ok) return destination;
    if (destination.value?.tripId !== payload.tripId) return err(new DestinationNotFoundError());
    const candidate = createTransport(transportFromPayload(payload, dependencies.createId()));
    if (!candidate.ok) return candidate;
    const saved = await dependencies.journeys.insertTransport(candidate.value);
    if (!saved.ok) return saved;
    return saved.value === undefined ? err(new DestinationNotFoundError()) : ok(saved.value);
  },
};

export const updateJourneyTransport: UseCase<JourneyDependencies, UpdateJourneyTransportPayload, Transport, TaggedError> = {
  execute: async (dependencies, payload) => {
    const access = await authorize(dependencies, payload);
    if (!access.ok) return access;
    const destination = await dependencies.journeys.findDestination(payload.tripId, payload.destinationId);
    if (!destination.ok) return destination;
    if (destination.value?.tripId !== payload.tripId) return err(new DestinationNotFoundError());
    const candidate = createTransport(transportFromPayload(payload, payload.transportId));
    if (!candidate.ok) return candidate;
    const saved = await dependencies.journeys.replaceTransport(candidate.value);
    if (!saved.ok) return saved;
    return saved.value === undefined ? err(new TransportNotFoundError()) : ok(saved.value);
  },
};
