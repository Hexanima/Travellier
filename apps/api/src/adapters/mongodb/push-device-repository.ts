import { ObjectId as MongoObjectId, type Db } from "mongodb";
import { createObjectId, err, ok, TaggedError, UnknownError, type AsyncResult, type ObjectId, type PushDevice,
  type PushDeviceRepository, type PushPlatform, type PushProvider } from "app-domain";

/** `pushDevices` document. `token` is the raw provider token: it is never logged nor placed in an error. */
export interface PushDeviceDocument {
  _id: MongoObjectId; userId: MongoObjectId; provider: PushProvider; platform: PushPlatform; token: string;
  createdAt: Date; updatedAt: Date; lastRegisteredAt: Date;
}

const DUPLICATE_KEY = 11000;
const MAX_ATTEMPTS = 3;

const domainId = (value: MongoObjectId): ObjectId => {
  const parsed = createObjectId(value.toHexString());
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};

const toDevice = (document: PushDeviceDocument): PushDevice => ({
  id: domainId(document._id), userId: domainId(document.userId), provider: document.provider, platform: document.platform, token: document.token,
  createdAt: document.createdAt, updatedAt: document.updatedAt, lastRegisteredAt: document.lastRegisteredAt,
});

const isDuplicateKey = (error: unknown): boolean => typeof error === "object" && error !== null && (error as { code?: unknown }).code === DUPLICATE_KEY;

/** Domain errors pass through; anything else becomes an opaque error: driver messages could echo the filter and so the token. */
const guard = async <T>(work: () => Promise<T>): AsyncResult<T> => {
  try { return ok(await work()); } catch (error) {
    return err(error instanceof TaggedError ? error : new UnknownError("Database operation failed."));
  }
};

/**
 * Registration runs in a short transaction and upserts by (provider, token), so a token never belongs to two accounts. The limit only applies
 * to a NEW document: when the user already has `limit` devices, the oldest own ones (lowest lastRegisteredAt, ties by _id) are evicted in the
 * same transaction. A reassignment (the token exists under another user) or a re-registration never counts nor evicts. The limit is soft:
 * simultaneous registrations of distinct new tokens do not conflict and can exceed it; the next registration converges by evicting the excess.
 * A duplicate-key race between two upserts is retried.
 */
export const createMongoPushDeviceRepository = (database: Db): PushDeviceRepository => {
  const registerOnce = async ({ userId, provider, platform, token, now, limit }: Parameters<PushDeviceRepository["register"]>[0]) => {
    const devices = database.collection<PushDeviceDocument>("pushDevices");
    const owner = new MongoObjectId(userId);
    const session = database.client.startSession();
    try {
      return await session.withTransaction(async () => {
        const existing = await devices.findOne({ provider, token }, { session, projection: { userId: 1 } });
        if (existing === null) {
          const count = await devices.countDocuments({ userId: owner }, { session });
          if (count >= limit) {
            const oldest = await devices.find({ userId: owner }, { session, projection: { _id: 1 } })
              .sort({ lastRegisteredAt: 1, _id: 1 }).limit(count - limit + 1).toArray();
            await devices.deleteMany({ _id: { $in: oldest.map((doc) => doc._id) } }, { session });
          }
        }
        const result = await devices.findOneAndUpdate({ provider, token },
          { $set: { userId: owner, platform, updatedAt: now, lastRegisteredAt: now }, $setOnInsert: { createdAt: now } },
          { upsert: true, returnDocument: "after", includeResultMetadata: true, session });
        if (result.value === null) throw new UnknownError("Database operation failed.");
        return { device: toDevice(result.value), created: result.lastErrorObject?.updatedExisting === false };
      }, { readPreference: "primary" });
    } finally { await session.endSession(); }
  };

  return {
    register: (input) => guard(async () => {
      for (let attempt = 1; ; attempt += 1) {
        try {
          const registered = await registerOnce(input);
          if (registered === undefined) throw new UnknownError("Database operation failed.");
          return registered;
        } catch (error) {
          if (!isDuplicateKey(error) || attempt >= MAX_ATTEMPTS) throw error;
        }
      }
    }),
    revokeById: (userId, id) => guard(async () => {
      await database.collection<PushDeviceDocument>("pushDevices").deleteOne({ _id: new MongoObjectId(id), userId: new MongoObjectId(userId) });
    }),
    revokeByToken: (userId, provider, token) => guard(async () => {
      await database.collection<PushDeviceDocument>("pushDevices").deleteOne({ provider, token, userId: new MongoObjectId(userId) });
    }),
    removeInvalid: (provider, tokens) => guard(async () => {
      if (tokens.length === 0) return 0;
      const result = await database.collection<PushDeviceDocument>("pushDevices").deleteMany({ provider, token: { $in: [...tokens] } });
      return result.deletedCount;
    }),
  };
};
