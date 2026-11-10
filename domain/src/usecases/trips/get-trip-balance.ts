import { calculateTripBalance } from "../../entities/expense-balance.js";
import { TripNotFoundError } from "../../errors/trip-not-found-error.js";
import type { TripBalanceQueryPort } from "../../ports/trip-balance-query-port.js";
import { err, ok } from "../../types/result.js";
import type { TripBalance } from "../../types/trip-balance.js";
import type { TaggedError } from "../../types/error.js";
import type { UseCase } from "../../types/usecase.js";
import type { ObjectId } from "../../value-objects/object-id.js";

export interface GetTripBalancePayload { tripId: ObjectId; authenticatedUserId: ObjectId }
export interface GetTripBalanceDependencies { balance: TripBalanceQueryPort }

/**
 * Read-only. Authorization is decided with the members of the same snapshot the balance is computed from, so a non-member
 * (or a missing Trip) is indistinguishable and never sees amounts. Nothing is written: editing or changing the mode only
 * changes what this recomputes.
 */
export const getTripBalance: UseCase<GetTripBalanceDependencies, GetTripBalancePayload, TripBalance, TaggedError> = {
  execute: async ({ balance }, { tripId, authenticatedUserId }) => {
    const read = await balance.read(tripId);
    if (!read.ok) return read;
    const snapshot = read.value;
    if (snapshot === undefined || snapshot.trip.id !== tripId || !snapshot.memberIds.includes(authenticatedUserId)) return err(new TripNotFoundError());
    return ok(calculateTripBalance({ tripId, expenseMode: snapshot.trip.expenseMode, memberIds: snapshot.memberIds,
      expenses: snapshot.expenses.filter((expense) => expense.tripId === tripId) }));
  },
};
