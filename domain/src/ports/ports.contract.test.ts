import { describe, expect, it } from "vitest";

import { isOk, ok } from "../types/result.js";
import type {
  BaseEntity,
  NotificationPort,
  ObjectId,
  ObjectStorageCleanupPort,
  ObjectStoragePort,
  PersistencePort,
  PhotoLinkPort,
  StorageDeletionJobPort,
} from "../index.js";

interface TestEntity extends BaseEntity {
  name: string;
}

const id = "507f1f77bcf86cd799439011" as ObjectId;
const entity: TestEntity = { id, name: "Test" };

const persistencePort: PersistencePort<TestEntity> = {
  getOne: async () => ok(entity),
  getMany: async () =>
    ok({ data: [entity], total: 1, limit: 10, offset: 0, pages: 1 }),
  create: async () => ok(undefined),
  update: async () => ok(undefined),
  delete: async () => ok(undefined),
};

const objectStoragePort: ObjectStoragePort = {
  createUploadTarget: async () =>
    ok({
      uploadUrl: "https://uploads.example.test/photo.jpg",
      headers: { "content-type": "image/jpeg" },
      expiresAt: new Date("2026-09-14T12:00:00.000Z"),
    }),
  createDownloadTarget: async () => ok({ downloadUrl: "https://downloads.example.test/photo.jpg" }),
  headObject: async ({ objectKey }) => ok(objectKey.endsWith("missing.jpg") ? undefined : { contentType: "image/jpeg", sizeBytes: 1024 }),
};

const notificationPort: NotificationPort = {
  send: async () => ok(undefined),
};

describe("domain ports", () => {
  it("uses Result for persistence operations", async () => {
    const result = await persistencePort.getOne({});

    expect(isOk(result)).toBe(true);
  });

  it("uses Result for storage operations", async () => {
    const result = await objectStoragePort.createUploadTarget({
      objectKey: "trips/507f1f77bcf86cd799439011/posts/photo.jpg",
      contentType: "image/jpeg",
      expiresInSeconds: 300,
    });

    expect(isOk(result)).toBe(true);
  });

  it("reports an uploaded object or its absence through headObject", async () => {
    expect(await objectStoragePort.headObject({ objectKey: "trips/t/photos/u/photo.jpg" }))
      .toEqual({ ok: true, value: { contentType: "image/jpeg", sizeBytes: 1024 } });
    expect(await objectStoragePort.headObject({ objectKey: "trips/t/photos/u/missing.jpg" })).toEqual({ ok: true, value: undefined });
  });

  it("accepts an optional contentLength when signing an upload", async () => {
    const result = await objectStoragePort.createUploadTarget({ objectKey: "k.jpg", contentType: "image/jpeg", expiresInSeconds: 900, contentLength: 12 });
    expect(isOk(result)).toBe(true);
  });

  it("shapes the cleanup ports separately from ObjectStoragePort", async () => {
    const lastModified = new Date("2026-11-01T00:00:00.000Z");
    const cleanup: ObjectStorageCleanupPort = {
      deleteObject: async () => ok(undefined),
      listObjects: async ({ prefix, maxKeys, continuationToken }) =>
        ok({ objects: [{ key: `${prefix}k-${maxKeys}-${continuationToken ?? "first"}`, lastModified, sizeBytes: 3 }], nextContinuationToken: "next" }),
    };
    const links: PhotoLinkPort = { findLinkedKeys: async (keys) => ok(new Set(keys.slice(0, 1))) };
    const jobs: StorageDeletionJobPort = {
      claimNext: async () => ok({ id, tripId: id, objectKeys: ["a"], resolvedKeys: [], rejectedKeys: [], attempts: 0 }),
      recordResolved: async () => ok(true),
      complete: async () => ok(true),
      releaseFailed: async () => ok(false),
    };
    expect(await cleanup.deleteObject({ objectKey: "a" })).toEqual({ ok: true, value: undefined });
    expect(await cleanup.listObjects({ prefix: "trips/", maxKeys: 5, continuationToken: "t" })).toEqual({
      ok: true, value: { objects: [{ key: "trips/k-5-t", lastModified, sizeBytes: 3 }], nextContinuationToken: "next" } });
    expect(await links.findLinkedKeys(["a", "b"])).toEqual({ ok: true, value: new Set(["a"]) });
    const claim = await jobs.claimNext({ now: lastModified, leaseUntil: lastModified, owner: "o" });
    expect(claim).toEqual({ ok: true, value: { id, tripId: id, objectKeys: ["a"], resolvedKeys: [], rejectedKeys: [], attempts: 0 } });
    expect(await jobs.recordResolved(id, "o", { resolved: ["a"], rejected: [] })).toEqual({ ok: true, value: true });
    expect(await jobs.complete(id, "o", lastModified)).toEqual({ ok: true, value: true });
    expect(await jobs.releaseFailed(id, "o", { now: lastModified, nextAttemptAt: lastModified, attempts: 1, status: "pending", lastErrorCode: "x" }))
      .toEqual({ ok: true, value: false });
  });

  it("uses Result for notification operations", async () => {
    const result = await notificationPort.send({
      recipientIds: [id],
      title: "New post",
      body: "A member created a post.",
      data: { tripId: id },
    });

    expect(isOk(result)).toBe(true);
  });
});
