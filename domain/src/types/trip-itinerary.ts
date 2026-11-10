import type { Activity } from "../entities/activity.js";
import type { ItineraryDay } from "../entities/itinerary-day.js";
import type { Post } from "../entities/post.js";
import type { Transport } from "../entities/transport.js";
import type { TripDestination } from "../entities/trip-destination.js";
import type { Trip } from "../entities/trip.js";
import type { Currency } from "../value-objects/money.js";
import type { ObjectId } from "../value-objects/object-id.js";

/** Keep the read contract compatible while sharing the activity entity's fields. */
export type ItineraryActivity = Activity;

/** Where a memory is projected: its effective activity, its effective transport, or by its own publication. */
export type ItineraryPostPlacement = "activity" | "transport" | "independent";

/** Additive context: `parentPostId` is the real parent; the root fields come from walking the chain. */
export interface ItineraryPostContext {
  parentPostId: ObjectId | null;
  rootPostId: ObjectId;
  rootActivityId: ObjectId | null;
  rootTransportId: ObjectId | null;
  placement: ItineraryPostPlacement;
}

/** `dayId` is computed from the context (never the stored legacy one); it is null only for unplaced posts. */
export type ItineraryPost = Omit<Post, "dayId"> & { dayId: ObjectId; context: ItineraryPostContext };
export type UnplacedItineraryPost = Omit<ItineraryPost, "dayId"> & { dayId: null };

export interface ItineraryExpense {
  id: ObjectId;
  tripId: ObjectId;
  postId: ObjectId;
  totalAmount: number;
  /** Null for legacy records without a stored currency: never inferred. */
  currency: Currency | null;
  breakdown: string | null;
  paidBy: ObjectId | null;
  createdAt: Date;
}

export interface TripItinerarySnapshot {
  trip: Pick<Trip, "id" | "expenseMode">;
  destinations: TripDestination[];
  days: ItineraryDay[];
  transports: Transport[];
  activities: ItineraryActivity[];
  /** Includes posts created without a day; the read model projects them by context. */
  posts: Post[];
  expenses: ItineraryExpense[];
}

export type ItineraryItem = {
  kind: "transport" | "activity" | "post";
  id: ObjectId;
  at: Date;
};

/** Where an expense is attributed: its effective root activity day, or else its own publication. */
export type ItineraryExpenseSource = "activity" | "publication";

/**
 * Read-only attribution of one expense (1:1 with its post). `occurredAt` is the root activity `scheduledAt` or the post
 * `createdAt`; `publishedAt` is always the post `createdAt`. Both are UTC instants, never altered by the projection, so a
 * client can group them in its local zone. `dayId` is null only outside the itinerary. `amountCents` is null when the
 * stored amount is not a valid decimal (it then adds to no total).
 */
export interface ItineraryExpenseAttribution {
  expenseId: ObjectId;
  postId: ObjectId;
  rootPostId: ObjectId;
  source: ItineraryExpenseSource;
  rootActivityId: ObjectId | null;
  occurredAt: Date;
  publishedAt: Date;
  dayId: ObjectId | null;
  currency: Currency | null;
  amountCents: number | null;
}

export interface ItineraryCurrencyTotal { currency: Currency; totalCents: number; expenseCount: number }

/** Totals per currency in cents (fixed order ARS, EUR, USD; only currencies with expenses); never summed across currencies. */
export interface ItineraryExpenseTotals {
  byCurrency: ItineraryCurrencyTotal[];
  /** Expenses without a usable currency or amount: counted, but they add to no total. */
  withoutCurrency: { expenseCount: number };
}
export type ItineraryExpenseSummary = ItineraryExpenseTotals & { expenseCount: number };

export interface TripItinerary {
  tripId: ObjectId;
  expenseMode: Trip["expenseMode"];
  destinations: TripDestination[];
  days: (ItineraryDay & { items: ItineraryItem[]; expenseSummary: ItineraryExpenseSummary })[];
  transports: (Transport & { postIds: ObjectId[] })[];
  activities: (ItineraryActivity & { postIds: ObjectId[] })[];
  posts: (ItineraryPost & { expense: ItineraryExpense | null })[];
  /** Posts with no projectable day (published outside existing dates or in a Trip without itinerary). */
  unplacedPosts: (UnplacedItineraryPost & { expense: ItineraryExpense | null })[];
  /** Whole Trip: every day plus the expenses outside the itinerary (no double counting). */
  expenseSummary: ItineraryExpenseSummary & { outsideItinerary: ItineraryExpenseSummary };
  /** One entry per expense of the Trip, by `occurredAt` then id. */
  expenses: ItineraryExpenseAttribution[];
}
