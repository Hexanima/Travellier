import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createObjectId, createTripPhotoUploads, err, getTripPhoto, getTripPostPhotos, ok, UnknownError,
  type ObjectId, type ObjectStoragePort, type Post, type PostPhoto, type TripPostPort, type TripPostReadScope, type TripRole,
} from "../../index.js";

const id = (n: number): ObjectId => {
  const parsed = createObjectId(n.toString(16).padStart(24, "0"));
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};
const tripId = id(1), actor = id(2), postId = id(3), otherTrip = id(4), former = id(5);
const now = new Date("2026-11-09T10:00:00.000Z");
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const post: Post = { id: postId, tripId, authorId: actor, createdAt: now, description: null, mapsUrl: null, activityId: null,
  parentPostId: null, transportId: null };
const photo = (n: number, fields: Partial<PostPhoto> = {}): PostPhoto => ({ id: id(100 + n), postId, tripId, uploaderId: actor,
  s3Key: `trips/${tripId}/photos/${actor}/${uuid(n)}.jpg`, order: n, uploadedAt: now, ...fields });

describe("trip photo use cases", () => {
  let role: TripRole | undefined, posts: Post[], photos: PostPhoto[], transactions: number, snapshots: number;
  let storage: ObjectStoragePort, port: TripPostPort;
  beforeEach(() => {
    role = "participant"; posts = [post]; photos = []; transactions = 0; snapshots = 0;
    storage = {
      createUploadTarget: vi.fn(async ({ objectKey, contentType }) => ok({ uploadUrl: `https://put.test/${objectKey}`,
        headers: { "content-type": contentType }, expiresAt: new Date("2026-11-09T10:15:00.000Z") })),
      createDownloadTarget: vi.fn(async ({ objectKey }) => ok({ downloadUrl: `https://get.test/${objectKey}` })),
      headObject: vi.fn(async () => ok(undefined)),
    };
    const scope = {
      findMemberRole: async (userId: ObjectId) => ok(userId === actor ? role : undefined),
      findTrip: async () => ok({ id: tripId }),
      find: async (postIdValue: ObjectId) => ok(posts.find((p) => p.id === postIdValue)),
      listPhotos: async (postIdValue: ObjectId) => ok(photos.filter((p) => p.postId === postIdValue && p.tripId === tripId)
        .sort((a, b) => a.order - b.order)),
      listPhotosByPosts: async (postIds: readonly ObjectId[]) => ok(photos.filter((p) => postIds.includes(p.postId) && p.tripId === tripId)
        .sort((a, b) => a.order - b.order)),
      findPhoto: async (photoId: ObjectId) => ok(photos.find((p) => p.id === photoId)),
    } as unknown as TripPostReadScope;
    port = {
      withReadSnapshot: async (_, work) => { snapshots++; return work(scope); },
      withTransaction: async (_, work) => { transactions++; return work(scope as never); },
    };
  });

  describe("createTripPhotoUploads", () => {
    let sequence: number;
    beforeEach(() => { sequence = 1; });
    const upload = (files: unknown, userId = actor) => createTripPhotoUploads.execute({ posts: port, storage,
      createUploadId: () => uuid(sequence++) }, { tripId, authenticatedUserId: userId, files });

    it("signs one PUT per file on a fresh key under the user's prefix of the Trip, reading a snapshot without the lock", async () => {
      const result = await upload([{ contentType: "image/jpeg", sizeBytes: 100 }, { contentType: "image/webp", sizeBytes: 200 }]);
      const keys = [`trips/${tripId}/photos/${actor}/${uuid(1)}.jpg`, `trips/${tripId}/photos/${actor}/${uuid(2)}.webp`];
      expect(result).toEqual(ok({ uploads: [
        { key: keys[0], uploadUrl: `https://put.test/${keys[0]}`, headers: { "content-type": "image/jpeg" }, expiresAt: new Date("2026-11-09T10:15:00.000Z") },
        { key: keys[1], uploadUrl: `https://put.test/${keys[1]}`, headers: { "content-type": "image/webp" }, expiresAt: new Date("2026-11-09T10:15:00.000Z") }] }));
      expect(storage.createUploadTarget).toHaveBeenNthCalledWith(1, { objectKey: keys[0], contentType: "image/jpeg", expiresInSeconds: 900, contentLength: 100 });
      expect(storage.createUploadTarget).toHaveBeenNthCalledWith(2, { objectKey: keys[1], contentType: "image/webp", expiresInSeconds: 900, contentLength: 200 });
      expect([snapshots, transactions]).toEqual([1, 0]);
    });

    it("issues new keys on every call (not idempotent)", async () => {
      const first = await upload([{ contentType: "image/png", sizeBytes: 1 }]);
      const second = await upload([{ contentType: "image/png", sizeBytes: 1 }]);
      expect(first.ok && second.ok && first.value.uploads[0]!.key !== second.value.uploads[0]!.key).toBe(true);
    });

    // The port only exposes `findMemberRole`, so a former member is indistinguishable from an outsider here; the real former member is covered by the HTTP/persistence tests.
    it("answers TripNotFoundError to a non-member without signing", async () => {
      role = undefined;
      expect(await upload([{ contentType: "image/png", sizeBytes: 1 }])).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
      expect(await upload([{ contentType: "image/png", sizeBytes: 1 }], id(77))).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
      expect(storage.createUploadTarget).not.toHaveBeenCalled();
    });

    it("rejects an invalid batch listing every field and signs nothing", async () => {
      const result = await upload([{ contentType: "image/heic", sizeBytes: 1 }, { contentType: "image/png", sizeBytes: 11 * 1024 * 1024 }]);
      expect(result).toMatchObject({ ok: false, error: { tag: "ValidationError", issues: [
        { field: "files[0].contentType", code: "unsupported" }, { field: "files[1].sizeBytes", code: "too_large" }] } });
      expect(await upload([])).toMatchObject({ ok: false, error: { issues: [{ field: "files", code: "required" }] } });
      expect(storage.createUploadTarget).not.toHaveBeenCalled();
    });

    it("propagates a signing failure", async () => {
      vi.mocked(storage.createUploadTarget).mockResolvedValueOnce(err(new UnknownError("boom")));
      expect(await upload([{ contentType: "image/png", sizeBytes: 1 }])).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
    });
  });

  describe("reads", () => {
    const readPhotos = (userId = actor, trip = tripId, postRef = postId) => getTripPostPhotos.execute({ posts: port, storage, now: () => now },
      { tripId: trip, postId: postRef, authenticatedUserId: userId });
    const readPhoto = (photoId: ObjectId, userId = actor, trip = tripId) => getTripPhoto.execute({ posts: port, storage, now: () => now },
      { tripId: trip, photoId, authenticatedUserId: userId });
    const view = (n: number, uploaderId = actor) => ({ id: id(100 + n), postId, order: n, uploadedAt: now, uploaderId,
      url: `https://get.test/trips/${tripId}/photos/${uploaderId}/${uuid(n)}.jpg`, expiresAt: new Date("2026-11-09T10:05:00.000Z") });

    it("signs a 300 s GET for each photo of a post in order and never exposes the S3 key", async () => {
      photos = [photo(2), photo(1)];
      const result = await readPhotos();
      expect(result).toEqual(ok([view(1), view(2)]));
      expect(storage.createDownloadTarget).toHaveBeenCalledWith({ objectKey: photo(1).s3Key, expiresInSeconds: 300 });
      expect(JSON.stringify(result)).not.toContain("s3Key");
      expect([snapshots, transactions]).toEqual([1, 0]);
    });

    it("returns an empty list for a post without photos and 404 for a post outside the Trip", async () => {
      expect(await readPhotos()).toEqual(ok([]));
      expect(await readPhotos(actor, tripId, id(99))).toMatchObject({ ok: false, error: { tag: "PostNotFoundError" } });
      posts = [{ ...post, tripId: otherTrip }];
      expect(await readPhotos()).toMatchObject({ ok: false, error: { tag: "PostNotFoundError" } });
    });

    it("serves a single photo by id", async () => {
      photos = [photo(1)];
      expect(await readPhoto(photo(1).id)).toEqual(ok(view(1)));
    });

    it("keeps serving the photos of a former member to current members", async () => {
      photos = [photo(1, { uploaderId: former, s3Key: `trips/${tripId}/photos/${former}/${uuid(1)}.jpg` })];
      expect(await readPhoto(photo(1).id)).toEqual(ok(view(1, former)));
      expect(await readPhotos()).toEqual(ok([view(1, former)]));
    });

    it("denies outsiders and former members without signing", async () => {
      photos = [photo(1)];
      role = undefined;
      for (const result of [await readPhotos(), await readPhoto(photo(1).id), await readPhotos(id(77)), await readPhoto(photo(1).id, id(77))]) {
        expect(result).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
      }
      expect(storage.createDownloadTarget).not.toHaveBeenCalled();
    });

    it("answers PhotoNotFoundError for a photo of another Trip, a missing photo and a photo whose Trip differs from the route", async () => {
      photos = [photo(1, { tripId: otherTrip, s3Key: `trips/${otherTrip}/photos/${actor}/${uuid(1)}.jpg` })];
      expect(await readPhoto(photo(1).id)).toMatchObject({ ok: false, error: { tag: "PhotoNotFoundError" } });
      expect(await readPhoto(id(555))).toMatchObject({ ok: false, error: { tag: "PhotoNotFoundError" } });
      expect(storage.createDownloadTarget).not.toHaveBeenCalled();
    });

    it("propagates a signing failure", async () => {
      photos = [photo(1)];
      vi.mocked(storage.createDownloadTarget).mockResolvedValueOnce(err(new UnknownError("boom")));
      expect(await readPhoto(photo(1).id)).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
    });
  });
});
