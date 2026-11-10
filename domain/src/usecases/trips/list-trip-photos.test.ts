import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createObjectId, err, listTripPhotos, ok, UnknownError, type Activity, type ObjectId, type ObjectStoragePort, type Post, type PostPhoto,
  type TripPhotoPage, type TripPostPort, type TripPostReadScope, type TripRole,
} from "../../index.js";

const id = (n: number): ObjectId => {
  const parsed = createObjectId(n.toString(16).padStart(24, "0"));
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};
const tripId = id(1), actor = id(2), otherTrip = id(3), former = id(4), activityA = id(40), activityB = id(41), transportT = id(50);
const now = new Date("2026-11-10T10:00:00.000Z");
const base = Date.parse("2026-10-01T10:00:00.000Z");
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const post = (n: number, fields: Partial<Post> & { minutes?: number } = {}): Post => {
  const { minutes = n, ...rest } = fields;
  return { id: id(n), tripId, authorId: actor, description: null, mapsUrl: null, activityId: null, parentPostId: null, transportId: null,
    createdAt: new Date(base + minutes * 60_000), ...rest };
};
let photoSeq = 1000;
const photo = (postN: number, order: number, fields: Partial<PostPhoto> = {}): PostPhoto => {
  const n = photoSeq++;
  return { id: id(n), postId: id(postN), tripId, uploaderId: actor, s3Key: `trips/${tripId}/photos/${actor}/${uuid(n)}.jpg`, order,
    uploadedAt: new Date(base + 1), ...fields };
};
const ids = (page: TripPhotoPage) => page.photos.map((p) => p.id);

describe("listTripPhotos", () => {
  let role: TripRole | undefined, posts: Post[], photos: PostPhoto[], activities: Activity[], transports: ObjectId[];
  let storage: ObjectStoragePort, port: TripPostPort, snapshots: number, inSnapshot: boolean, listCalls: number, batches: ObjectId[][];
  let signedInsideSnapshot: boolean;
  beforeEach(() => {
    photoSeq = 1000; role = "participant"; posts = []; photos = []; activities = [{ id: activityA, tripId } as Activity, { id: activityB, tripId } as Activity];
    transports = [transportT]; snapshots = 0; inSnapshot = false; listCalls = 0; batches = []; signedInsideSnapshot = false;
    storage = {
      createUploadTarget: vi.fn(), headObject: vi.fn(),
      createDownloadTarget: vi.fn(async ({ objectKey }) => { if (inSnapshot) signedInsideSnapshot = true; return ok({ downloadUrl: `https://get.test/${objectKey}` }); }),
    } as unknown as ObjectStoragePort;
    const scope = {
      findMemberRole: async (userId: ObjectId) => ok(userId === actor ? role : undefined),
      findTrip: async () => ok({ id: tripId }),
      findActivity: async (activityId: ObjectId) => ok(activities.find((a) => a.id === activityId)),
      findTransport: async (transportId: ObjectId) => ok(transports.includes(transportId) ? { id: transportId, tripId } : undefined),
      listActivityIds: async () => ok(activities.filter((a) => a.tripId === tripId).map((a) => a.id)),
      listTransportIds: async () => ok([...transports]),
      list: async () => { listCalls++; return ok([...posts]); },
      // Deliberately lax (no tripId filter): the use case must not trust it blindly.
      listPhotosByPosts: async (postIds: readonly ObjectId[]) => { batches.push([...postIds]);
        return ok(photos.filter((p) => postIds.includes(p.postId)).sort((a, b) => a.order - b.order)); },
    } as unknown as TripPostReadScope;
    port = { withReadSnapshot: async (_, work) => { snapshots++; inSnapshot = true; try { return await work(scope); } finally { inSnapshot = false; } },
      withTransaction: async () => { throw new Error("writes are not allowed"); } };
  });
  const list = (extra: Record<string, unknown> = {}, userId = actor) =>
    listTripPhotos.execute({ posts: port, storage, now: () => now }, { tripId, authenticatedUserId: userId, ...extra } as never);
  const page = async (extra: Record<string, unknown> = {}) => {
    const result = await list(extra);
    if (!result.ok) throw new Error(`unexpected ${result.error.tag}`);
    return result.value;
  };
  const walk = async (limit: number, extra: Record<string, unknown> = {}) => {
    const all: TripPhotoPage[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 50; guard++) {
      const current = await page({ limit, cursor, ...extra });
      all.push(current);
      if (current.nextCursor === null) return all;
      cursor = current.nextCursor;
    }
    throw new Error("pagination does not end");
  };

  it("orders by publication desc, then post id desc, then photo order asc, with the post as origin", async () => {
    // Scrambled insertion; posts 11 and 12 share the same publication instant.
    posts = [post(10, { minutes: 5 }), post(12, { minutes: 20 }), post(11, { minutes: 20 }), post(13, { minutes: 30 })];
    const a = photo(10, 0), b = photo(11, 1), c = photo(11, 0), d = photo(12, 0), e = photo(13, 0), f = photo(13, 1);
    photos = [a, b, c, d, e, f];
    const result = await page();
    expect(ids(result)).toEqual([e.id, f.id, d.id, c.id, b.id, a.id]);
    expect(result.photos.map((p) => p.postId)).toEqual([id(13), id(13), id(12), id(11), id(11), id(10)]);
    expect(result.nextCursor).toBeNull();
  });

  it("returns the exact view with the signed URL, a single expiry and the post data (no S3 key)", async () => {
    const other = id(77);
    posts = [post(10, { activityId: activityA, authorId: other, minutes: 5 })];
    photos = [photo(10, 0, { uploaderId: other })];
    const result = await page();
    expect(result).toEqual({ nextCursor: null, photos: [{ id: photos[0]!.id, postId: id(10), order: 0, uploadedAt: photos[0]!.uploadedAt,
      uploaderId: other, url: `https://get.test/${photos[0]!.s3Key}`, expiresAt: new Date("2026-11-10T10:05:00.000Z"),
      post: { createdAt: posts[0]!.createdAt, authorId: other, rootActivityId: activityA, rootTransportId: null } }] });
    expect(JSON.stringify(result)).not.toContain("s3Key");
  });

  it("pages without duplicates or gaps, also when a page ends in the middle of a post, and ends with an explicit null cursor", async () => {
    posts = [post(10, { minutes: 1 }), post(11, { minutes: 2 }), post(12, { minutes: 3 }), post(13, { minutes: 4 }), post(14, { minutes: 5 })];
    photos = [photo(10, 0), photo(11, 0), photo(11, 1), photo(11, 2), photo(13, 0), photo(14, 0), photo(14, 1)]; // post 12 has no photos
    const expected = [photos[5]!, photos[6]!, photos[4]!, photos[1]!, photos[2]!, photos[3]!, photos[0]!].map((p) => p.id);
    for (const limit of [1, 2, 3, 4, 7, 8]) {
      const pages = await walk(limit);
      expect(pages.flatMap(ids), `limit ${limit}`).toEqual(expected);
      expect(pages.at(-1)!.nextCursor, `limit ${limit}`).toBeNull();
      expect(pages.slice(0, -1).every((p) => p.photos.length === limit && typeof p.nextCursor === "string")).toBe(true);
    }
    // Exactly `limit` photos left: the page is full and still ends the list (limit + 1 lookahead).
    expect((await walk(7)).length).toBe(1);
    expect((await walk(7))[0]!.nextCursor).toBeNull();
  });

  it("keeps the listing stable when a newer post and photos appended to posts arrive between pages", async () => {
    posts = [post(10, { minutes: 1 }), post(11, { minutes: 2 }), post(12, { minutes: 3 })];
    photos = [photo(10, 0), photo(11, 0), photo(12, 0), photo(12, 1)];
    const first = await page({ limit: 2 });
    expect(ids(first)).toEqual([photos[2]!.id, photos[3]!.id]);
    // A newer post (before the cursor in list order), a photo appended to the cursor post (after it) and one to an older post.
    posts.push(post(13, { minutes: 50 }));
    const newer = photo(13, 0), appendedHere = photo(12, 2), appendedOlder = photo(10, 1);
    photos.push(newer, appendedHere, appendedOlder);
    const second = await page({ limit: 2, cursor: first.nextCursor });
    expect(ids(second)).toEqual([appendedHere.id, photos[1]!.id]);
    const third = await page({ limit: 5, cursor: second.nextCursor });
    expect(ids(third)).toEqual([photos[0]!.id, appendedOlder.id]);
    expect(third.nextCursor).toBeNull();
    const seen = [...ids(first), ...ids(second), ...ids(third)];
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).not.toContain(newer.id);
  });

  it("applies limit 30 by default, accepts up to 60 and rejects anything else as 422 on limit", async () => {
    posts = Array.from({ length: 65 }, (_, i) => post(100 + i));
    photos = posts.map((p, i) => photo(100 + i, 0, { postId: p.id }));
    const byDefault = await page();
    expect(byDefault.photos).toHaveLength(30);
    expect(byDefault.nextCursor).not.toBeNull();
    expect((await page({ limit: 60 })).photos).toHaveLength(60);
    expect((await page({ limit: "7" })).photos).toHaveLength(7);
    expect((await page({ limit: 1 })).photos).toHaveLength(1);
    for (const limit of [0, 61, -1, 1.5, "abc", "", "1e1", "0x10", NaN, null, {}, "-3", " 5"]) {
      expect(await list({ limit }), String(limit)).toMatchObject({ ok: false, error: { tag: "ValidationError", issues: [{ field: "limit", code: "invalid" }] } });
    }
  });

  it("rejects an invalid cursor, one from another Trip and one from another filter as 422 on cursor", async () => {
    posts = [post(10), post(11), post(12)];
    photos = [photo(10, 0), photo(11, 0), photo(12, 0)];
    const first = await page({ limit: 1 });
    const bad = { ok: false, error: { tag: "ValidationError", issues: [{ field: "cursor", code: "invalid" }] } };
    for (const cursor of ["", "garbage", "e30", `${first.nextCursor}x`, btoa("{}")]) expect(await list({ cursor }), String(cursor)).toMatchObject(bad);
    expect(await list({ cursor: first.nextCursor })).toMatchObject({ ok: true });
    expect(await list({ cursor: first.nextCursor, activityId: activityA })).toMatchObject(bad);
    expect(await list({ cursor: first.nextCursor, transportId: transportT })).toMatchObject(bad);
    posts[0] = post(10, { activityId: activityA });
    posts[1] = post(11, { activityId: activityA });
    const cursorOfActivity = (await page({ limit: 1, activityId: activityA })).nextCursor;
    expect(cursorOfActivity).not.toBeNull();
    expect(await list({ cursor: cursorOfActivity })).toMatchObject(bad);
    expect(await list({ cursor: cursorOfActivity, activityId: activityB })).toMatchObject(bad);
    expect(await list({ cursor: cursorOfActivity, transportId: transportT })).toMatchObject(bad);
    expect(await list({ cursor: cursorOfActivity, activityId: activityA })).toMatchObject({ ok: true });
    // A cursor minted for another Trip is rejected here.
    const foreign = btoa(JSON.stringify({ v: 1, t: otherTrip, f: "all", c: base, p: id(10), o: 0 })).replace(/=+$/, "");
    expect(await list({ cursor: foreign })).toMatchObject(bad);
  });

  it("filters by activity including every descendant of its root, branches included, and excludes other activities", async () => {
    posts = [
      post(10, { activityId: activityA, minutes: 1 }), post(11, { parentPostId: id(10), minutes: 2 }), post(12, { parentPostId: id(11), minutes: 3 }),
      post(13, { parentPostId: id(12), minutes: 4 }), post(14, { parentPostId: id(11), minutes: 5 }), // branch
      post(20, { activityId: activityB, minutes: 6 }), post(21, { parentPostId: id(20), minutes: 7 }),
      post(30, { minutes: 8 }), post(31, { parentPostId: id(30), minutes: 9 }), // independent tree
      post(40, { parentPostId: id(10), minutes: 10 }),
    ];
    photos = posts.map((p, i) => photo(0, i % 2, { postId: p.id }));
    const inA = await walk(3, { activityId: activityA });
    const idsInA = inA.flatMap((p) => p.photos.map((x) => x.postId));
    expect(new Set(idsInA)).toEqual(new Set([10, 11, 12, 13, 14, 40].map(id)));
    expect(idsInA).toHaveLength(6);
    expect(inA.flatMap((p) => p.photos).every((p) => p.post.rootActivityId === activityA)).toBe(true);
    const inB = await page({ activityId: activityB });
    expect(inB.photos.map((p) => p.postId)).toEqual([id(21), id(20)]);
    const all = await page({ limit: 60 });
    expect(all.photos).toHaveLength(10);
  });

  it("uses the own activity link of a descendant before the root's (itinerary rule)", async () => {
    // Legacy shape (a child with its own link) that the itinerary still tolerates.
    posts = [post(10, { activityId: activityA, minutes: 1 }), post(11, { parentPostId: id(10), activityId: activityB, minutes: 2 })];
    photos = [photo(10, 0), photo(11, 0)];
    expect((await page({ activityId: activityB })).photos.map((p) => p.postId)).toEqual([id(11)]);
    expect((await page({ activityId: activityA })).photos.map((p) => p.postId)).toEqual([id(10)]);
  });

  it("falls back to the root's link when a descendant's own link dangles, as the itinerary does, and exposes the real root context", async () => {
    const missingActivity = id(990), missingTransport = id(991);
    posts = [post(10, { activityId: activityA, transportId: transportT, minutes: 1 }),
      post(11, { parentPostId: id(10), activityId: missingActivity, transportId: missingTransport, minutes: 2 }),
      post(12, { parentPostId: id(10), activityId: missingActivity, minutes: 3 })];
    photos = [photo(10, 0), photo(11, 0), photo(12, 0)];
    const inA = await page({ activityId: activityA });
    expect(inA.photos.map((p) => p.postId)).toEqual([id(12), id(11), id(10)]);
    expect(inA.photos.map((p) => [p.post.rootActivityId, p.post.rootTransportId])).toEqual(Array(3).fill([activityA, transportT]));
    expect((await page({ transportId: transportT })).photos.map((p) => p.postId)).toEqual([id(12), id(11), id(10)]);
    // A dangling activity never shows up as a root context, nor does it filter anything.
    const all = await page();
    expect(all.photos.some((p) => p.post.rootActivityId === missingActivity || p.post.rootTransportId === missingTransport)).toBe(false);
  });

  it("filters by transport through the chain root", async () => {
    posts = [post(10, { transportId: transportT, minutes: 1 }), post(11, { parentPostId: id(10), minutes: 2 }), post(12, { minutes: 3 })];
    photos = [photo(10, 0), photo(11, 0), photo(12, 0)];
    const result = await page({ transportId: transportT });
    expect(result.photos.map((p) => [p.postId, p.post.rootTransportId])).toEqual([[id(11), transportT], [id(10), transportT]]);
  });

  it("recomputes after relinking or deleting an activity without touching a single photo", async () => {
    posts = [post(10, { activityId: activityA, minutes: 1 }), post(11, { parentPostId: id(10), minutes: 2 }), post(12, { activityId: activityA, minutes: 3 })];
    photos = [photo(10, 0), photo(11, 0), photo(12, 0)];
    const snapshot = structuredClone(photos);
    expect((await page({ activityId: activityA })).photos).toHaveLength(3);
    // Relink the root to B: its descendants follow.
    posts[0] = { ...posts[0]!, activityId: activityB };
    expect((await page({ activityId: activityA })).photos.map((p) => p.postId)).toEqual([id(12)]);
    expect((await page({ activityId: activityB })).photos.map((p) => p.postId)).toEqual([id(11), id(10)]);
    // Delete activity A: posts lose the direct link (activityId null), the activity no longer exists.
    posts[2] = { ...posts[2]!, activityId: null };
    activities = activities.filter((a) => a.id !== activityA);
    expect(await list({ activityId: activityA })).toMatchObject({ ok: false, error: { tag: "ActivityNotFoundError" } });
    const general = await page();
    expect(general.photos.map((p) => p.postId)).toEqual([id(12), id(11), id(10)]);
    expect(general.photos.map((p) => p.post.rootActivityId)).toEqual([null, activityB, activityB]);
    expect(photos).toEqual(snapshot);
  });

  it("includes independent posts and posts outside any itinerary date", async () => {
    posts = [post(10, { minutes: 1 }), post(11, { minutes: -100_000_000 }), post(12, { minutes: 100_000_000 })];
    photos = [photo(10, 0), photo(11, 0), photo(12, 0)];
    expect((await page()).photos.map((p) => p.postId)).toEqual([id(12), id(10), id(11)]);
  });

  it("answers 404 for an activity or transport that does not exist in this Trip", async () => {
    posts = [post(10)]; photos = [photo(10, 0)];
    expect(await list({ activityId: id(999) })).toMatchObject({ ok: false, error: { tag: "ActivityNotFoundError" } });
    expect(await list({ transportId: id(999) })).toMatchObject({ ok: false, error: { tag: "TransportNotFoundError" } });
    activities = [{ id: activityA, tripId: otherTrip } as Activity];
    expect(await list({ activityId: activityA })).toMatchObject({ ok: false, error: { tag: "ActivityNotFoundError" } });
    expect(storage.createDownloadTarget).not.toHaveBeenCalled();
  });

  it("rejects an activity and a transport together as 422 on filter without signing", async () => {
    posts = [post(10)]; photos = [photo(10, 0)];
    expect(await list({ activityId: activityA, transportId: transportT })).toMatchObject({ ok: false,
      error: { tag: "ValidationError", issues: [{ field: "filter", code: "conflict" }] } });
    expect(storage.createDownloadTarget).not.toHaveBeenCalled();
  });

  it("reports every invalid parameter together", async () => {
    expect(await list({ limit: 0, cursor: "x", activityId: activityA, transportId: transportT })).toMatchObject({ ok: false, error: {
      issues: [{ field: "limit", code: "invalid" }, { field: "filter", code: "conflict" }] } });
    expect(await list({ limit: 0, cursor: "x" })).toMatchObject({ ok: false, error: {
      issues: [{ field: "limit", code: "invalid" }, { field: "cursor", code: "invalid" }] } });
  });

  it("answers 404 to non-members and former members before validating anything, without listing or signing", async () => {
    posts = [post(10)]; photos = [photo(10, 0)];
    role = undefined;
    for (const extra of [{}, { limit: 0 }, { cursor: "x" }, { activityId: activityA, transportId: transportT }, { activityId: id(999) }]) {
      expect(await list(extra), JSON.stringify(extra)).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    }
    expect(await list({}, id(77))).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    expect(listCalls).toBe(0);
    expect(batches).toHaveLength(0);
    expect(storage.createDownloadTarget).not.toHaveBeenCalled();
  });

  it("excludes photos of another Trip and photos not belonging to the requested posts, and posts of another Trip", async () => {
    posts = [post(10, { minutes: 2 }), post(11, { minutes: 1 }), { ...post(12, { minutes: 3 }), tripId: otherTrip }];
    const legit = photo(10, 0), foreignTrip = photo(10, 1, { tripId: otherTrip }), orphan = photo(99, 0), ofForeignPost = photo(12, 0);
    photos = [legit, foreignTrip, orphan, ofForeignPost];
    expect(ids(await page())).toEqual([legit.id]);
    expect(storage.createDownloadTarget).toHaveBeenCalledTimes(1);
  });

  it("keeps the posts and photos of a former member, identified by their ids", async () => {
    posts = [post(10, { authorId: former, minutes: 1 }), post(11, { minutes: 2 })];
    photos = [photo(10, 0, { uploaderId: former }), photo(11, 0)];
    const result = await page();
    expect(result.photos.map((p) => [p.postId, p.uploaderId, p.post.authorId])).toEqual([[id(11), actor, actor], [id(10), former, former]]);
  });

  it("reads one snapshot and signs only the photos of the page, after it, with a 300 s expiry", async () => {
    posts = Array.from({ length: 6 }, (_, i) => post(100 + i, { minutes: i }));
    photos = posts.map((p, i) => photo(100 + i, 0, { postId: p.id }));
    const result = await page({ limit: 2 });
    expect(snapshots).toBe(1);
    expect(signedInsideSnapshot).toBe(false);
    expect(storage.createDownloadTarget).toHaveBeenCalledTimes(2);
    expect(vi.mocked(storage.createDownloadTarget).mock.calls.map(([input]) => input)).toEqual(
      [photos[5]!, photos[4]!].map((p) => ({ objectKey: p.s3Key, expiresInSeconds: 300 })));
    expect(new Set(result.photos.map((p) => p.expiresAt.toISOString()))).toEqual(new Set(["2026-11-10T10:05:00.000Z"]));
    expect(result.nextCursor).not.toBeNull();
  });

  it("reads photos in batches and stops as soon as it has limit + 1 photos", async () => {
    posts = Array.from({ length: 200 }, (_, i) => post(1000 + i, { minutes: i }));
    photos = posts.map((p, i) => photo(1000 + i, 0, { postId: p.id }));
    await page({ limit: 3 });
    expect(batches).toHaveLength(1);
    expect(batches[0]!.length).toBeLessThanOrEqual(50);
    // Only the last posts have photos: the walk must go through several batches and still find them.
    photos = [photos[0]!];
    batches = [];
    const result = await page({ limit: 3 });
    expect(ids(result)).toEqual([photos[0]!.id]);
    expect(batches.length).toBe(4);
    expect(batches.flat()).toHaveLength(200);
  });

  it("keeps the lookahead when the limit equals the batch size: 51 posts of one photo, limit 50", async () => {
    posts = Array.from({ length: 51 }, (_, i) => post(1000 + i, { minutes: i }));
    photos = posts.map((p, i) => photo(1000 + i, 0, { postId: p.id }));
    const expected = [...posts].reverse().map((p) => p.id);
    const first = await page({ limit: 50 });
    expect(first.photos).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();
    const second = await page({ limit: 50, cursor: first.nextCursor });
    expect(second.photos).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect([...first.photos, ...second.photos].map((p) => p.postId)).toEqual(expected);
    const pages = await walk(50);
    expect(pages.map((p) => p.photos.length)).toEqual([50, 1]);
    expect(new Set(pages.flatMap(ids)).size).toBe(51);
  });

  it("keeps looking in the next batch when a full batch ends with a post without photos and limit equals the batch size", async () => {
    // Newest 50 posts: 49 with a photo and the oldest of them without; the 51st-newest post (next batch) has the extra photo.
    posts = Array.from({ length: 52 }, (_, i) => post(1000 + i, { minutes: i }));
    const newestFirst = [...posts].reverse();
    photos = newestFirst.filter((p, i) => i !== 49 && i < 51).map((p) => photo(0, 0, { postId: p.id }));
    expect(photos).toHaveLength(50);
    const first = await page({ limit: 49 });
    expect(first.photos).toHaveLength(49);
    expect(first.nextCursor).not.toBeNull();
    const second = await page({ limit: 49, cursor: first.nextCursor });
    expect(second.photos).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    // limit 50 = batch size: the batch of 50 posts yields exactly 49 photos, the 50th (and last) is in the next batch.
    const wide = await page({ limit: 50 });
    expect(wide.photos).toHaveLength(50);
    expect(wide.nextCursor).toBeNull();
    const pages = await walk(49);
    expect(pages.flatMap(ids)).toEqual(photos.map((p) => p.id));
  });

  it("keeps the lookahead when a batch yields exactly limit = 50 photos and its last post has none", async () => {
    // Newest batch: the newest post has 2 photos, posts 1..48 one each (50 photos), post 49 none; the next batch holds the 51st photo.
    posts = Array.from({ length: 52 }, (_, i) => post(1000 + i, { minutes: i }));
    const newestFirst = [...posts].reverse();
    photos = [photo(0, 0, { postId: newestFirst[0]!.id }), photo(0, 1, { postId: newestFirst[0]!.id }),
      ...newestFirst.slice(1, 49).map((p) => photo(0, 0, { postId: p.id })), photo(0, 0, { postId: newestFirst[50]!.id })];
    expect(photos).toHaveLength(51);
    const first = await page({ limit: 50 });
    expect(first.photos).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();
    const second = await page({ limit: 50, cursor: first.nextCursor });
    expect(second.photos.map((p) => p.id)).toEqual([photos[50]!.id]);
    expect(second.nextCursor).toBeNull();
    const pages = await walk(50);
    expect(pages.flatMap(ids)).toEqual(photos.map((p) => p.id));
  });

  it("returns the storage error without a partial page", async () => {
    posts = [post(10), post(11)]; photos = [photo(10, 0), photo(11, 0)];
    vi.mocked(storage.createDownloadTarget).mockResolvedValueOnce(ok({ downloadUrl: "https://get.test/x" }))
      .mockResolvedValueOnce(err(new UnknownError("boom")));
    expect(await list()).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
  });

  it("returns an empty page for a Trip without photos", async () => {
    posts = [post(10)];
    expect(await page()).toEqual({ photos: [], nextCursor: null });
    expect(storage.createDownloadTarget).not.toHaveBeenCalled();
  });
});
