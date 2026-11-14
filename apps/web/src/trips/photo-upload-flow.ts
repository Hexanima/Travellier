import type { DirectUpload } from "../api/direct-upload.js";
import { isTimeoutFailure } from "../api/index.js";
import { applyPhotoChange, type PhotoChange, type PhotoDraftItem } from "./post-draft.js";
import type { TripFailure } from "./trip-management-api.js";
import type { TripPhotoApi, UploadTarget } from "./trip-photo-api.js";

/** A reserved url that expires within this margin is replaced before the PUT. */
export const RESERVE_MARGIN_MS = 30_000;
/** Uploaded photos older than this are uploaded again: far from the 24 h after which the server may sweep unused keys. */
export const MAX_RESERVED_AGE_MS = 12 * 3_600_000;
export const UPLOAD_CONCURRENCY = 2;
/** `items` is the final state; `reserveError` stops the whole publication (revoked access, session, network); `aborted` means the signal fired. */
export type UploadReport = { items: PhotoDraftItem[]; reserveError?: TripFailure; aborted: boolean };
export type UploadPendingParams = { tripId: string; items: readonly PhotoDraftItem[]; blobs: { get: (localId: string) => Blob | undefined };
  api: Pick<TripPhotoApi, "reserve">; transfer: DirectUpload; now: () => number; signal?: AbortSignal;
  onProgress?: (localId: string, fraction: number) => void; onUpdate?: (localId: string, change: PhotoChange) => void };

export const needsUpload = (item: PhotoDraftItem, now: number) =>
  item.status !== "uploaded" || item.key === undefined || item.uploadedAt === undefined || now - item.uploadedAt > MAX_RESERVED_AGE_MS;
const descriptor = (item: PhotoDraftItem) => ({ contentType: item.contentType, sizeBytes: item.sizeBytes });
const fatal = (error: TripFailure) => error.kind === "not-found" || error.kind === "forbidden" || error.kind === "unauthorized";

/**
 * Uploads what is not yet uploaded: one reservation batch for every photo without a valid key (a failed photo always gets a new key; the
 * old one stays orphaned for the server sweep), then PUTs straight to S3 with limited concurrency. Each photo ends `uploaded` or `failed`:
 * one failure never cancels the others. Nothing here talks to the posts API.
 */
export const uploadPending = async ({ tripId, items, blobs, api, transfer, now, signal, onProgress, onUpdate }: UploadPendingParams): Promise<UploadReport> => {
  const result = [...items];
  let reserveError: TripFailure | undefined, sawAbort = false;
  const apply = (localId: string, change: PhotoChange) => {
    const index = result.findIndex((item) => item.localId === localId);
    if (index >= 0) result[index] = applyPhotoChange(result[index]!, change);
    onUpdate?.(localId, change);
  };
  const report = (): UploadReport => ({ items: result, ...(reserveError ? { reserveError } : {}), aborted: sawAbort || signal?.aborted === true });
  const candidates = items.filter((item) => needsUpload(item, now()));
  const pending: PhotoDraftItem[] = [];
  for (const item of candidates) {
    if (blobs.get(item.localId) === undefined) apply(item.localId, { status: "failed", failure: "missing" }); else pending.push(item);
  }
  if (pending.length === 0 || signal?.aborted) return report();
  const reserved = await api.reserve(tripId, pending.map(descriptor));
  if (!reserved.ok) {
    reserveError = reserved.error;
    for (const { field, code } of reserved.error.kind === "validation" ? reserved.error.fields ?? [] : []) {
      const index = Number(/^files\[(\d+)\]/.exec(field)?.[1] ?? NaN);
      if (pending[index]) apply(pending[index]!.localId, { status: "failed", failure: code ?? "invalid" });
    }
    return report();
  }
  const targets: UploadTarget[] = [...reserved.value];
  let next = 0;
  const worker = async () => {
    while (!signal?.aborted && reserveError === undefined) {
      const index = next; next += 1;
      const item = pending[index];
      if (!item) return;
      let target = targets[index]!;
      if (target.expiresAt - now() < RESERVE_MARGIN_MS) {
        const again = await api.reserve(tripId, [descriptor(item)]);
        if (!again.ok) {
          if (fatal(again.error)) reserveError = again.error; else apply(item.localId, { status: "failed", failure: isTimeoutFailure(again.error) ? "timeout" : again.error.kind });
          continue;
        }
        target = again.value[0]!;
      }
      const outcome = await transfer.put(target.uploadUrl, target.headers, blobs.get(item.localId)!, { signal, onProgress: (fraction) => onProgress?.(item.localId, fraction) });
      if (outcome.ok) apply(item.localId, { status: "uploaded", key: target.key, uploadedAt: now() });
      else if (outcome.code === "aborted") sawAbort = true;
      else apply(item.localId, { status: "failed", failure: outcome.code });
    }
  };
  await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, pending.length) }, worker));
  return report();
};
