import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createPhotoUploadKey } from "app-domain";
import { postPhotosByPostsQuery } from "../adapters/mongodb/post-photo-store.js";
import { createMongoTripPostRepository } from "../adapters/mongodb/trip-post-repository.js";
import { PostFixture, domainId } from "../../test/post-fixture.js";
import { FakeObjectStorage } from "../../test/fake-object-storage.js";

describe("photo persistence and transactions", () => {
  const f = new PostFixture();
  let fake: FakeObjectStorage;
  beforeAll(() => f.start("photo_persistence"), 120_000);
  afterAll(() => f.stop());
  // Releases of every pause created by a test. afterEach always frees them (idempotent), so a failed assertion never leaves
  // a transaction open that would block the next reset until the server aborts it. It also waits for every operation the
  // test launched (never launched before `reached` is confirmed, except the one that holds the pause), so none can still
  // run during the next test's reset().
  let pendingReleases: Array<() => void> = [];
  let launched: Array<Promise<unknown>> = [];
  afterEach(async () => {
    for (const release of pendingReleases) release();
    pendingReleases = [];
    await Promise.allSettled(launched);
    launched = [];
  });
  beforeEach(async () => { vi.restoreAllMocks(); fake = new FakeObjectStorage(); f.storage = fake; await f.reset(); });

  const keyFor = (user: ObjectId = f.actor, trip: ObjectId = f.trip, extension: "jpg" | "png" | "webp" = "jpg") => {
    const key = createPhotoUploadKey({ tripId: domainId(trip), userId: domainId(user), uploadId: randomUUID(), extension });
    fake.put(key, { jpg: "image/jpeg", png: "image/png", webp: "image/webp" }[extension]);
    return key;
  };
  const keys = (count: number, user?: ObjectId, trip?: ObjectId) => Array.from({ length: count }, () => keyFor(user, trip));
  const refs = (list: string[]) => list.map((key) => ({ key }));
  const addMember = async (role: "admin" | "participant", tripId = f.trip) => {
    const userId = new ObjectId();
    await f.db.collection("tripMembers").insertOne({ tripId, userId, role, joinedAt: new Date() });
    return userId;
  };
  const createPost = (photos: string[], fields: object = {}, user = f.actor, trip = f.trip) =>
    f.api.createPost!({ tripId: domainId(trip), authenticatedUserId: domainId(user), description: "Recuerdo", photos: refs(photos), ...fields });
  const updatePost = (postId: string, photos: string[], user = f.actor) =>
    f.api.updatePost!({ ...f.context(), authenticatedUserId: domainId(user), postId: domainId(new ObjectId(postId)), photos: refs(photos) });
  const created = async (photos: string[], fields: object = {}) => {
    const result = await createPost(photos, fields);
    if (!result.ok || result.value.outcome !== "created") throw new Error("Post not created.");
    return result.value;
  };
  const snapshot = () => Promise.all(["posts", "postPhotos", "activities", "activityParticipations", "storageDeletionJobs", "tripMembers"]
    .map((name) => f.db.collection(name).find().sort({ _id: 1 }).toArray()));
  const revision = async () => (await f.db.collection("trips").findOne({ _id: f.trip }))!.destinationOrderRevision ?? 0;
  const photoKeys = async (postId?: string) => (await f.db.collection("postPhotos").find(postId ? { postId: new ObjectId(postId) } : {})
    .sort({ order: 1 }).toArray()).map((doc) => doc.s3Key);

  it("stores exactly the PRD photo fields with ObjectId and Date, contiguous order from 1", async () => {
    const list = keys(3), { post, photos } = await created(list);
    const stored = await f.db.collection("postPhotos").find().sort({ order: 1 }).toArray();
    expect(stored).toHaveLength(3);
    for (const [index, doc] of stored.entries()) {
      expect(Object.keys(doc).sort()).toEqual(["_id", "order", "postId", "s3Key", "tripId", "uploadedAt", "uploaderId"]);
      expect(doc).toEqual({ _id: new ObjectId(photos![index]!.id), postId: new ObjectId(post.id), tripId: f.trip, uploaderId: f.actor,
        s3Key: list[index], order: index + 1, uploadedAt: post.createdAt });
      expect(doc.uploadedAt).toBeInstanceOf(Date);
    }
    expect(photos).toEqual(stored.map((doc) => ({ id: doc._id.toHexString(), order: doc.order })));
  });

  it("has the unique indexes: a manual duplicate key or position fails with 11000", async () => {
    const [key] = keys(1), { post } = await created([key!]);
    const doc = { postId: new ObjectId(post.id), tripId: f.trip, uploaderId: f.actor, uploadedAt: new Date() };
    await expect(f.db.collection("postPhotos").insertOne({ _id: new ObjectId(), ...doc, s3Key: key!, order: 2 })).rejects.toMatchObject({ code: 11000 });
    await expect(f.db.collection("postPhotos").insertOne({ _id: new ObjectId(), ...doc, s3Key: "other", order: 1 })).rejects.toMatchObject({ code: 11000 });
  });

  it("takes the Trip lock once per save and never on reads or batch authorization", async () => {
    const start = await revision(), [key] = keys(1);
    expect((await f.api.createPhotoUploads!({ ...f.context(), files: [{ contentType: "image/jpeg", sizeBytes: 1 }] })).ok).toBe(true);
    expect(await revision()).toBe(start);
    const { post } = await created([key!]);
    expect(await revision()).toBe(start + 1);
    expect((await f.api.getPostPhotos!({ ...f.context(), postId: post.id })).ok).toBe(true);
    expect(await revision()).toBe(start + 1);
  });

  describe("atomicity", () => {
    const failOnce = (name: string, method: "insertOne" | "findOneAndUpdate") => {
      const collection = f.db.collection(name), original = f.db.collection.bind(f.db);
      vi.spyOn(collection, method).mockRejectedValueOnce(new Error("forced failure") as never);
      vi.spyOn(f.db, "collection").mockImplementation((key, options) => key === name ? collection : original(key, options));
    };

    it("creates neither post nor photos when the photo write fails", async () => {
      const before = await snapshot(), list = keys(2);
      failOnce("postPhotos", "insertOne");
      expect(await createPost(list)).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
      expect(await snapshot()).toEqual(before);
    });

    it("writes no photos when the post write fails", async () => {
      const before = await snapshot(), list = keys(2);
      failOnce("posts", "insertOne");
      expect(await createPost(list)).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
      expect(await snapshot()).toEqual(before);
    });

    // Lets the first `nth - 1` calls run for real and rejects the `nth` one, so earlier writes of the same batch must be rolled back.
    const failOnNth = (name: string, method: "insertOne", nth: number) => {
      const collection = f.db.collection(name), original = f.db.collection.bind(f.db);
      const real = (collection[method] as (...args: unknown[]) => Promise<unknown>).bind(collection);
      let calls = 0;
      const spy = vi.spyOn(collection, method).mockImplementation((async (...args: unknown[]) => {
        calls++;
        if (calls === nth) throw new Error("forced failure");
        return real(...args);
      }) as never);
      vi.spyOn(f.db, "collection").mockImplementation((key, options) => key === name ? collection : original(key, options));
      return spy;
    };

    it("keeps the previous state when the first insert of an append fails", async () => {
      const { post } = await created(keys(1)), before = await snapshot();
      failOnce("postPhotos", "insertOne");
      expect(await updatePost(post.id, keys(2))).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
      expect(await snapshot()).toEqual(before);
    });

    it("rolls back the photo already inserted in the same batch when the second insert fails on PATCH", async () => {
      const { post } = await created(keys(1)), before = await snapshot();
      const insert = failOnNth("postPhotos", "insertOne", 2);
      expect(await updatePost(post.id, keys(3))).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
      expect(insert).toHaveBeenCalledTimes(2);
      expect(await snapshot()).toEqual(before);
      expect(await photoKeys(post.id)).toHaveLength(1);
    });

    it("creates neither the post nor the photo already inserted when the second photo insert fails on POST", async () => {
      const before = await snapshot();
      const insert = failOnNth("postPhotos", "insertOne", 2);
      expect(await createPost(keys(3))).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
      expect(insert).toHaveBeenCalledTimes(2);
      expect(await snapshot()).toEqual(before);
      expect(await f.db.collection("posts").countDocuments({})).toBe(0);
      expect(await f.db.collection("postPhotos").countDocuments({})).toBe(0);
    });

    it.each([["postPhotos", "insertOne"], ["activityParticipations", "findOneAndUpdate"]] as const)(
      "rolls back activity, post, participation and photos when %s fails with a new activity", async (name, method) => {
        const before = await snapshot(), list = keys(2);
        failOnce(name, method);
        const result = await createPost(list, { newActivity: { title: "Cena", scheduledAt: f.occurrence, durationMinutes: 60 } });
        expect(result).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
        expect(await snapshot()).toEqual(before);
      });

    it("rolls back the link, the activity and the added photos when linking an existing post fails", async () => {
      const { post } = await created(keys(1)), before = await snapshot();
      failOnce("activityParticipations", "findOneAndUpdate");
      const result = await f.api.linkPostToNewActivity!({ ...f.context(), postId: domainId(new ObjectId(post.id)), photos: refs(keys(1)),
        newActivity: { title: "Cena", scheduledAt: f.occurrence, durationMinutes: 60 } });
      expect(result).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
      expect(await snapshot()).toEqual(before);
    });
  });

  describe("idempotency, conflicts and limits", () => {
    it("registers a retried key once, keeping id and order", async () => {
      const list = keys(2), { post, photos } = await created(list);
      const again = await updatePost(post.id, [...list].reverse());
      expect(again).toMatchObject({ ok: true, value: { photos } });
      expect(await photoKeys()).toEqual(list);
      expect(await f.db.collection("postPhotos").countDocuments({})).toBe(2);
    });

    it("rejects a key registered in another post with PhotoConflictError, the post keeps its own photos", async () => {
      const list = keys(1), { post } = await created(list);
      const second = await f.api.createPost!({ ...f.context(), description: "Otro" });
      if (!second.ok || second.value.outcome !== "created") throw new Error("Post not created.");
      const before = await snapshot();
      expect(await updatePost(second.value.post.id, list)).toMatchObject({ ok: false, error: { tag: "PhotoConflictError" } });
      expect(await createPost(list)).toMatchObject({ ok: false, error: { tag: "PhotoConflictError" } });
      expect(await snapshot()).toEqual(before);
      expect(await photoKeys(post.id)).toEqual(list);
    });

    // The planning reads (`find`) are pointed at nothing, so the duplicate only surfaces from the unique index on `insertOne`.
    const blindFind = (matches: (filter: Record<string, unknown>) => boolean) => {
      const collection = f.db.collection("postPhotos"), original = f.db.collection.bind(f.db);
      const real = (collection.find as (...args: unknown[]) => unknown).bind(collection);
      vi.spyOn(collection, "find").mockImplementation(((filter: Record<string, unknown>, ...rest: unknown[]) =>
        real(filter !== undefined && matches(filter) ? { _id: { $in: [] } } : filter, ...rest)) as never);
      const insert = vi.spyOn(collection, "insertOne");
      vi.spyOn(f.db, "collection").mockImplementation((key, options) => key === "postPhotos" ? collection : original(key, options));
      return insert;
    };

    it("maps the duplicate s3Key index (11000) raised by the insert to PhotoConflictError and rolls the whole save back", async () => {
      const list = keys(1);
      await created(list);
      const other = await f.api.createPost!({ ...f.context(), description: "Otro" });
      if (!other.ok || other.value.outcome !== "created") throw new Error("Post not created.");
      const before = await snapshot();
      const insert = blindFind((filter) => "s3Key" in filter);
      expect(await createPost(list)).toMatchObject({ ok: false, error: { tag: "PhotoConflictError" } });
      expect(await updatePost(other.value.post.id, list)).toMatchObject({ ok: false, error: { tag: "PhotoConflictError" } });
      expect(insert).toHaveBeenCalledTimes(2);
      expect(await snapshot()).toEqual(before);
    });

    it("maps the duplicate (postId, order) index (11000) raised by the insert to PhotoConflictError and keeps the post unchanged", async () => {
      const { post } = await created(keys(1)), before = await snapshot();
      const insert = blindFind((filter) => "postId" in filter && !("s3Key" in filter));
      expect(await updatePost(post.id, keys(1))).toMatchObject({ ok: false, error: { tag: "PhotoConflictError" } });
      expect(insert).toHaveBeenCalledTimes(1);
      expect(await snapshot()).toEqual(before);
    });

    it("never registers a key of another Trip: the format check rejects it and the store refuses foreign Trip photos", async () => {
      const tripB = new ObjectId(), memberB = new ObjectId();
      await f.db.collection("trips").insertOne({ _id: tripB, inviteCode: tripB.toHexString(), visibility: "public", votingEnabled: false, expenseMode: "register" });
      await f.db.collection("tripMembers").insertOne({ tripId: tripB, userId: memberB, role: "participant", joinedAt: new Date() });
      const { post } = await created(keys(1)), before = await snapshot();
      expect(await createPost(keys(1, f.actor, tripB))).toMatchObject({ ok: false, error: { tag: "ValidationError" } });
      expect(await createPost(keys(1, memberB, tripB), {}, memberB, tripB)).toMatchObject({ ok: true });
      const foreign = await createMongoTripPostRepository(f.db).withTransaction(domainId(f.trip), (scope) => scope.insertPhotos([{
        id: domainId(new ObjectId()), postId: domainId(new ObjectId(post.id)), tripId: domainId(tripB), uploaderId: domainId(f.actor),
        s3Key: "x", order: 9, uploadedAt: new Date() }]));
      expect(foreign).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
      const after = await snapshot();
      expect(after[1]).toHaveLength(2);
      expect(after[0]).toHaveLength(2);
      expect(before[1]).toHaveLength(1);
    });

    it("caps a post at 10 photos and keeps the contiguous order after appends", async () => {
      const { post } = await created(keys(4));
      expect(await updatePost(post.id, keys(6))).toMatchObject({ ok: true });
      expect((await f.db.collection("postPhotos").find().sort({ order: 1 }).toArray()).map((doc) => doc.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const before = await snapshot();
      expect(await updatePost(post.id, keys(1))).toMatchObject({ ok: false, error: { tag: "ValidationError" } });
      expect(await snapshot()).toEqual(before);
    });
  });

  // Deterministic ordering: the first call of `method` on `name` runs for real and then stays paused (its transaction
  // open, Trip lock already taken) until `release()`. The rival operation is started while the pause holds.
  const pauseAfterFirst = (name: string, method: "insertOne" | "updateOne" | "findOne") => {
    const collection = f.db.collection(name), original = f.db.collection.bind(f.db);
    const real = (collection[method] as (...args: unknown[]) => Promise<unknown>).bind(collection);
    let reached!: () => void, release!: () => void, first = true;
    const reachedPromise = new Promise<void>((resolve) => { reached = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    pendingReleases.push(() => release());
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`The first ${name}.${method} never ran.`)), 3_000); });
    const reachedOrTimeout = Promise.race([reachedPromise, timeout]).finally(() => clearTimeout(timer));
    reachedOrTimeout.catch(() => undefined);
    vi.spyOn(collection, method).mockImplementation((async (...args: unknown[]) => {
      const result = await real(...args);
      if (first) { first = false; reached(); await gate; }
      return result;
    }) as never);
    vi.spyOn(f.db, "collection").mockImplementation((key, options) => key === name ? collection : original(key, options));
    return { reached: reachedOrTimeout, release: () => release() };
  };
  const launch = <T>(promise: Promise<T>) => { launched.push(promise); return promise; };
  const track = <T>(promise: Promise<T>) => { const state = { settled: false }; void promise.finally(() => { state.settled = true; }); return state; };
  // Real timeout (15 s) above Vitest's 5 s default and above the 3 s `reached` limit, so the clear message wins.
  const concurrent = (name: string, fn: () => Promise<void>) => it(name, fn, 15_000);
  const pause = () => new Promise((resolve) => setTimeout(resolve, 500));
  const expel = (admin: ObjectId) => f.api.expelMember!({ tripId: domainId(f.trip), actorUserId: domainId(admin), targetUserId: domainId(f.actor) });
  const deleteTrip = () => f.api.delete!({ tripId: domainId(f.trip), authenticatedUserId: domainId(f.actor) });

  concurrent("makes an expulsion wait for an in-flight photo save, which keeps the former member's photos with uploaderId", async () => {
    const admin = await addMember("admin"), list = keys(2);
    const paused = pauseAfterFirst("postPhotos", "insertOne");
    const saving = launch(createPost(list));
    let expelling!: ReturnType<typeof expel>;
    try {
      await paused.reached;
      expelling = launch(expel(admin)); const expulsion = track(expelling);
      await pause();
      expect(expulsion.settled, "expulsion finished while the photo save transaction was open").toBe(false);
    } finally { paused.release(); }
    const [saved, expelled] = await Promise.all([saving, expelling]);
    expect(saved.ok).toBe(true);
    expect(expelled.ok).toBe(true);
    expect(await f.db.collection("postPhotos").find().sort({ order: 1 }).toArray()).toMatchObject(
      list.map((s3Key, index) => ({ s3Key, uploaderId: f.actor, tripId: f.trip, order: index + 1 })));
    expect(await f.db.collection("posts").countDocuments({ authorId: f.actor })).toBe(1);
    expect(await f.db.collection("tripMembers").countDocuments({ userId: f.actor })).toBe(0);
  });

  concurrent("makes a photo save wait for an in-flight expulsion and then fail with 404 without writing photos", async () => {
    const admin = await addMember("admin"), list = keys(1);
    const paused = pauseAfterFirst("trips", "updateOne");
    const expelling = launch(expel(admin));
    let saving!: ReturnType<typeof createPost>;
    try {
      await paused.reached;
      saving = launch(createPost(list)); const save = track(saving);
      await pause();
      expect(save.settled, "photo save finished while the expulsion transaction was open").toBe(false);
    } finally { paused.release(); }
    const [expelled, saved] = await Promise.all([expelling, saving]);
    expect(expelled.ok).toBe(true);
    expect(saved).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    expect(await f.db.collection("postPhotos").countDocuments({})).toBe(0);
    expect(await f.db.collection("posts").countDocuments({})).toBe(0);
  });

  concurrent("lets exactly one of two concurrent saves register the same key and answers 409 to the other, without duplicates", async () => {
    const [key] = keys(1);
    const paused = pauseAfterFirst("postPhotos", "insertOne");
    const first = launch(createPost([key!]));
    let second!: ReturnType<typeof createPost>;
    try {
      await paused.reached;
      second = launch(createPost([key!])); const rival = track(second);
      await pause();
      expect(rival.settled, "second save finished while the first transaction was open").toBe(false);
    } finally { paused.release(); }
    const [a, b] = await Promise.all([first, second]);
    expect(a.ok).toBe(true);
    expect(b).toMatchObject({ ok: false, error: { tag: "PhotoConflictError" } });
    expect(await photoKeys()).toEqual([key]);
    expect(await f.db.collection("posts").countDocuments({})).toBe(1);
  });

  concurrent("makes Trip deletion wait for an in-flight photo save and keeps a cleanup job with its keys", async () => {
    await f.db.collection("tripMembers").updateOne({ tripId: f.trip }, { $set: { role: "admin" } });
    const list = keys(2);
    const paused = pauseAfterFirst("postPhotos", "insertOne");
    const saving = launch(createPost(list));
    let deleting!: ReturnType<typeof deleteTrip>;
    try {
      await paused.reached;
      deleting = launch(deleteTrip()); const deletion = track(deleting);
      await pause();
      expect(deletion.settled, "deletion finished while the photo save transaction was open").toBe(false);
    } finally { paused.release(); }
    const [saved, deleted] = await Promise.all([saving, deleting]);
    expect(saved.ok).toBe(true);
    expect(deleted.ok).toBe(true);
    expect(await f.db.collection("postPhotos").countDocuments({})).toBe(0);
    const jobs = await f.db.collection("storageDeletionJobs").find({ tripId: f.trip }).toArray();
    expect(jobs).toHaveLength(1);
    expect([...jobs[0]!.objectKeys].sort()).toEqual([...list].sort());
  });

  concurrent("makes a photo save wait for an in-flight Trip deletion and then fail without leaving photos or jobs", async () => {
    await f.db.collection("tripMembers").updateOne({ tripId: f.trip }, { $set: { role: "admin" } });
    const list = keys(1);
    const paused = pauseAfterFirst("trips", "updateOne");
    const deleting = launch(deleteTrip());
    let saving!: ReturnType<typeof createPost>;
    try {
      await paused.reached;
      saving = launch(createPost(list)); const save = track(saving);
      await pause();
      expect(save.settled, "photo save finished while the deletion transaction was open").toBe(false);
    } finally { paused.release(); }
    const [deleted, saved] = await Promise.all([deleting, saving]);
    expect(deleted.ok).toBe(true);
    expect(saved).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    expect(await f.db.collection("postPhotos").countDocuments({})).toBe(0);
    expect(await f.db.collection("storageDeletionJobs").countDocuments({})).toBe(0);
  });

  describe("gallery listing", () => {
    const at = (minutes: number) => new Date(Date.parse("2026-10-01T10:00:00.000Z") + minutes * 60_000);
    const seedPost = async (fields: { createdAt: Date; activityId?: ObjectId | null; parentPostId?: ObjectId | null; authorId?: ObjectId; tripId?: ObjectId }) => {
      const _id = new ObjectId();
      await f.db.collection("posts").insertOne({ _id, tripId: fields.tripId ?? f.trip, authorId: fields.authorId ?? f.actor, description: null, mapsUrl: null,
        activityId: fields.activityId ?? null, parentPostId: fields.parentPostId ?? null, transportId: null, createdAt: fields.createdAt });
      return _id;
    };
    const seedPhotos = async (postId: ObjectId, count: number, extra: { tripId?: ObjectId; uploaderId?: ObjectId } = {}) => {
      const tripId = extra.tripId ?? f.trip, uploaderId = extra.uploaderId ?? f.actor;
      const docs = Array.from({ length: count }, (_, index) => ({ _id: new ObjectId(), postId, tripId, uploaderId, order: index + 1,
        s3Key: `trips/${tripId.toHexString()}/photos/${uploaderId.toHexString()}/${randomUUID()}.jpg`, uploadedAt: at(0) }));
      if (docs.length > 0) await f.db.collection("postPhotos").insertMany(docs);
      return docs;
    };
    const list = (extra: Record<string, unknown> = {}, user: ObjectId = f.actor, trip: ObjectId = f.trip) =>
      f.api.listPhotos!({ tripId: domainId(trip), authenticatedUserId: domainId(user), ...extra });
    const page = async (extra: Record<string, unknown> = {}, user?: ObjectId) => {
      const result = await list(extra, user);
      if (!result.ok) throw new Error(`unexpected ${result.error.tag}`);
      return result.value;
    };
    const walk = async (limit: number, extra: Record<string, unknown> = {}) => {
      const pages = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 100; guard++) {
        const current = await page({ limit, cursor, ...extra });
        pages.push(current);
        if (current.nextCursor === null) return pages;
        cursor = current.nextCursor;
      }
      throw new Error("pagination does not end");
    };
    /** Independent oracle: reads the collections and sorts with plain comparisons. */
    const expectedIds = async (tripId: ObjectId = f.trip) => {
      const posts = await f.db.collection("posts").find({ tripId }).toArray();
      const photos = await f.db.collection("postPhotos").find({ tripId }).toArray();
      const rank = new Map(posts.map((post) => [post._id.toHexString(), post]));
      return photos.filter((photo) => rank.has(photo.postId.toHexString()))
        .sort((a, b) => {
          const pa = rank.get(a.postId.toHexString())!, pb = rank.get(b.postId.toHexString())!;
          const ha = a.postId.toHexString(), hb = b.postId.toHexString();
          return pb.createdAt.getTime() - pa.createdAt.getTime() || (ha < hb ? 1 : ha > hb ? -1 : 0) || a.order - b.order;
        }).map((photo) => photo._id.toHexString());
    };
    const idsOf = (pages: Array<{ photos: Array<{ id: string }> }>) => pages.flatMap((p) => p.photos.map((photo) => photo.id));
    const createActivity = async () => {
      const created = await f.api.createPost!({ ...f.input(), dayId: domainId(f.day), newActivity: { title: "Cena", scheduledAt: f.occurrence, durationMinutes: 60 } });
      if (!created.ok || created.value.outcome !== "created" || !created.value.activity) throw new Error("Activity not created.");
      return created.value.activity.id;
    };

    it("pages real data with tied publication instants without duplicates or gaps, ending with a null cursor", async () => {
      const posts = [at(0), at(0), at(0), at(0), at(1), at(1), at(1), at(-1), at(5)];
      for (const [index, createdAt] of posts.entries()) await seedPhotos(await seedPost({ createdAt }), index % 4);
      const expected = await expectedIds();
      expect(expected.length).toBeGreaterThan(10);
      for (const limit of [1, 3, 4, expected.length, expected.length + 5]) {
        const pages = await walk(limit);
        expect(idsOf(pages), `limit ${limit}`).toEqual(expected);
        expect(pages.at(-1)!.nextCursor).toBeNull();
        expect(pages.slice(0, -1).every((p) => p.photos.length === limit && p.nextCursor !== null)).toBe(true);
      }
    });

    it("signs only the photos of the page, with 300 s URLs, and never takes the Trip lock", async () => {
      for (let i = 0; i < 4; i++) await seedPhotos(await seedPost({ createdAt: at(i) }), 2);
      const start = await revision();
      const first = await page({ limit: 3 });
      expect(fake.downloads).toHaveLength(3);
      expect(fake.downloads.every((d) => d.expiresInSeconds === 300)).toBe(true);
      const keysOfPage = (await f.db.collection("postPhotos").find({ _id: { $in: first.photos.map((p) => new ObjectId(p.id)) } }).toArray()).map((d) => d.s3Key).sort();
      expect(fake.downloads.map((d) => d.objectKey).sort()).toEqual(keysOfPage);
      expect(await revision()).toBe(start);
      expect(JSON.stringify(first)).not.toContain("s3Key");
      expect(Object.keys(first.photos[0]!).sort()).toEqual(["expiresAt", "id", "order", "post", "postId", "uploadedAt", "uploaderId", "url"]);
      expect(Object.keys(first.photos[0]!.post).sort()).toEqual(["authorId", "createdAt", "rootActivityId", "rootTransportId"]);
    });

    it("runs the exact photo query by posts as an index scan on postId without COLLSCAN", async () => {
      const ids = [await seedPost({ createdAt: at(0) }), await seedPost({ createdAt: at(1) })];
      for (const id of ids) await seedPhotos(id, 2);
      const { filter, sort } = postPhotosByPostsQuery(f.trip, ids.map(domainId));
      const plan = await f.db.collection("postPhotos").find(filter).sort(sort).explain("queryPlanner");
      const winning = JSON.stringify(plan.queryPlanner.winningPlan);
      expect(winning).toContain("IXSCAN");
      expect(winning).not.toContain("COLLSCAN");
      expect(winning).toMatch(/"indexName":"postId(_order_unique)?"/);
    });

    it("includes independent posts and posts far outside the itinerary dates", async () => {
      const ids = [await seedPost({ createdAt: new Date("2001-01-01T00:00:00.000Z") }), await seedPost({ createdAt: new Date("2090-01-01T00:00:00.000Z") })];
      for (const id of ids) await seedPhotos(id, 1);
      expect((await page()).photos.map((p) => p.postId)).toEqual([ids[1]!.toHexString(), ids[0]!.toHexString()]);
    });

    it("keeps the other pages consistent when a post is published between them, and sees it from a new first page", async () => {
      for (let i = 0; i < 4; i++) await seedPhotos(await seedPost({ createdAt: at(i) }), 2);
      const first = await page({ limit: 3 });
      const created = await createPost(keys(1));
      if (!created.ok || created.value.outcome !== "created") throw new Error("Post not created.");
      const rest = await walk(3);
      const continued = [];
      let cursor = first.nextCursor;
      while (cursor !== null) { const next = await page({ limit: 3, cursor }); continued.push(next); cursor = next.nextCursor; }
      const seen = [...idsOf([first]), ...idsOf(continued)];
      expect(new Set(seen).size).toBe(seen.length);
      expect(seen).toHaveLength(8);
      expect(idsOf(rest)).toHaveLength(9);
      expect(rest[0]!.photos[0]!.postId).toBe(created.value.post.id);
    });

    it("lets a page read finish while a publication is open, without waiting and without seeing it", async () => {
      for (let i = 0; i < 4; i++) await seedPhotos(await seedPost({ createdAt: at(i) }), 2);
      const first = await page({ limit: 3 }), expected = await expectedIds();
      const paused = pauseAfterFirst("posts", "insertOne");
      const publishing = launch(createPost(keys(1)));
      let second!: Awaited<ReturnType<typeof page>>;
      try {
        await paused.reached;
        second = await page({ limit: 3, cursor: first.nextCursor });
      } finally { paused.release(); }
      expect((await publishing).ok).toBe(true);
      expect(idsOf([first, second])).toEqual(expected.slice(0, 6));
      const third = await page({ limit: 3, cursor: second.nextCursor });
      expect(idsOf([first, second, third])).toEqual(expected);
      expect(third.nextCursor).toBeNull();
    }, 15_000);

    it("keeps the group listing complete when an activity is deleted or a post is relinked between pages, leaving postPhotos intact", async () => {
      const activity = await createActivity(), mongoActivity = new ObjectId(activity);
      const root = await seedPost({ createdAt: at(1), activityId: mongoActivity });
      const child = await seedPost({ createdAt: at(2), parentPostId: root }), grandchild = await seedPost({ createdAt: at(3), parentPostId: child });
      const other = await seedPost({ createdAt: at(4) });
      for (const id of [root, child, grandchild, other]) await seedPhotos(id, 2);
      const inActivity = await walk(3, { activityId: activity });
      expect(idsOf(inActivity)).toHaveLength(6);
      expect(inActivity.flatMap((p) => p.photos).every((photo) => photo.post.rootActivityId === activity)).toBe(true);
      const expected = await expectedIds(), before = await f.db.collection("postPhotos").find().sort({ _id: 1 }).toArray();
      const first = await page({ limit: 3 });
      // Relink the root away from the activity: its descendants leave the filter, nothing is deleted.
      expect((await f.api.updatePost!({ ...f.context(), postId: domainId(root), activityId: null })).ok).toBe(true);
      expect(idsOf(await walk(3, { activityId: activity }))).toHaveLength(0);
      expect((await f.api.updatePost!({ ...f.context(), postId: domainId(root), activityId: domainId(mongoActivity) })).ok).toBe(true);
      expect(idsOf(await walk(3, { activityId: activity }))).toHaveLength(6);
      // Delete the activity between two pages of the general listing.
      expect((await f.api.deleteActivity!({ ...f.context(), activityId: domainId(mongoActivity) })).ok).toBe(true);
      const rest = [];
      let cursor = first.nextCursor;
      while (cursor !== null) { const next = await page({ limit: 3, cursor }); rest.push(next); cursor = next.nextCursor; }
      expect(idsOf([first, ...rest])).toEqual(expected);
      expect(await f.db.collection("postPhotos").find().sort({ _id: 1 }).toArray()).toEqual(before);
      expect(await list({ activityId: activity })).toMatchObject({ ok: false, error: { tag: "ActivityNotFoundError" } });
      expect((await page({ limit: 60 })).photos.every((photo) => photo.post.rootActivityId === null)).toBe(true);
    });

    it("lets a read that started before an expulsion finish on its snapshot and answers 404 to the next page", async () => {
      const admin = await addMember("admin");
      for (let i = 0; i < 4; i++) await seedPhotos(await seedPost({ createdAt: at(i) }), 2);
      const first = await page({ limit: 3 }), expected = await expectedIds();
      const paused = pauseAfterFirst("tripMembers", "findOne");
      const reading = launch(list({ limit: 3, cursor: first.nextCursor }));
      let expelled!: Awaited<ReturnType<typeof expel>>;
      try {
        await paused.reached;
        expelled = await expel(admin);
      } finally { paused.release(); }
      const second = await reading;
      expect(expelled.ok).toBe(true);
      expect(second.ok).toBe(true);
      expect(second.ok && second.value.photos.map((p) => p.id)).toEqual(expected.slice(3, 6));
      expect(await list({ limit: 3, cursor: second.ok ? second.value.nextCursor : undefined })).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
      expect(await list({})).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    }, 15_000);

    it("keeps serving the photos of a former member to the remaining members, with their ids", async () => {
      const admin = await addMember("admin");
      await seedPhotos(await seedPost({ createdAt: at(1) }), 2);
      expect((await expel(admin)).ok).toBe(true);
      const result = await page({}, admin);
      expect(result.photos).toHaveLength(2);
      expect(result.photos.every((photo) => photo.uploaderId === f.actor.toHexString() && photo.post.authorId === f.actor.toHexString())).toBe(true);
    });

    it("isolates two Trips: foreign photos, foreign posts and corrupt records never show up", async () => {
      const tripB = new ObjectId(), memberB = new ObjectId(), activityB = new ObjectId();
      await f.db.collection("trips").insertOne({ _id: tripB, inviteCode: tripB.toHexString(), visibility: "public", votingEnabled: false, expenseMode: "register" });
      await f.db.collection("tripMembers").insertOne({ tripId: tripB, userId: memberB, role: "participant", joinedAt: new Date() });
      await f.db.collection("activities").insertOne({ _id: activityB, tripId: tripB, dayId: new ObjectId(), title: "B", scheduledAt: at(0) });
      const own = await seedPost({ createdAt: at(1) }), foreignPost = await seedPost({ createdAt: at(9), tripId: tripB, authorId: memberB });
      const ownPhotos = await seedPhotos(own, 2);
      await seedPhotos(foreignPost, 3, { tripId: tripB, uploaderId: memberB });
      await seedPhotos(own, 0);
      // Corrupt records: a photo of the Trip's post stamped with another Trip, and a photo of this Trip pointing at a foreign post.
      await f.db.collection("postPhotos").insertOne({ _id: new ObjectId(), postId: own, tripId: tripB, uploaderId: memberB, order: 7, s3Key: "corrupt-1", uploadedAt: at(0) });
      await f.db.collection("postPhotos").insertOne({ _id: new ObjectId(), postId: foreignPost, tripId: f.trip, uploaderId: f.actor, order: 8, s3Key: "corrupt-2", uploadedAt: at(0) });
      expect((await page({ limit: 60 })).photos.map((p) => p.id)).toEqual(ownPhotos.map((d) => d._id.toHexString()));
      // The adapter itself already scopes by Trip (the use case checks again, so this is the only place that proves the query).
      const scoped = await createMongoTripPostRepository(f.db).withReadSnapshot(domainId(f.trip), (scope) =>
        scope.listPhotosByPosts([domainId(own), domainId(foreignPost)]));
      expect(scoped.ok && scoped.value.map((photo) => [photo.postId, photo.tripId, photo.order]).sort()).toEqual([
        ...ownPhotos.map((d) => [domainId(own), domainId(f.trip), d.order]), [domainId(foreignPost), domainId(f.trip), 8]].sort());
      expect(await list({}, memberB)).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
      const ofB = await list({ limit: 60 }, memberB, tripB);
      expect(ofB.ok && ofB.value.photos.map((p) => [p.postId, p.order])).toEqual([1, 2, 3].map((order) => [foreignPost.toHexString(), order]));
      expect(await list({ activityId: domainId(activityB) })).toMatchObject({ ok: false, error: { tag: "ActivityNotFoundError" } });
    });
  });

  it("serves the photos of a former member to the remaining members after the expulsion", async () => {
    const admin = await addMember("admin"), { post } = await created(keys(1));
    expect((await expel(admin)).ok).toBe(true);
    const read = await f.api.getPostPhotos!({ tripId: domainId(f.trip), authenticatedUserId: domainId(admin), postId: post.id });
    expect(read).toMatchObject({ ok: true, value: [{ uploaderId: f.actor.toHexString(), order: 1 }] });
  });
});
