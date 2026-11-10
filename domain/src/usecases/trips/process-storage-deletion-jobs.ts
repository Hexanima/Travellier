import {
  STORAGE_DELETION_LEASE_SECONDS,
  STORAGE_DELETION_MAX_ATTEMPTS,
  computeRetryDelay,
  isKeyOwnedByJob,
} from "../../entities/storage-deletion-job.js";
import type { ObjectStorageCleanupPort } from "../../ports/object-storage-cleanup-port.js";
import type { PhotoLinkPort } from "../../ports/photo-link-port.js";
import type { StorageDeletionJobClaim, StorageDeletionJobPort } from "../../ports/storage-deletion-job-port.js";
import { ok, type Result } from "../../types/result.js";

export interface ProcessStorageDeletionJobsDeps {
  jobs: StorageDeletionJobPort;
  storage: ObjectStorageCleanupPort;
  links: PhotoLinkPort;
  now: () => Date;
  createOwner: () => string;
  deadline: Date;
  maxJobs: number;
}

/** Counters only: keys and raw errors are never reported. */
export interface StorageDeletionRunSummary {
  processed: number;
  completed: number;
  /** Jobs released after at least one failed key in this run. */
  failed: number;
  /** Of `failed`, the jobs that reached the maximum attempts and stay `failed` for manual inspection. */
  exhausted: number;
  resolvedKeys: number;
  rejectedKeys: number;
  claimFailed: boolean;
}

const BATCH_SIZE = 25;

type JobOutcome = "completed" | "failed" | "exhausted" | "released" | "lease_lost";

const chunk = <T>(items: readonly T[], size: number): T[][] => {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) batches.push(items.slice(index, index + size));
  return batches;
};

/**
 * Processes the claimed jobs: deletes only the keys that belong to the job's Trip and are not linked to a photo, persists
 * progress by batch and completes the job when every key is settled. A job is never deleted and never touches the Trip.
 */
export const processStorageDeletionJobs = async (deps: ProcessStorageDeletionJobsDeps): Promise<Result<StorageDeletionRunSummary>> => {
  const summary: StorageDeletionRunSummary = { processed: 0, completed: 0, failed: 0, exhausted: 0, resolvedKeys: 0, rejectedKeys: 0, claimFailed: false };
  const expired = () => deps.now().getTime() >= deps.deadline.getTime();

  const processJob = async (claim: StorageDeletionJobClaim, owner: string): Promise<JobOutcome> => {
    const settled = new Set([...claim.resolvedKeys, ...claim.rejectedKeys]);
    const pending = [...new Set(claim.objectKeys)].filter((objectKey) => !settled.has(objectKey));
    let failures = 0, errorCode = "", timedOut = false;
    const fail = (code: string) => { failures += 1; errorCode ||= code; };

    for (const batch of chunk(pending, BATCH_SIZE)) {
      const resolved: string[] = [], rejected: string[] = [];
      const owned = batch.filter((objectKey) => {
        if (isKeyOwnedByJob(claim.tripId, objectKey)) return true;
        rejected.push(objectKey);
        return false;
      });
      const linked = await deps.links.findLinkedKeys(owned);
      if (!linked.ok) {
        owned.forEach(() => fail("link_check_failed"));
      } else {
        for (const objectKey of owned) {
          if (linked.value.has(objectKey)) { rejected.push(objectKey); continue; }
          if (expired()) { timedOut = true; break; }
          const deleted = await deps.storage.deleteObject({ objectKey });
          if (deleted.ok) resolved.push(objectKey); else fail("delete_failed");
        }
      }
      if (resolved.length > 0 || rejected.length > 0) {
        const saved = await deps.jobs.recordResolved(claim.id, owner, { resolved, rejected });
        if (!saved.ok) { fail("progress_not_saved"); break; }
        if (!saved.value) return "lease_lost";
        summary.resolvedKeys += resolved.length;
        summary.rejectedKeys += rejected.length;
      }
      if (timedOut) break;
    }

    const now = deps.now();
    if (failures === 0 && !timedOut) {
      const done = await deps.jobs.complete(claim.id, owner, now);
      if (!done.ok) {
        await deps.jobs.releaseFailed(claim.id, owner, { now, nextAttemptAt: new Date(now.getTime() + computeRetryDelay(claim.attempts + 1)),
          attempts: claim.attempts + 1, status: "pending", lastErrorCode: "complete_failed" });
        return "failed";
      }
      return done.value ? "completed" : "lease_lost";
    }
    if (failures === 0) {
      const released = await deps.jobs.releaseFailed(claim.id, owner, { now, nextAttemptAt: now, attempts: claim.attempts, status: "pending", lastErrorCode: "deadline" });
      return released.ok && !released.value ? "lease_lost" : "released";
    }
    const attempts = claim.attempts + 1, exhausted = attempts >= STORAGE_DELETION_MAX_ATTEMPTS;
    const released = await deps.jobs.releaseFailed(claim.id, owner, { now, nextAttemptAt: new Date(now.getTime() + computeRetryDelay(attempts)),
      attempts, status: exhausted ? "failed" : "pending", lastErrorCode: errorCode });
    if (released.ok && !released.value) return "lease_lost";
    return exhausted ? "exhausted" : "failed";
  };

  while (summary.processed < deps.maxJobs && !expired()) {
    const now = deps.now(), owner = deps.createOwner();
    const claimed = await deps.jobs.claimNext({ now, leaseUntil: new Date(now.getTime() + STORAGE_DELETION_LEASE_SECONDS * 1000), owner });
    if (!claimed.ok) { summary.claimFailed = true; break; }
    if (claimed.value === undefined) break;
    summary.processed += 1;
    let outcome: JobOutcome;
    try {
      outcome = await processJob(claimed.value, owner);
    } catch {
      outcome = "failed";
    }
    if (outcome === "completed") summary.completed += 1;
    if (outcome === "failed" || outcome === "exhausted") summary.failed += 1;
    if (outcome === "exhausted") summary.exhausted += 1;
  }
  return ok(summary);
};
