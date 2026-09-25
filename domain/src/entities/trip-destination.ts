import type { ObjectId } from "../value-objects/object-id.js";

export interface TripDestination {
  id: ObjectId;
  tripId: ObjectId;
  name: string;
  order: number;
  createdAt: Date;
}
