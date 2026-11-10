import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createPhotoUploadKey } from "app-domain";
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

    it("keeps the earlier photos when a later append fails midway", async () => {
      const { post } = await created(keys(1)), before = await snapshot();
      failOnce("postPhotos", "insertOne");
      expect(await updatePost(post.id, keys(2))).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
      expect(await snapshot()).toEqual(before);
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
  const pauseAfterFirst = (name: string, method: "insertOne" | "updateOne") => {
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

  it("serves the photos of a former member to the remaining members after the expulsion", async () => {
    const admin = await addMember("admin"), { post } = await created(keys(1));
    expect((await expel(admin)).ok).toBe(true);
    const read = await f.api.getPostPhotos!({ tripId: domainId(f.trip), authenticatedUserId: domainId(admin), postId: post.id });
    expect(read).toMatchObject({ ok: true, value: [{ uploaderId: f.actor.toHexString(), order: 1 }] });
  });
});
