import { validateActivitySchedule } from "../../entities/activity-schedule.js";
import type { ItineraryDay, ItineraryDayDraft } from "../../entities/itinerary-day.js";
import { ItineraryConflictError } from "../../errors/itinerary-conflict-error.js";
import type { TripJourneyPort } from "../../ports/trip-journey-port.js";
import { err, type AsyncResult } from "../../types/result.js";
import type { ObjectId } from "../../value-objects/object-id.js";
import { generateItineraryDays } from "./generate-itinerary-days.js";

const identity = (day: ItineraryDay | ItineraryDayDraft) =>
  `${day.tripId}/${day.destinationId}/${day.date.getTime()}/${day.type}`;

/** Must run in the same unit of work as its triggering mutation. */
export const regenerateItinerary = async (journeys: TripJourneyPort, tripId: ObjectId,
  createId: () => ObjectId): AsyncResult<void> => {
  const destinations = await journeys.listDestinations(tripId);
  if (!destinations.ok) return destinations;
  const transports = await journeys.listTransports(tripId);
  if (!transports.ok) return transports;
  const generated = await generateItineraryDays.execute({}, { tripId, destinations: destinations.value, transports: transports.value });
  if (!generated.ok) return generated;
  const previous = await journeys.listItineraryDays(tripId);
  if (!previous.ok) return previous;
  const references = await journeys.listItineraryReferences(tripId);
  if (!references.ok) return references;
  const existing = new Map(previous.value.map((day) => [identity(day), day.id]));
  const days = generated.value.map((day) => ({ ...day, id: existing.get(identity(day)) ?? createId() }));
  const byId = new Map(days.map((day) => [day.id, day]));
  for (const post of references.value.posts) {
    if (!byId.has(post.dayId)) return err(new ItineraryConflictError());
  }
  for (const activity of references.value.activities) {
    const schedule = validateActivitySchedule({ ...activity, tripId }, days);
    if (!schedule.ok) {
      return err(new ItineraryConflictError());
    }
  }
  return journeys.replaceItineraryDays(tripId, days);
};
