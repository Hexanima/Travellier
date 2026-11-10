import { err, ok, UnknownError, type ObjectStorageCleanupPort } from "app-domain";

/** In-memory stand-in for the cleanup access to the private bucket: nothing here talks to AWS. S3 answers 204 when deleting an absent key. */
export class FakeCleanupStorage implements ObjectStorageCleanupPort {
  objects = new Map<string, { lastModified: Date; sizeBytes: number }>();
  deleted: string[] = [];
  deleteCalls = 0;
  failDeleteFor = new Set<string>();
  failAllDeletes = false;
  failList = false;
  pageSize = 1000;
  listCalls: Array<{ prefix: string; maxKeys: number; continuationToken?: string }> = [];
  /** Runs when a delete starts, before it is applied (e.g. to pause a worker). */
  beforeDelete: ((objectKey: string) => void | Promise<void>) | undefined;

  put(key: string, lastModified: Date, sizeBytes = 1000) { this.objects.set(key, { lastModified, sizeBytes }); }
  keys() { return [...this.objects.keys()].sort(); }

  deleteObject: ObjectStorageCleanupPort["deleteObject"] = async ({ objectKey }) => {
    this.deleteCalls += 1;
    await this.beforeDelete?.(objectKey);
    if (this.failAllDeletes || this.failDeleteFor.has(objectKey)) return err(new UnknownError("Unable to delete stored object."));
    this.objects.delete(objectKey);
    this.deleted.push(objectKey);
    return ok(undefined);
  };

  listObjects: ObjectStorageCleanupPort["listObjects"] = async (input) => {
    this.listCalls.push(input);
    if (this.failList) return err(new UnknownError("Unable to list stored objects."));
    // Like S3, the token is the last key of the previous page, so deleting while listing does not skip objects.
    const all = this.keys().filter((key) => key.startsWith(input.prefix) && (input.continuationToken === undefined || key > input.continuationToken));
    const page = all.slice(0, Math.min(input.maxKeys, this.pageSize));
    const objects = page.map((key) => ({ key, ...this.objects.get(key)! }));
    return ok(page.length < all.length ? { objects, nextContinuationToken: page[page.length - 1]! } : { objects });
  };
}
