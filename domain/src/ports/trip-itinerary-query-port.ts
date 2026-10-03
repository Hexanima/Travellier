import type { AsyncResult } from "../types/result.js";
import type { TaggedError } from "../types/error.js";
import type { TripItinerarySnapshot } from "../types/trip-itinerary.js";
import type { ObjectId } from "../value-objects/object-id.js";

export interface TripItineraryQueryPort<TError extends TaggedError = TaggedError> {
  /** Reads the Trip and its projection from one consistent, read-only snapshot. */
  read: (tripId: ObjectId) => AsyncResult<TripItinerarySnapshot | undefined, TError>;
}
