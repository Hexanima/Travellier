import type { ObjectId } from "../value-objects/object-id.js";

/** `arrival` is retained from the PRD schema; no generation rule is currently defined for it. */
export type ItineraryDayType = "transit_out" | "activity" | "transit_return" | "arrival";

export interface ItineraryDay {
  id: ObjectId;
  tripId: ObjectId;
  destinationId: ObjectId;
  /** Midnight UTC for the canonical day; UI calendar grouping uses the exact interval in the user's timezone. */
  date: Date;
  type: ItineraryDayType;
  startsAt: Date;
  endsAt: Date | null;
  order: number;
}

/** Automatically derived projection; persistence assigns the ObjectId in T32. */
export type ItineraryDayDraft = Omit<ItineraryDay, "id" | "endsAt"> & { endsAt: Date };
