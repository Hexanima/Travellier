import type { ObjectId } from "../value-objects/object-id.js";

export type ItineraryDayType = "transit_out" | "activity" | "transit_return" | "arrival";

export interface ItineraryDay {
  id: ObjectId;
  tripId: ObjectId;
  destinationId: ObjectId;
  date: Date;
  type: ItineraryDayType;
  startsAt: Date;
  endsAt: Date | null;
  order: number;
}

/** Automatically derived projection; persistence assigns the ObjectId in T32. */
export type ItineraryDayDraft = Omit<ItineraryDay, "id" | "endsAt"> & { endsAt: Date };
