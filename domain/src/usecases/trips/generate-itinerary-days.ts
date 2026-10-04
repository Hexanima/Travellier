import type { ItineraryDayDraft, ItineraryDayType } from "../../entities/itinerary-day.js";
import { readTransport, type Transport } from "../../entities/transport.js";
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
    const validated = readTransport(transport);
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

type DaySlice = Omit<ItineraryDayDraft, "order">;
const utcDayDurationMs = 24 * 60 * 60 * 1_000;

const appendSlices = (slices: DaySlice[], tripId: ObjectId, destinationId: ObjectId,
  type: Exclude<ItineraryDayType, "arrival">, startsAt: Date, endsAt: Date): void => {
  const end = endsAt.getTime();
  let start = startsAt.getTime();
  while (start < end) {
    const date = Math.floor(start / utcDayDurationMs) * utcDayDurationMs;
    const sliceEnd = Math.min(end, date + utcDayDurationMs);
    slices.push({ tripId, destinationId, type, date: new Date(date), startsAt: new Date(start), endsAt: new Date(sliceEnd) });
    start = sliceEnd;
  }
};

/** Derives canonical UTC day slices; callers persist the drafts and the UI projects them into local calendar dates. */
export const generateItineraryDays: UseCase<Record<string, never>, GenerateItineraryDaysPayload, ItineraryDayDraft[], ValidationError> = {
  execute: async (_dependencies, payload) => {
    const validated = validateJourney(payload);
    if (!validated.ok) return validated;
    const slices: DaySlice[] = [];
    for (const { destination, outbound, return: returning } of validated.value) {
      if (outbound) appendSlices(slices, payload.tripId, destination.id, "transit_out", outbound.departureAt, outbound.arrivalAt);
      if (outbound && returning) appendSlices(slices, payload.tripId, destination.id, "activity", outbound.arrivalAt, returning.departureAt);
      if (returning) appendSlices(slices, payload.tripId, destination.id, "transit_return", returning.departureAt, returning.arrivalAt);
    }
    // Stable sorting preserves destination order when two destination transports describe the same transfer.
    slices.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    return ok(slices.map((slice, index) => ({ ...slice, order: index + 1 })));
  },
};
