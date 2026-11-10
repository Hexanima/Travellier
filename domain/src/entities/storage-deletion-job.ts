import { PHOTO_UPLOAD_EXPIRES_SECONDS, parsePhotoUploadKey } from "./post-photo.js";
import type { ObjectId } from "../value-objects/object-id.js";

/** Lifecycle of a `storageDeletionJobs` document. A job is never deleted: it ends `completed` or `failed` (manual inspection). */
export type StorageDeletionJobStatus = "pending" | "completed" | "failed";

export const STORAGE_DELETION_MAX_ATTEMPTS = 10;
export const STORAGE_DELETION_LEASE_SECONDS = 120;
/** Orphaned uploads younger than this are never swept (a signed PUT lives 900 s; the margin covers a late confirmation). */
export const ABANDONED_UPLOAD_MIN_AGE_SECONDS = 86400;

/** Technical floor of the sweep age: the signed PUT lifetime plus one hour of margin for a late confirmation. */
export const ABANDONED_UPLOAD_FLOOR_SECONDS = PHOTO_UPLOAD_EXPIRES_SECONDS + 3600;

const RETRY_BASE_MS = 60_000;
const RETRY_MAX_MS = 6 * 60 * 60 * 1000;

/** Delay before the next attempt after `attempts` failed attempts: 1 min doubling, capped at 6 h. */
export const computeRetryDelay = (attempts: number): number => {
  const exponent = Math.max(0, Math.min(attempts - 1, 30));
  return Math.min(RETRY_BASE_MS * 2 ** exponent, RETRY_MAX_MS);
};

/** A job may only delete keys with the exact photo format that belong to its own Trip. */
export const isKeyOwnedByJob = (tripId: ObjectId, key: string): boolean => parsePhotoUploadKey(key)?.tripId === tripId;
