import { ABANDONED_UPLOAD_FLOOR_SECONDS, ABANDONED_UPLOAD_MIN_AGE_SECONDS } from "../../entities/storage-deletion-job.js";
import { parsePhotoUploadKey } from "../../entities/post-photo.js";
import { ValidationError } from "../../errors/validation-error.js";
import type { ObjectStorageCleanupPort } from "../../ports/object-storage-cleanup-port.js";
import type { PhotoLinkPort } from "../../ports/photo-link-port.js";
import { err, ok, type Result } from "../../types/result.js";

export interface SweepAbandonedPhotoUploadsDeps {
  storage: ObjectStorageCleanupPort;
  links: PhotoLinkPort;
  now: () => Date;
  deadline: Date;
  maxPages: number;
  pageSize?: number;
  /** Default 24 h; values below `ABANDONED_UPLOAD_FLOOR_SECONDS` are rejected. */
  minAgeSeconds?: number;
}

/** Counters only: keys and raw errors are never reported. */
export interface AbandonedUploadSweepSummary {
  pages: number;
  scanned: number;
  deleted: number;
  keptRecent: number;
  keptLinked: number;
  ignored: number;
  listFailed: boolean;
  deleteFailed: number;
  /** The run stopped (deadline or `maxPages`) before the whole prefix was listed. */
  truncated: boolean;
}

const DEFAULT_PAGE_SIZE = 1000;

/**
 * Deletes uploads that were never attached to a photo: exact photo-key format only, older than the minimum age and not linked
 * in `postPhotos` (queried per page and again right before each delete). It also covers Trips already removed.
 * It keeps no cursor: every run starts from the beginning of the prefix.
 */
export const sweepAbandonedPhotoUploads = async (deps: SweepAbandonedPhotoUploadsDeps): Promise<Result<AbandonedUploadSweepSummary, ValidationError>> => {
  const minAgeSeconds = deps.minAgeSeconds ?? ABANDONED_UPLOAD_MIN_AGE_SECONDS;
  if (!Number.isFinite(minAgeSeconds) || minAgeSeconds < ABANDONED_UPLOAD_FLOOR_SECONDS) {
    return err(new ValidationError([{ field: "minAgeSeconds", code: "too_low", message: "Minimum age is below the signed upload lifetime plus margin." }]));
  }
  const summary: AbandonedUploadSweepSummary = { pages: 0, scanned: 0, deleted: 0, keptRecent: 0, keptLinked: 0, ignored: 0, listFailed: false, deleteFailed: 0, truncated: false };
  let token: string | undefined;

  for (;;) {
    if (summary.pages >= deps.maxPages || deps.now().getTime() >= deps.deadline.getTime()) { summary.truncated = true; break; }
    const page = await deps.storage.listObjects({ prefix: "trips/", maxKeys: deps.pageSize ?? DEFAULT_PAGE_SIZE,
      ...(token === undefined ? {} : { continuationToken: token }) });
    if (!page.ok) { summary.listFailed = true; break; }
    summary.pages += 1;
    const candidates: string[] = [];
    for (const object of page.value.objects) {
      summary.scanned += 1;
      if (parsePhotoUploadKey(object.key) === undefined) summary.ignored += 1;
      else if (deps.now().getTime() - object.lastModified.getTime() < minAgeSeconds * 1000) summary.keptRecent += 1;
      else candidates.push(object.key);
    }
    const linked = candidates.length > 0 ? await deps.links.findLinkedKeys(candidates) : undefined;
    if (linked?.ok) {
      for (const objectKey of candidates) {
        if (linked.value.has(objectKey)) { summary.keptLinked += 1; continue; }
        const recheck = await deps.links.findLinkedKeys([objectKey]);
        if (!recheck.ok) continue;
        if (recheck.value.has(objectKey)) { summary.keptLinked += 1; continue; }
        const deleted = await deps.storage.deleteObject({ objectKey });
        if (deleted.ok) summary.deleted += 1; else summary.deleteFailed += 1;
      }
    }
    token = page.value.nextContinuationToken;
    if (token === undefined) break;
  }
  return ok(summary);
};
