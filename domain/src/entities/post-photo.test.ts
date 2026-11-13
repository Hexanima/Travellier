import { describe, expect, it } from "vitest";
import {
  buildPostPhotos, checkPhotoObject, createObjectId, createPhotoUploadKey, MAX_PHOTO_BYTES, MAX_PHOTOS_PER_BATCH,
  MAX_PHOTOS_PER_POST, parsePhotoReferences, PHOTO_CONFIRM_MAX_AGE_SECONDS, parsePhotoRemovals, parsePhotoUploadKey, planPhotoRemoval, validatePhotoUploadRequest, ValidationError,
  type ObjectId, type PostPhoto,
} from "../index.js";

const id = (n: number): ObjectId => {
  const parsed = createObjectId(n.toString(16).padStart(24, "0"));
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};
const tripId = id(1), userId = id(2), otherTrip = id(3), otherUser = id(4), postId = id(5);
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const key = (n: number, ext = "jpg", trip = tripId, user = userId) => `trips/${trip}/photos/${user}/${uuid(n)}.${ext}`;
const issues = (result: { ok: boolean; error?: unknown }) =>
  result.ok ? [] : (result.error as ValidationError).issues.map(({ field, code }) => `${field}/${code}`);

describe("photo upload keys", () => {
  it("builds the reserved key and parses it back", () => {
    const built = createPhotoUploadKey({ tripId, userId, uploadId: uuid(1), extension: "webp" });
    expect(built).toBe(`trips/${tripId}/photos/${userId}/${uuid(1)}.webp`);
    expect(parsePhotoUploadKey(built)).toEqual({ tripId, userId, uploadId: uuid(1), extension: "webp" });
  });

  it.each([
    ["extension not allowed", key(1, "gif")],
    ["heic", key(1, "heic")],
    ["path traversal", `trips/${tripId}/photos/${userId}/../${uuid(1)}.jpg`],
    ["traversal in the id segment", `trips/${tripId}/photos/..${userId.slice(2)}/${uuid(1)}.jpg`],
    ["avatar prefix", `avatars/${userId}/${uuid(1)}.jpg`],
    ["foreign prefix", `other/trips/${tripId}/photos/${userId}/${uuid(1)}.jpg`],
    ["leading slash", `/${key(1)}`],
    ["nested folder", `trips/${tripId}/photos/${userId}/x/${uuid(1)}.jpg`],
    ["not a uuid", `trips/${tripId}/photos/${userId}/photo.jpg`],
    ["trailing text", `${key(1)}.exe`],
    ["invalid trip id", `trips/nope/photos/${userId}/${uuid(1)}.jpg`],
    ["empty", ""],
  ])("rejects %s", (_, candidate) => expect(parsePhotoUploadKey(candidate)).toBeUndefined());
});

describe("validatePhotoUploadRequest", () => {
  it("returns every file with its extension", () => {
    expect(validatePhotoUploadRequest([{ contentType: "image/png", sizeBytes: 5 }, { contentType: "image/jpeg", sizeBytes: MAX_PHOTO_BYTES }]))
      .toEqual({ ok: true, value: [{ contentType: "image/png", sizeBytes: 5, extension: "png" },
        { contentType: "image/jpeg", sizeBytes: MAX_PHOTO_BYTES, extension: "jpg" }] });
  });
  it("requires 1 to 10 files", () => {
    expect(issues(validatePhotoUploadRequest(undefined))).toEqual(["files/required"]);
    expect(issues(validatePhotoUploadRequest([]))).toEqual(["files/required"]);
    expect(issues(validatePhotoUploadRequest("x"))).toEqual(["files/required"]);
    const eleven = Array.from({ length: MAX_PHOTOS_PER_BATCH + 1 }, () => ({ contentType: "image/png", sizeBytes: 1 }));
    expect(issues(validatePhotoUploadRequest(eleven))).toEqual(["files/too_many"]);
    expect(validatePhotoUploadRequest(eleven.slice(1)).ok).toBe(true);
  });
  it("lists every failing file", () => {
    expect(issues(validatePhotoUploadRequest([
      { contentType: "image/heic", sizeBytes: 5 }, { contentType: "image/png", sizeBytes: 0 },
      { contentType: "image/png", sizeBytes: MAX_PHOTO_BYTES + 1 }, { contentType: "image/png", sizeBytes: 1.5 },
      { contentType: "image/png", sizeBytes: "5" }, null, { contentType: "image/webp", sizeBytes: 1 },
    ]))).toEqual(["files[0].contentType/unsupported", "files[1].sizeBytes/invalid", "files[2].sizeBytes/too_large",
      "files[3].sizeBytes/invalid", "files[4].sizeBytes/invalid", "files[5].contentType/unsupported", "files[5].sizeBytes/invalid"]);
  });
});

describe("parsePhotoReferences", () => {
  const parse = (photos: unknown, trip = tripId, user = userId) => parsePhotoReferences({ tripId: trip, userId: user, photos });
  it("accepts the keys of this user and Trip in order", () => {
    expect(parse([{ key: key(1) }, { key: key(2, "png") }])).toEqual({ ok: true, value: [key(1), key(2, "png")] });
  });
  it("rejects anything that is not a non-empty list of objects with a key", () => {
    for (const bad of [undefined, null, "x", {}, []]) expect(issues(parse(bad))).toEqual(["photos/invalid"]);
    expect(issues(parse([null, { key: 3 }, {}]))).toEqual(["photos[0].key/invalid", "photos[1].key/invalid", "photos[2].key/invalid"]);
  });
  it("rejects keys of another Trip, another user, a bad format and duplicates, listing all of them", () => {
    expect(issues(parse([{ key: key(1, "jpg", otherTrip) }, { key: key(2, "jpg", tripId, otherUser) }, { key: "avatars/x.jpg" },
      { key: key(3) }, { key: key(3) }, { key: key(4, "gif") }]))).toEqual(["photos[0].key/invalid", "photos[1].key/invalid",
      "photos[2].key/invalid", "photos[4].key/duplicate", "photos[5].key/invalid"]);
  });
  it("limits a request to the per-post maximum", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ key: key(i + 1) }));
    expect(parse(many(MAX_PHOTOS_PER_POST)).ok).toBe(true);
    expect(issues(parse(many(MAX_PHOTOS_PER_POST + 1)))).toEqual(["photos/too_many"]);
  });
});

describe("checkPhotoObject", () => {
  const now = new Date("2026-11-12T12:00:00.000Z");
  const recent = new Date(now.getTime() - 1000);
  const ageMs = (ms: number) => new Date(now.getTime() - ms);
  const limitMs = PHOTO_CONFIRM_MAX_AGE_SECONDS * 1000;
  it.each([
    ["missing object", undefined, "not_uploaded", "k.jpg"],
    ["empty object", { contentType: "image/jpeg", sizeBytes: 0, lastModified: recent }, "not_uploaded", "k.jpg"],
    ["too large", { contentType: "image/jpeg", sizeBytes: MAX_PHOTO_BYTES + 1, lastModified: recent }, "too_large", "k.jpg"],
    ["no content type", { contentType: null, sizeBytes: 1, lastModified: recent }, "content_type_mismatch", "k.jpg"],
    ["type not allowed", { contentType: "image/gif", sizeBytes: 1, lastModified: recent }, "content_type_mismatch", "k.jpg"],
    ["type differs from the extension", { contentType: "image/png", sizeBytes: 1, lastModified: recent }, "content_type_mismatch", "k.jpg"],
    ["valid", { contentType: "image/png", sizeBytes: MAX_PHOTO_BYTES, lastModified: recent }, undefined, "k.png"],
    ["valid with parameters", { contentType: "IMAGE/WEBP", sizeBytes: 1, lastModified: recent }, undefined, "k.webp"],
  ])("%s", (_, head, expected, name) => {
    const extension = name.endsWith("jpg") ? "jpg" : name.endsWith("png") ? "png" : "webp";
    expect(checkPhotoObject(extension, head, now)).toBe(expected);
  });

  describe("upload age", () => {
    const head = (lastModified: Date, extra = {}) => ({ contentType: "image/jpeg", sizeBytes: 1, lastModified, ...extra });
    it("the limit is 23 hours", () => expect(PHOTO_CONFIRM_MAX_AGE_SECONDS).toBe(23 * 3600));
    it("accepts an upload of exactly 23 hours", () => expect(checkPhotoObject("jpg", head(ageMs(limitMs)), now)).toBeUndefined());
    it("rejects an upload of 23 hours and 1 ms", () => expect(checkPhotoObject("jpg", head(ageMs(limitMs + 1)), now)).toBe("upload_too_old"));
    it("accepts an upload of 22 hours", () => expect(checkPhotoObject("jpg", head(ageMs(22 * 3600 * 1000)), now)).toBeUndefined());
    it("accepts a lastModified in the future (clock skew)", () => expect(checkPhotoObject("jpg", head(new Date(now.getTime() + 60_000)), now)).toBeUndefined());
    it("reports the earlier code first", () => {
      const old = ageMs(48 * 3600 * 1000);
      expect(checkPhotoObject("jpg", undefined, now)).toBe("not_uploaded");
      expect(checkPhotoObject("jpg", head(old, { sizeBytes: 0 }), now)).toBe("not_uploaded");
      expect(checkPhotoObject("jpg", head(old, { sizeBytes: MAX_PHOTO_BYTES + 1 }), now)).toBe("too_large");
      expect(checkPhotoObject("jpg", head(old, { contentType: "image/png" }), now)).toBe("content_type_mismatch");
    });
  });
});

describe("buildPostPhotos", () => {
  const stored = (order: number, k: string): PostPhoto => ({ id: id(100 + order), postId, tripId, uploaderId: userId, s3Key: k, order,
    uploadedAt: new Date(0) });
  const uploadedAt = new Date("2026-11-09T10:00:00.000Z");
  let sequence: number;
  const build = (keys: string[], existing: PostPhoto[] = []) => {
    sequence = 200;
    return buildPostPhotos({ postId, tripId, uploaderId: userId, keys, existing, createId: () => id(sequence++), uploadedAt });
  };

  it("numbers the new photos from 1 contiguously", () => {
    expect(build([key(1), key(2)])).toEqual({ ok: true, value: { toInsert: [
      { id: id(200), postId, tripId, uploaderId: userId, s3Key: key(1), order: 1, uploadedAt },
      { id: id(201), postId, tripId, uploaderId: userId, s3Key: key(2), order: 2, uploadedAt }],
    photos: [{ id: id(200), order: 1 }, { id: id(201), order: 2 }] } });
  });
  it("continues after the existing photos and treats an already registered key as a no-op", () => {
    const existing = [stored(1, key(1)), stored(2, key(2))];
    expect(build([key(2), key(3)], existing)).toEqual({ ok: true, value: { toInsert: [
      { id: id(200), postId, tripId, uploaderId: userId, s3Key: key(3), order: 3, uploadedAt }],
    photos: [{ id: id(101), order: 1 }, { id: id(102), order: 2 }, { id: id(200), order: 3 }] } });
    expect(build([key(1)], existing)).toMatchObject({ ok: true, value: { toInsert: [], photos: [{ id: id(101), order: 1 }, { id: id(102), order: 2 }] } });
  });
  it("enforces the per-post limit counting the existing photos", () => {
    const existing = Array.from({ length: 9 }, (_, i) => stored(i + 1, key(i + 1)));
    expect(build([key(20)], existing)).toMatchObject({ ok: true, value: { toInsert: [{ order: 10 }] } });
    expect(issues(build([key(20), key(21)], existing))).toEqual(["photos/too_many"]);
  });
});

describe("parsePhotoRemovals (T127)", () => {
  it("returns the ids in request order", () => {
    expect(parsePhotoRemovals([{ id: id(101) }, { id: id(100) }])).toEqual({ ok: true, value: [id(101), id(100)] });
  });
  it.each<[string, unknown, string[]]>([
    ["not a list", { id: id(1) }, ["removePhotos/invalid"]],
    ["null", null, ["removePhotos/invalid"]],
    ["empty", [], ["removePhotos/invalid"]],
    ["more than 10", Array.from({ length: 11 }, (_, i) => ({ id: id(100 + i) })), ["removePhotos/too_many"]],
    ["invalid id", [{ id: "nope" }, { id: id(100) }, {}, "x", { id: 5 }], ["removePhotos[0].id/invalid", "removePhotos[2].id/invalid", "removePhotos[3].id/invalid", "removePhotos[4].id/invalid"]],
    ["duplicates", [{ id: id(100) }, { id: id(101) }, { id: id(100) }], ["removePhotos[2].id/duplicate"]],
  ])("rejects %s", (_, input, expected) => {
    expect(issues(parsePhotoRemovals(input))).toEqual(expected);
  });
});

describe("planPhotoRemoval (T127)", () => {
  const stored = (order: number, k = key(order)): PostPhoto => ({ id: id(100 + order), postId, tripId, uploaderId: userId, s3Key: k, order, uploadedAt: new Date(0) });
  const three = [stored(1), stored(2), stored(3)];

  it("removes the photo and renumbers the rest from 1 keeping the relative order", () => {
    const plan = planPhotoRemoval({ existing: three, ids: [id(101)] });
    expect(plan.removed.map((p) => p.s3Key)).toEqual([key(1)]);
    expect(plan.remaining.map((p) => [p.id, p.order])).toEqual([[id(102), 1], [id(103), 2]]);
    expect(plan.orderUpdates).toEqual([{ id: id(102), order: 1 }, { id: id(103), order: 2 }]);
  });
  it("only updates the photos whose order changes", () => {
    const plan = planPhotoRemoval({ existing: three, ids: [id(103)] });
    expect(plan.remaining.map((p) => p.order)).toEqual([1, 2]);
    expect(plan.orderUpdates).toEqual([]);
    expect(planPhotoRemoval({ existing: three, ids: [id(102)] }).orderUpdates).toEqual([{ id: id(103), order: 2 }]);
  });
  it("ignores unknown ids and removes every photo when asked", () => {
    const none = planPhotoRemoval({ existing: three, ids: [id(999)] });
    expect(none.removed).toEqual([]); expect(none.orderUpdates).toEqual([]); expect(none.remaining).toEqual(three);
    const all = planPhotoRemoval({ existing: three, ids: [id(101), id(102), id(103)] });
    expect(all.removed).toHaveLength(3); expect(all.remaining).toEqual([]);
  });
  it("renumbers a non contiguous post and sorts by order", () => {
    const plan = planPhotoRemoval({ existing: [stored(7), stored(2), stored(5)], ids: [id(102)] });
    expect(plan.remaining.map((p) => [p.id, p.order])).toEqual([[id(105), 1], [id(107), 2]]);
    expect(plan.orderUpdates).toEqual([{ id: id(105), order: 1 }, { id: id(107), order: 2 }]);
  });
  it("lets buildPostPhotos continue after the renumbered photos", () => {
    const { remaining } = planPhotoRemoval({ existing: three, ids: [id(101)] });
    const built = buildPostPhotos({ postId, tripId, uploaderId: userId, keys: [key(9)], existing: remaining, createId: () => id(300), uploadedAt: new Date(0) });
    expect(built).toMatchObject({ ok: true, value: { toInsert: [{ order: 3 }], photos: [{ id: id(102), order: 1 }, { id: id(103), order: 2 }, { id: id(300), order: 3 }] } });
  });
});
