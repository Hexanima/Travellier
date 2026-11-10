import type { AsyncResult } from "../types/result.js";
import type { TaggedError } from "../types/error.js";
import type { TripBalanceSnapshot } from "../types/trip-balance.js";
import type { ObjectId } from "../value-objects/object-id.js";

export interface TripBalanceQueryPort<TError extends TaggedError = TaggedError> {
  /**
   * Reads the Trip, its current members and the expenses of posts that exist in the Trip from one consistent, read-only
   * snapshot. Expenses whose post is not in the Trip are not returned. Undefined when the Trip does not exist.
   */
  read: (tripId: ObjectId) => AsyncResult<TripBalanceSnapshot | undefined, TError>;
}
