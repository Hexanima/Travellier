import type { TaggedError } from "../types/error.js";
import type { AsyncResult } from "../types/result.js";

export interface CreateUploadTargetInput {
  objectKey: string;
  contentType: string;
  expiresInSeconds: number;
  /** Optional: signs the exact size of the upload (S3 rejects a PUT with another Content-Length). */
  contentLength?: number;
}

export interface UploadTarget {
  uploadUrl: string;
  headers: Readonly<Record<string, string>>;
  expiresAt: Date;
}

export interface DownloadTarget {
  downloadUrl: string;
}

/** What the storage holds for an object; `contentType` is `null` when it was stored without one. */
export interface ObjectHead {
  contentType: string | null;
  sizeBytes: number;
}

export interface ObjectStoragePort<
  TError extends TaggedError = TaggedError,
> {
  createUploadTarget: (
    input: CreateUploadTargetInput,
  ) => AsyncResult<UploadTarget, TError>;
  createDownloadTarget: (
    input: { objectKey: string; expiresInSeconds: number },
  ) => AsyncResult<DownloadTarget, TError>;
  /** Metadata of an uploaded object; `ok(undefined)` when it does not exist, `err` for any other failure. */
  headObject: (
    input: { objectKey: string },
  ) => AsyncResult<ObjectHead | undefined, TError>;
}
