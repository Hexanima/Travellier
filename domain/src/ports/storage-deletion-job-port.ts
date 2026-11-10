import type { StorageDeletionJobStatus } from "../entities/storage-deletion-job.js";
import type { AsyncResult } from "../types/result.js";
import type { ObjectId } from "../value-objects/object-id.js";

export interface StorageDeletionJobClaim {
  id: ObjectId;
  tripId: ObjectId;
  objectKeys: string[];
  /** Keys already deleted (or found absent). */
  resolvedKeys: string[];
  /** Keys that do not belong to the job and were never deleted; they count as settled. */
  rejectedKeys: string[];
  /** Failed attempts so far (before this claim). */
  attempts: number;
}

export interface StorageDeletionJobRelease {
  now: Date;
  nextAttemptAt: Date;
  attempts: number;
  status: Extract<StorageDeletionJobStatus, "pending" | "failed">;
  lastErrorCode: string;
}

/**
 * Persistence of the cleanup jobs. Every write after `claimNext` is filtered by `leaseOwner`, so a worker whose lease expired
 * cannot overwrite the progress of the worker that reclaimed the job. A job is never deleted.
 */
export interface StorageDeletionJobPort {
  /** Atomically leases the next eligible job (`pending`, `nextAttemptAt <= now`, no live lease). */
  claimNext: (input: { now: Date; leaseUntil: Date; owner: string }) => AsyncResult<StorageDeletionJobClaim | undefined>;
  /** Adds keys to `resolvedKeys` / `rejectedKeys`; `false` when the lease is no longer ours. */
  recordResolved: (jobId: ObjectId, owner: string, input: { resolved: readonly string[]; rejected: readonly string[] }) => AsyncResult<boolean>;
  complete: (jobId: ObjectId, owner: string, now: Date) => AsyncResult<boolean>;
  releaseFailed: (jobId: ObjectId, owner: string, input: StorageDeletionJobRelease) => AsyncResult<boolean>;
}
