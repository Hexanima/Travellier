import type { TripDestination } from "../entities/trip-destination.js";
import type { Transport } from "../entities/transport.js";
import type { TaggedError } from "../types/error.js";
import type { AsyncResult } from "../types/result.js";
import type { ObjectId } from "../value-objects/object-id.js";

export interface TripJourneyPort<TError extends TaggedError = TaggedError> {
  listDestinations: (tripId: ObjectId) => AsyncResult<TripDestination[], TError>;
  appendDestination: (destination: TripDestination) => AsyncResult<TripDestination | undefined, TError>;
  findDestination: (tripId: ObjectId, destinationId: ObjectId) => AsyncResult<TripDestination | undefined, TError>;
  updateDestination: (tripId: ObjectId, destinationId: ObjectId, update: { name?: string; order?: number }) => AsyncResult<TripDestination | undefined, TError>;
  listTransports: (tripId: ObjectId, destinationId: ObjectId) => AsyncResult<Transport[], TError>;
  insertTransport: (transport: Transport) => AsyncResult<Transport | undefined, TError>;
  replaceTransport: (transport: Transport) => AsyncResult<Transport | undefined, TError>;
}
