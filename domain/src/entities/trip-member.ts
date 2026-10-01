import type { ObjectId } from "../value-objects/object-id.js";

export type TripRole = "admin" | "participant";

export interface TripMember {
  id: ObjectId;
  tripId: ObjectId;
  userId: ObjectId;
  role: TripRole;
  joinedAt: Date;
}

export interface TripMemberSummary {
  id: ObjectId;
  userId: ObjectId;
  name: string;
  role: TripRole;
  joinedAt: Date;
}
