import type { ClientSession, Db, ObjectId as MongoObjectId } from "mongodb";

/**
 * Records one pending `storageDeletionJobs` document for these object keys inside the caller's transaction, so the cleanup intent exists
 * exactly when the records that referenced the objects are gone. S3 cleanup belongs to the storage deletion worker, never to the transaction.
 * Duplicates and empty keys are dropped; nothing is inserted when no key is left.
 */
export const enqueueStorageDeletionJob = async (database: Db, tripId: MongoObjectId, keys: readonly string[], createdAt: Date,
  session: ClientSession): Promise<void> => {
  const objectKeys = [...new Set(keys.filter((key) => key !== ""))];
  if (objectKeys.length === 0) return;
  await database.collection("storageDeletionJobs").insertOne({ tripId, objectKeys, createdAt, status: "pending",
    attempts: 0, resolvedKeys: [], rejectedKeys: [], nextAttemptAt: createdAt }, { session });
};
