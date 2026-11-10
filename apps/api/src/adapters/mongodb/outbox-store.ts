import { ObjectId as MongoObjectId, type ClientSession, type Db } from "mongodb";
import { createObjectId, ok, TripNotFoundError,
  type AsyncResult, type NotificationScope, type ObjectId, type TripNotificationDraft } from "app-domain";

const objectIdPattern = /^[0-9a-f]{24}$/;

/** Ids in a payload are stored as ObjectId (24 hex strings only ever hold ids); Dates and numbers stay as they are. */
export const toStoredPayload = (value: unknown): unknown => {
  if (typeof value === "string") return objectIdPattern.test(value) ? new MongoObjectId(value) : value;
  if (Array.isArray(value)) return value.map(toStoredPayload);
  if (value instanceof Date || value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, toStoredPayload(inner)]));
};

/** Inverse of `toStoredPayload`: ObjectId back to the lowercase hex id of the domain. */
export const fromStoredPayload = (value: unknown): unknown => {
  if (value instanceof MongoObjectId) {
    const parsed = createObjectId(value.toHexString());
    if (!parsed.ok) throw parsed.error;
    return parsed.value;
  }
  if (Array.isArray(value)) return value.map(fromStoredPayload);
  if (value instanceof Date || value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, fromStoredPayload(inner)]));
};

/**
 * Outbox/inbox writes shared by every transactional scope that emits events (T91); always pass the transaction session.
 * `outboxEvents` holds one document per (event, recipient); a document is never consumed or changed once written.
 */
export const createOutboxStore = (database: Db, tripId: ObjectId, session: ClientSession): NotificationScope => {
  const mongoTripId = new MongoObjectId(tripId);
  const events = database.collection("outboxEvents");
  return {
    listMemberIds: async () => {
      const members = await database.collection<{ userId: MongoObjectId }>("tripMembers")
        .find({ tripId: mongoTripId }, { session, projection: { userId: 1 } }).sort({ _id: 1 }).toArray();
      return ok(members.map((member) => {
        const parsed = createObjectId(member.userId.toHexString());
        if (!parsed.ok) throw parsed.error;
        return parsed.value;
      }));
    },
    appendNotifications: async (drafts: readonly TripNotificationDraft[]): AsyncResult<void> => {
      if (drafts.some((draft) => draft.tripId !== tripId)) throw new TripNotFoundError();
      if (drafts.length === 0) return ok(undefined);
      // Upsert by key, never insert: a repeated key is ignored instead of aborting the transaction with a duplicate-key error.
      await events.bulkWrite(drafts.map((draft) => ({ updateOne: { filter: { eventKey: draft.eventKey }, upsert: true, update: { $setOnInsert: {
        tripId: mongoTripId, eventKey: draft.eventKey, type: draft.type, status: "pending", availableAt: draft.createdAt, createdAt: draft.createdAt,
        userId: new MongoObjectId(draft.userId), actorId: draft.actorId === null ? null : new MongoObjectId(draft.actorId),
        operationKey: draft.operationKey, payload: toStoredPayload(draft.payload),
      } } } })), { session });
      return ok(undefined);
    },
  };
};
