import { ObjectId as MongoObjectId, type Db } from "mongodb";
import { createObjectId, err, ok, UnknownError, type AsyncResult, type DispatchAudiencePort, type ObjectId, type PushDispatchClaim,
  type PushDispatchOutcome, type PushDispatchPort, type PushDispatchStatus, type TripNotificationType } from "app-domain";
import { fromStoredPayload } from "./outbox-store.js";

/**
 * `outboxEvents` document seen by the dispatcher. Documents of T91 only carry the first group; the dispatch fields are additive
 * and absent until the first claim (no attempts, no lease, nothing delivered).
 */
interface DispatchEventDocument {
  _id: MongoObjectId; tripId: MongoObjectId; userId: MongoObjectId; type: TripNotificationType; payload: Record<string, unknown>; createdAt: Date;
  status: PushDispatchStatus; availableAt: Date;
  attempts?: number; leaseUntil?: Date | null; leaseOwner?: string; lastAttemptAt?: Date; completedAt?: Date; outcome?: PushDispatchOutcome;
  lastErrorCode?: string; deliveredDeviceIds?: MongoObjectId[];
}

const domainId = (value: MongoObjectId): ObjectId => {
  const parsed = createObjectId(value.toHexString());
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};

/** Opaque errors: a driver message could echo a filter or the connection string. */
const guard = async <T>(work: () => Promise<T>): AsyncResult<T> => {
  try { return ok(await work()); } catch { return err(new UnknownError("Push dispatch database operation failed.")); }
};

const unsetLease = { leaseUntil: "" as const, leaseOwner: "" as const };

/**
 * Leased claims over `outboxEvents`. `availableAt` is the next attempt (it starts as `createdAt`), so the T91 index (status, availableAt)
 * serves the claim. After the claim every write is filtered by `_id` and `leaseOwner`; they answer `false` when the lease was lost.
 * This repository never inserts or deletes a document: the inbox reads the same documents and ignores the dispatch fields.
 */
export const createMongoPushDispatchRepository = (database: Db): PushDispatchPort => {
  const events = () => database.collection<DispatchEventDocument>("outboxEvents");
  return {
    claimNext: ({ now, leaseUntil, owner }) => guard(async () => {
      const claimed = await events().findOneAndUpdate(
        { status: "pending", availableAt: { $lte: now }, $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: null }, { leaseUntil: { $lte: now } }] },
        { $set: { leaseUntil, leaseOwner: owner, lastAttemptAt: now }, $inc: { attempts: 1 } },
        { sort: { availableAt: 1, _id: 1 }, returnDocument: "after" },
      );
      if (claimed === null) return undefined;
      return { id: domainId(claimed._id), type: claimed.type, tripId: domainId(claimed.tripId), userId: domainId(claimed.userId),
        payload: fromStoredPayload(claimed.payload), createdAt: claimed.createdAt, attempts: claimed.attempts ?? 1,
        deliveredDeviceIds: (claimed.deliveredDeviceIds ?? []).map(domainId) } as PushDispatchClaim;
    }),
    recordDelivered: (eventId, owner, deviceId) => guard(async () => {
      const result = await events().updateOne({ _id: new MongoObjectId(eventId), leaseOwner: owner }, { $addToSet: { deliveredDeviceIds: new MongoObjectId(deviceId) } });
      return result.matchedCount === 1;
    }),
    complete: (eventId, owner, { status, outcome, now }) => guard(async () => {
      const result = await events().updateOne({ _id: new MongoObjectId(eventId), leaseOwner: owner },
        { $set: { status, outcome, completedAt: now }, $unset: unsetLease });
      return result.matchedCount === 1;
    }),
    release: (eventId, owner, { nextAttemptAt, refundAttempt, status, lastErrorCode }) => guard(async () => {
      const result = await events().updateOne({ _id: new MongoObjectId(eventId), leaseOwner: owner },
        { $set: { status, availableAt: nextAttemptAt, lastErrorCode }, $unset: unsetLease, ...(refundAttempt === true ? { $inc: { attempts: -1 } } : {}) });
      return result.matchedCount === 1;
    }),
  };
};

/** Membership and Trip as they are at dispatch time. */
export const createMongoDispatchAudience = (database: Db): DispatchAudiencePort => ({
  isCurrentMember: (tripId, userId) => guard(async () =>
    await database.collection("tripMembers").countDocuments({ tripId: new MongoObjectId(tripId), userId: new MongoObjectId(userId) }, { limit: 1 }) > 0),
  tripExists: (tripId) => guard(async () => await database.collection("trips").countDocuments({ _id: new MongoObjectId(tripId) }, { limit: 1 }) > 0),
});
