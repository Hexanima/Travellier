import { ObjectId as MongoObjectId } from "mongodb";
import { createObjectId, type Activity, type ObjectId } from "app-domain";

export type ActivityDocument = Omit<Activity, "id" | "tripId" | "dayId" | "createdBy" | "durationMinutes"> & {
  _id: MongoObjectId; tripId: MongoObjectId; dayId: MongoObjectId; createdBy: MongoObjectId;
  /** Absent in documents written before durations existed. */
  durationMinutes?: number | null;
};
const domainId = (value: MongoObjectId): ObjectId => {
  const parsed = createObjectId(value.toHexString());
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};
export const toActivity = (value: ActivityDocument): Activity => ({ id: domainId(value._id), tripId: domainId(value.tripId),
  dayId: domainId(value.dayId), title: value.title, description: value.description, scheduledAt: value.scheduledAt,
  durationMinutes: value.durationMinutes ?? null, mapsUrl: value.mapsUrl, createdBy: domainId(value.createdBy), createdAt: value.createdAt });
export const toActivityDocument = (value: Activity): ActivityDocument => ({ _id: new MongoObjectId(value.id), tripId: new MongoObjectId(value.tripId),
  dayId: new MongoObjectId(value.dayId), title: value.title, description: value.description, scheduledAt: value.scheduledAt,
  durationMinutes: value.durationMinutes, mapsUrl: value.mapsUrl, createdBy: new MongoObjectId(value.createdBy), createdAt: value.createdAt });
