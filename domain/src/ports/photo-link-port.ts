import type { AsyncResult } from "../types/result.js";

/** Reads which S3 keys are still linked to a photo (`postPhotos.s3Key`) in any Trip. */
export interface PhotoLinkPort {
  findLinkedKeys: (keys: readonly string[]) => AsyncResult<Set<string>>;
}
