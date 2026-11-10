import type { TaggedError } from "../types/error.js";
import type { AsyncResult } from "../types/result.js";

export interface StoredObjectSummary {
  key: string;
  lastModified: Date;
  sizeBytes: number;
}

export interface ListObjectsInput {
  prefix: string;
  maxKeys: number;
  continuationToken?: string;
}

export interface ListObjectsPage {
  objects: StoredObjectSummary[];
  nextContinuationToken?: string;
}

/** Least-privilege storage access of the cleanup worker; kept apart from `ObjectStoragePort` (avatars, uploads, reads). */
export interface ObjectStorageCleanupPort<TError extends TaggedError = TaggedError> {
  /** `ok` also when the object does not exist. */
  deleteObject: (input: { objectKey: string }) => AsyncResult<void, TError>;
  listObjects: (input: ListObjectsInput) => AsyncResult<ListObjectsPage, TError>;
}
