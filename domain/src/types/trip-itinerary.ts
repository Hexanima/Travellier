import type { Activity } from "../entities/activity.js";
import type { ItineraryDay } from "../entities/itinerary-day.js";
import type { Post } from "../entities/post.js";
import type { Transport } from "../entities/transport.js";
import type { TripDestination } from "../entities/trip-destination.js";
import type { Trip } from "../entities/trip.js";
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

export interface ItineraryExpenseSummary { totalAmount: number; expenseCount: number }

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
}
