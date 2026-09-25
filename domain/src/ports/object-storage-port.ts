import type { TaggedError } from "../types/error.js";
import type { AsyncResult } from "../types/result.js";

export interface CreateUploadTargetInput {
  objectKey: string;
  contentType: string;
  expiresInSeconds: number;
}

export interface UploadTarget {
  uploadUrl: string;
  headers: Readonly<Record<string, string>>;
  expiresAt: Date;
}

export interface DownloadTarget {
  downloadUrl: string;
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
}
