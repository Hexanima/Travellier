import type { ItineraryDayDraft } from "../../entities/itinerary-day.js";
import { createTransport, type Transport } from "../../entities/transport.js";
import { createTripDestination, type TripDestination } from "../../entities/trip-destination.js";
import { ValidationError } from "../../errors/validation-error.js";
import { err, ok, type Result } from "../../types/result.js";
import type { UseCase } from "../../types/usecase.js";
import type { ObjectId } from "../../value-objects/object-id.js";

export interface GenerateItineraryDaysPayload {
  tripId: ObjectId;
  destinations: readonly TripDestination[];
  transports: readonly Transport[];
}

interface DestinationJourney {
  destination: TripDestination;
  index: number;
  outbound?: Transport;
  return?: Transport;
}

const invalid = (field: string, code: string, message: string) =>
  err(new ValidationError([{ field, code, message }]));

const validateJourney = ({ tripId, destinations, transports }: GenerateItineraryDaysPayload): Result<DestinationJourney[], ValidationError> => {
  const journeys = new Map<ObjectId, DestinationJourney>();
  const positions = new Set<number>();
  for (const [index, destination] of destinations.entries()) {
    const field = `destinations[${index}]`;
    if (destination.tripId !== tripId) return invalid(`${field}.tripId`, "mismatch", "Destination must belong to the Trip.");
    const validated = createTripDestination(destination);
    if (!validated.ok) return err(new ValidationError(validated.error.issues.map((issue) => ({ ...issue, field: `${field}.${issue.field}` }))));
    if (journeys.has(destination.id)) return invalid(`${field}.id`, "duplicate", "Destination IDs must be unique.");
    if (positions.has(destination.order)) return invalid(`${field}.order`, "duplicate", "Destination positions must be unique.");
    journeys.set(destination.id, { destination, index });
    positions.add(destination.order);
  }

  for (const [index, transport] of transports.entries()) {
    const field = `transports[${index}]`;
    if (transport.tripId !== tripId) return invalid(`${field}.tripId`, "mismatch", "Transport must belong to the Trip.");
    const journey = journeys.get(transport.destinationId);
    if (!journey) return invalid(`${field}.destinationId`, "not_found", "Transport destination must be included in the Trip.");
    const validated = createTransport(transport);
    if (!validated.ok) return err(new ValidationError(validated.error.issues.map((issue) => ({ ...issue, field: `${field}.${issue.field}` }))));
    if (journey[transport.direction]) return invalid(`${field}.direction`, "duplicate", "Only one transport per destination and direction is allowed.");
    journey[transport.direction] = validated.value;
  }

  const ordered = [...journeys.values()].sort((a, b) => a.destination.order - b.destination.order);
  let previousEnd: number | undefined;
  for (const journey of ordered) {
    const arrival = journey.outbound?.arrivalAt.getTime();
    const departure = journey.return?.departureAt.getTime();
    const field = `destinations[${journey.index}].activityWindow`;
    if (arrival !== undefined && departure !== undefined && departure < arrival) {
      return invalid(field, "before_arrival", "Destination departure cannot precede its arrival.");
    }
    const start = arrival ?? departure;
    if (start !== undefined && previousEnd !== undefined && start < previousEnd) {
      return invalid(field, "before_previous_destination", "Sequential destinations cannot have overlapping activity windows.");
    }
    previousEnd = departure ?? arrival ?? previousEnd;
  }
  return ok(ordered);
};

export const generateItineraryDays: UseCase<Record<string, never>, GenerateItineraryDaysPayload, ItineraryDayDraft[], ValidationError> = {
  execute: async (_dependencies, payload) => {
    const validated = validateJourney(payload);
    if (!validated.ok) return validated;
    return ok([]);
  },
};
