import { ObjectId as MongoObjectId, type Db } from "mongodb";
import { createObjectId, err, ok, UnknownError,
  type ObjectId, type TripNotificationPayloads, type TripNotificationType, type UserNotificationQueryPort, type UserNotificationView } from "app-domain";
import { fromStoredPayload } from "./outbox-store.js";

type NotificationDocument = { _id: MongoObjectId; tripId: MongoObjectId; userId: MongoObjectId; actorId: MongoObjectId | null;
  type: TripNotificationType; payload: Record<string, unknown>; createdAt: Date };

const domainId = (value: MongoObjectId): ObjectId => {
  const parsed = createObjectId(value.toHexString());
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};
const toView = (value: NotificationDocument): UserNotificationView => ({ id: domainId(value._id), type: value.type, tripId: domainId(value.tripId),
  actorId: value.actorId === null ? null : domainId(value.actorId), payload: fromStoredPayload(value.payload) as TripNotificationPayloads[TripNotificationType],
  createdAt: value.createdAt });

/**
 * Personal inbox over `outboxEvents` (T91). Read-only: it only runs `find`. Authorization is evaluated on every read from the current
 * memberships: a notice of a Trip the user does not belong to any more is hidden, except the one of their own expulsion.
 */
export const createMongoUserNotificationQueryRepository = (database: Db): UserNotificationQueryPort => ({
  listForUser: async ({ userId, limit, after }) => {
    try {
      const mongoUserId = new MongoObjectId(userId);
      const memberships = await database.collection<{ tripId: MongoObjectId }>("tripMembers")
        .find({ userId: mongoUserId }, { projection: { tripId: 1 } }).toArray();
      const authorized = { $or: [{ tripId: { $in: memberships.map((membership) => membership.tripId) } }, { type: "member.expelled" as TripNotificationType }] };
      const position = after === undefined ? [] : [{ $or: [{ createdAt: { $lt: new Date(after.createdAtMs) } },
        { createdAt: new Date(after.createdAtMs), _id: { $lt: new MongoObjectId(after.id) } }] }];
      const found = await database.collection<NotificationDocument>("outboxEvents")
        .find({ $and: [{ userId: mongoUserId }, authorized, ...position] }).sort({ createdAt: -1, _id: -1 }).limit(limit).toArray();
      return ok(found.map(toView));
    } catch {
      return err(new UnknownError("Notification database operation failed."));
    }
  },
});
