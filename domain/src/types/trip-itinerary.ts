import type { Activity } from "../entities/activity.js";
import type { ItineraryDay } from "../entities/itinerary-day.js";
import type { Post } from "../entities/post.js";
import type { Transport } from "../entities/transport.js";
import type { TripDestination } from "../entities/trip-destination.js";
import type { Trip } from "../entities/trip.js";
import type { ObjectId } from "../value-objects/object-id.js";

/** Keep the read contract compatible while sharing the activity entity's fields. */
export type ItineraryActivity = Activity;

/** Transitional (T56): the itinerary only projects posts that still carry their legacy day. */
export type ItineraryPost = Omit<Post, "dayId"> & { dayId: ObjectId };

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
  /** Includes posts created without a day; the read model drops them until T56. */
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
}
