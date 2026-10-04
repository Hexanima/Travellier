import type { TripDestination } from "../entities/trip-destination.js";
import type { ItineraryDay } from "../entities/itinerary-day.js";
import type { Transport } from "../entities/transport.js";
import type { TaggedError } from "../types/error.js";
import type { AsyncResult } from "../types/result.js";
import type { ObjectId } from "../value-objects/object-id.js";

export interface TripJourneyPort<TError extends TaggedError = TaggedError> {
  /** Re-reads on retry and rolls back every write when work returns an error. */
  withTransaction: <T>(tripId: ObjectId, work: (journeys: TripJourneyPort<TError>) => AsyncResult<T, TError>) => AsyncResult<T, TError>;
  listDestinations: (tripId: ObjectId) => AsyncResult<TripDestination[], TError>;
  appendDestination: (destination: TripDestination) => AsyncResult<TripDestination | undefined, TError>;
  findDestination: (tripId: ObjectId, destinationId: ObjectId) => AsyncResult<TripDestination | undefined, TError>;
  updateDestination: (tripId: ObjectId, destinationId: ObjectId, update: { name?: string; order?: number }) => AsyncResult<TripDestination | undefined, TError>;
  listTransports: (tripId: ObjectId, destinationId?: ObjectId) => AsyncResult<Transport[], TError>;
  findTransport: (tripId: ObjectId, destinationId: ObjectId, transportId: ObjectId) => AsyncResult<Transport | undefined, TError>;
  insertTransport: (transport: Transport) => AsyncResult<Transport | undefined, TError>;
  replaceTransport: (transport: Transport) => AsyncResult<Transport | undefined, TError>;
  listItineraryDays: (tripId: ObjectId) => AsyncResult<ItineraryDay[], TError>;
  listItineraryReferences: (tripId: ObjectId) => AsyncResult<{
    activities: { dayId: ObjectId; scheduledAt: Date }[];
    posts: { dayId: ObjectId }[];
  }, TError>;
  replaceItineraryDays: (tripId: ObjectId, days: ItineraryDay[]) => AsyncResult<void, TError>;
}
