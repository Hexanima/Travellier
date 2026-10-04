import type { Activity } from "../entities/activity.js";
import type { ItineraryDay } from "../entities/itinerary-day.js";
import type { Transport } from "../entities/transport.js";
import type { TripDestination } from "../entities/trip-destination.js";
import type { Trip } from "../entities/trip.js";
import type { ObjectId } from "../value-objects/object-id.js";

/** Keep the read contract compatible while sharing the activity entity's fields. */
export type ItineraryActivity = Activity;

export interface ItineraryPost {
  id: ObjectId;
  tripId: ObjectId;
  dayId: ObjectId;
  authorId: ObjectId;
  description: string | null;
  mapsUrl: string | null;
  activityId: ObjectId | null;
  transportId: ObjectId | null;
  parentPostId: ObjectId | null;
  createdAt: Date;
}

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
  trip: Pick<Trip, "id" | "expenseMode" | "votingEnabled">;
  destinations: TripDestination[];
  days: ItineraryDay[];
  transports: Transport[];
  activities: ItineraryActivity[];
  posts: ItineraryPost[];
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
  votingEnabled: boolean;
  destinations: TripDestination[];
  days: (ItineraryDay & { items: ItineraryItem[]; expenseSummary: ItineraryExpenseSummary })[];
  transports: (Transport & { postIds: ObjectId[] })[];
  activities: (ItineraryActivity & { postIds: ObjectId[] })[];
  posts: (ItineraryPost & { expense: ItineraryExpense | null })[];
}
