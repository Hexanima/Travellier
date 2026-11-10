import { ObjectId as MongoObjectId, type Db } from "mongodb";
import { createObjectId, err, ok, UnknownError, type AsyncResult, type ObjectId, type StorageDeletionJobPort,
  type StorageDeletionJobStatus } from "app-domain";

/** `storageDeletionJobs` document; legacy jobs only carry `tripId`, `objectKeys` and `createdAt` until migration 0005. */
export interface StorageDeletionJobDocument {
  _id: MongoObjectId; tripId: MongoObjectId; objectKeys: string[]; createdAt: Date;
  status?: StorageDeletionJobStatus; attempts?: number; resolvedKeys?: string[]; rejectedKeys?: string[]; nextAttemptAt?: Date;
  leaseUntil?: Date | null; leaseOwner?: string; lastAttemptAt?: Date; completedAt?: Date; lastErrorCode?: string;
}

const domainId = (value: MongoObjectId): ObjectId => {
  const parsed = createObjectId(value.toHexString());
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};

const guard = async <T>(work: () => Promise<T>): AsyncResult<T> => {
  try { return ok(await work()); } catch { return err(new UnknownError("Storage deletion job operation failed.")); }
};

/** Claims are atomic and leased; writes are filtered by `leaseOwner`. No Trip lock: the Trip is already gone, so cleanup never blocks a deletion. */
export const createMongoStorageDeletionJobRepository = (database: Db): StorageDeletionJobPort => {
  const jobs = database.collection<StorageDeletionJobDocument>("storageDeletionJobs");
  const unsetLease = { leaseUntil: "" as const, leaseOwner: "" as const };
  return {
    claimNext: ({ now, leaseUntil, owner }) => guard(async () => {
      const claimed = await jobs.findOneAndUpdate(
        { status: "pending", nextAttemptAt: { $lte: now }, $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: null }, { leaseUntil: { $lte: now } }] },
        { $set: { leaseUntil, leaseOwner: owner, lastAttemptAt: now } },
        { sort: { nextAttemptAt: 1 }, returnDocument: "after" },
      );
      if (claimed === null) return undefined;
      return { id: domainId(claimed._id), tripId: domainId(claimed.tripId), objectKeys: claimed.objectKeys, resolvedKeys: claimed.resolvedKeys ?? [],
        rejectedKeys: claimed.rejectedKeys ?? [], attempts: claimed.attempts ?? 0 };
    }),
    recordResolved: (jobId, owner, { resolved, rejected }) => guard(async () => {
      const result = await jobs.updateOne({ _id: new MongoObjectId(jobId), leaseOwner: owner },
        { $addToSet: { resolvedKeys: { $each: [...resolved] }, rejectedKeys: { $each: [...rejected] } } });
      return result.matchedCount === 1;
    }),
    complete: (jobId, owner, now) => guard(async () => {
      const result = await jobs.updateOne({ _id: new MongoObjectId(jobId), leaseOwner: owner },
        { $set: { status: "completed", completedAt: now }, $unset: unsetLease });
      return result.matchedCount === 1;
    }),
    releaseFailed: (jobId, owner, input) => guard(async () => {
      const result = await jobs.updateOne({ _id: new MongoObjectId(jobId), leaseOwner: owner },
        { $set: { status: input.status, attempts: input.attempts, nextAttemptAt: input.nextAttemptAt, lastErrorCode: input.lastErrorCode, lastAttemptAt: input.now },
          $unset: unsetLease });
      return result.matchedCount === 1;
    }),
  };
};
