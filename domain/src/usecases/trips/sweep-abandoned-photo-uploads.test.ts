import { describe, expect, it } from "vitest";

import { ABANDONED_UPLOAD_MIN_AGE_SECONDS, ABANDONED_UPLOAD_FLOOR_SECONDS } from "../../entities/storage-deletion-job.js";
import { createPhotoUploadKey, PHOTO_UPLOAD_EXPIRES_SECONDS } from "../../entities/post-photo.js";
import { UnknownError } from "../../errors/unknown-error.js";
import type { ObjectStorageCleanupPort, StoredObjectSummary } from "../../ports/object-storage-cleanup-port.js";
import type { PhotoLinkPort } from "../../ports/photo-link-port.js";
import { err, ok } from "../../types/result.js";
import { createObjectId, type ObjectId } from "../../value-objects/object-id.js";
import { sweepAbandonedPhotoUploads, type SweepAbandonedPhotoUploadsDeps } from "./sweep-abandoned-photo-uploads.js";

const id = (value: string): ObjectId => {
  const result = createObjectId(value);
  if (!result.ok) throw new Error("bad id");
  return result.value;
};
const trip = id("507f1f77bcf86cd799439011"), user = id("507f1f77bcf86cd799439013");
const key = (n: number): string => createPhotoUploadKey({ tripId: trip, userId: user, extension: "jpg", uploadId: `123e4567-e89b-42d3-a456-${String(n).padStart(12, "0")}` });
const NOW = new Date("2026-11-10T12:00:00.000Z");
const ago = (seconds: number): Date => new Date(NOW.getTime() - seconds * 1000);
const OLD = ABANDONED_UPLOAD_MIN_AGE_SECONDS + 60;
const object = (objectKey: string, age: number): StoredObjectSummary => ({ key: objectKey, lastModified: ago(age), sizeBytes: 10 });

interface Options {
  pages: StoredObjectSummary[][];
  linked?: string[];
  failListAt?: number;
  failDelete?: (objectKey: string) => boolean;
  links?: PhotoLinkPort;
  over?: Partial<SweepAbandonedPhotoUploadsDeps>;
}

const setup = (options: Options) => {
  const deleted: string[] = [], listCalls: { prefix: string; maxKeys: number; continuationToken?: string }[] = [];
  const linked = new Set(options.linked ?? []);
  const storage: ObjectStorageCleanupPort = {
    deleteObject: async ({ objectKey }) => {
      if (options.failDelete?.(objectKey)) return err(new UnknownError("secret"));
      deleted.push(objectKey);
      return ok(undefined);
    },
    listObjects: async (input) => {
      listCalls.push(input);
      const index = input.continuationToken === undefined ? 0 : Number(input.continuationToken);
      if (options.failListAt === index) return err(new UnknownError("secret"));
      const objects = options.pages[index] ?? [];
      return ok(index + 1 < options.pages.length ? { objects, nextContinuationToken: String(index + 1) } : { objects });
    },
  };
  const links: PhotoLinkPort = options.links ?? { findLinkedKeys: async (keys) => ok(new Set(keys.filter((k) => linked.has(k)))) };
  const deps: SweepAbandonedPhotoUploadsDeps = { storage, links, now: () => NOW, deadline: new Date(NOW.getTime() + 45_000), maxPages: 10, ...options.over };
  return { deps, deleted, listCalls, linked };
};

describe("sweepAbandonedPhotoUploads", () => {
  it("deletes an old orphan, lists the trips/ prefix and reports counters only", async () => {
    const ctx = setup({ pages: [[object(key(1), OLD)]] });
    const result = await sweepAbandonedPhotoUploads(ctx.deps);
    expect(result).toEqual({ ok: true, value: { pages: 1, scanned: 1, deleted: 1, keptRecent: 0, keptLinked: 0, ignored: 0, listFailed: false, deleteFailed: 0, truncated: false } });
    expect(ctx.deleted).toEqual([key(1)]);
    expect(ctx.listCalls).toEqual([{ prefix: "trips/", maxKeys: 1000 }]);
  });

  it("keeps recent objects including the exact age boundary, and deletes at the boundary plus one second", async () => {
    const exact = ABANDONED_UPLOAD_MIN_AGE_SECONDS;
    const ctx = setup({ pages: [[object(key(1), exact - 1), object(key(2), exact), object(key(3), exact + 1)]] });
    const result = await sweepAbandonedPhotoUploads(ctx.deps);
    expect(result).toMatchObject({ ok: true, value: { deleted: 2, keptRecent: 1 } });
    expect(ctx.deleted).toEqual([key(2), key(3)]);
  });

  it("keeps an old object still linked to a photo", async () => {
    const ctx = setup({ pages: [[object(key(1), OLD), object(key(2), OLD)]], linked: [key(1)] });
    const result = await sweepAbandonedPhotoUploads(ctx.deps);
    expect(result).toMatchObject({ ok: true, value: { deleted: 1, keptLinked: 1 } });
    expect(ctx.deleted).toEqual([key(2)]);
  });

  it("ignores and never deletes keys outside the exact photo format", async () => {
    const foreign = [`avatars/${user}.jpg`, `trips/${trip}/photo.jpg`, `trips/${trip}/photos/${user}/../x.jpg`, `trips/${trip}/photos/${user}/not-a-uuid.jpg`, "trips/"];
    const ctx = setup({ pages: [[...foreign.map((k) => object(k, OLD * 10)), object(key(1), OLD)]] });
    const result = await sweepAbandonedPhotoUploads(ctx.deps);
    expect(result).toMatchObject({ ok: true, value: { scanned: 6, ignored: 5, deleted: 1 } });
    expect(ctx.deleted).toEqual([key(1)]);
  });

  it("follows pagination with the continuation token and stops at maxPages", async () => {
    const pages = [[object(key(1), OLD)], [object(key(2), OLD)], [object(key(3), OLD)]];
    const all = setup({ pages });
    expect(await sweepAbandonedPhotoUploads(all.deps)).toMatchObject({ ok: true, value: { pages: 3, deleted: 3, truncated: false } });
    expect(all.listCalls.map((c) => c.continuationToken)).toEqual([undefined, "1", "2"]);
    const limited = setup({ pages, over: { maxPages: 2 } });
    expect(await sweepAbandonedPhotoUploads(limited.deps)).toMatchObject({ ok: true, value: { pages: 2, deleted: 2, truncated: true } });
    expect(limited.deleted).toEqual([key(1), key(2)]);
  });

  it("stops listing when the deadline has passed", async () => {
    const ctx = setup({ pages: [[object(key(1), OLD)]], over: { deadline: NOW } });
    expect(await sweepAbandonedPhotoUploads(ctx.deps)).toMatchObject({ ok: true, value: { pages: 0, deleted: 0, truncated: true } });
    expect(ctx.listCalls).toEqual([]);
  });

  it("rechecks the link right before deleting: a link that appears after the page query is not deleted", async () => {
    let calls = 0;
    const ctx = setup({ pages: [[object(key(1), OLD), object(key(2), OLD)]] });
    ctx.deps.links = { findLinkedKeys: async (keys) => {
      calls += 1;
      return ok(new Set(calls > 1 && keys.includes(key(1)) ? [key(1)] : []));
    } };
    const result = await sweepAbandonedPhotoUploads(ctx.deps);
    expect(result).toMatchObject({ ok: true, value: { deleted: 1, keptLinked: 1 } });
    expect(ctx.deleted).toEqual([key(2)]);
  });

  it("a failing recheck keeps the object", async () => {
    let calls = 0;
    const ctx = setup({ pages: [[object(key(1), OLD)]] });
    ctx.deps.links = { findLinkedKeys: async () => (++calls === 1 ? ok(new Set<string>()) : err(new UnknownError("secret"))) };
    await sweepAbandonedPhotoUploads(ctx.deps);
    expect(ctx.deleted).toEqual([]);
  });

  it("a failed link query on a page keeps its objects and continues with the next page", async () => {
    let calls = 0;
    const ctx = setup({ pages: [[object(key(1), OLD)], [object(key(2), OLD)]] });
    ctx.deps.links = { findLinkedKeys: async (keys) => (++calls === 1 ? err(new UnknownError("secret")) : ok(new Set(keys.filter(() => false)))) };
    const result = await sweepAbandonedPhotoUploads(ctx.deps);
    expect(result).toMatchObject({ ok: true, value: { pages: 2, deleted: 1 } });
    expect(ctx.deleted).toEqual([key(2)]);
  });

  it("a delete failure does not abort the rest", async () => {
    const ctx = setup({ pages: [[object(key(1), OLD), object(key(2), OLD), object(key(3), OLD)]], failDelete: (k) => k === key(2) });
    const result = await sweepAbandonedPhotoUploads(ctx.deps);
    expect(result).toMatchObject({ ok: true, value: { deleted: 2, deleteFailed: 1 } });
    expect(ctx.deleted).toEqual([key(1), key(3)]);
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("a list failure ends the run keeping what was already swept", async () => {
    const ctx = setup({ pages: [[object(key(1), OLD)], [object(key(2), OLD)]], failListAt: 1 });
    const result = await sweepAbandonedPhotoUploads(ctx.deps);
    expect(result).toMatchObject({ ok: true, value: { pages: 1, deleted: 1, listFailed: true } });
    expect(ctx.deleted).toEqual([key(1)]);
  });

  it("rejects a minimum age below the technical floor of the signed PUT plus margin", async () => {
    expect(ABANDONED_UPLOAD_FLOOR_SECONDS).toBeGreaterThan(PHOTO_UPLOAD_EXPIRES_SECONDS);
    const ctx = setup({ pages: [[object(key(1), ABANDONED_UPLOAD_FLOOR_SECONDS + 10)]] });
    const below = await sweepAbandonedPhotoUploads({ ...ctx.deps, minAgeSeconds: ABANDONED_UPLOAD_FLOOR_SECONDS - 1 });
    expect(below.ok).toBe(false);
    expect(ctx.listCalls).toEqual([]);
    const floor = await sweepAbandonedPhotoUploads({ ...ctx.deps, minAgeSeconds: ABANDONED_UPLOAD_FLOOR_SECONDS });
    expect(floor).toMatchObject({ ok: true, value: { deleted: 1 } });
  });
});
