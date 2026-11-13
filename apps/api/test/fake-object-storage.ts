import { err, ok, UnknownError, type CreateUploadTargetInput, type ObjectHead, type ObjectStoragePort } from "app-domain";

/**
 * In-memory stand-in for the private bucket: nothing here talks to AWS. `put` simulates the client uploading to a signed PUT URL;
 * every call made by the code under test is recorded.
 */
export class FakeObjectStorage implements ObjectStoragePort {
  objects = new Map<string, ObjectHead>();
  failHeadFor = new Set<string>();
  uploads: CreateUploadTargetInput[] = [];
  downloads: Array<{ objectKey: string; expiresInSeconds: number }> = [];
  heads: string[] = [];
  /** Runs right after each `headObject` answered (e.g. to change the world between the check and the save). */
  afterHead: (() => void | Promise<void>) | undefined;

  put(key: string, contentType: string | null = "image/jpeg", sizeBytes = 1000, lastModified: Date = new Date()) {
    this.objects.set(key, { contentType, sizeBytes, lastModified });
  }

  createUploadTarget: ObjectStoragePort["createUploadTarget"] = async (input) => {
    this.uploads.push(input);
    return ok({ uploadUrl: `https://s3.test/put/${input.objectKey}?expires=${input.expiresInSeconds}`,
      headers: { "content-type": input.contentType }, expiresAt: new Date("2026-11-09T10:15:00.000Z") });
  };
  createDownloadTarget: ObjectStoragePort["createDownloadTarget"] = async (input) => {
    this.downloads.push(input);
    return ok({ downloadUrl: `https://s3.test/get/${input.objectKey}?expires=${input.expiresInSeconds}` });
  };
  headObject: ObjectStoragePort["headObject"] = async ({ objectKey }) => {
    this.heads.push(objectKey);
    const failed = this.failHeadFor.has(objectKey), head = this.objects.get(objectKey);
    await this.afterHead?.();
    return failed ? err(new UnknownError("Unable to inspect stored object.")) : ok(head);
  };
}
