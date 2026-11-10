import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { ABANDONED_UPLOAD_MIN_AGE_SECONDS, STORAGE_DELETION_LEASE_SECONDS, computeRetryDelay, createPhotoUploadKey, processStorageDeletionJobs,
  sweepAbandonedPhotoUploads, type ProcessStorageDeletionJobsDeps } from "app-domain";
import { migrateMongoSchema, STORAGE_DELETION_MIGRATION_ID } from "../adapters/mongodb/migrations.js";
import { createMongoPhotoLinkRepository } from "../adapters/mongodb/photo-link-repository.js";
import { createMongoStorageDeletionJobRepository } from "../adapters/mongodb/storage-deletion-job-repository.js";
import { PostFixture, domainId } from "../../test/post-fixture.js";
import { FakeObjectStorage } from "../../test/fake-object-storage.js";
import { FakeCleanupStorage } from "../../test/fake-cleanup-storage.js";

// The clock is always injected: workers run "in the future" of whatever the real clock is, and the sweep at a fixed instant.
const WORKER_NOW = new Date("2099-01-01T00:00:00.000Z");
const SWEEP_NOW = new Date("2026-11-10T12:00:00.000Z");
const ago = (seconds: number) => new Date(SWEEP_NOW.getTime() - seconds * 1000);
const OLD = ABANDONED_UPLOAD_MIN_AGE_SECONDS + 60;

describe("storage cleanup: Trip deletion jobs and abandoned uploads", () => {
  const f = new PostFixture();
  let fake: FakeObjectStorage, cleanup: FakeCleanupStorage, owners: number;
  beforeAll(() => f.start("storage_cleanup"), 120_000);
  afterAll(() => f.stop());
  let pendingReleases: Array<() => void> = [];
  let launched: Array<Promise<unknown>> = [];
  afterEach(async () => {
    for (const release of pendingReleases) release();
    pendingReleases = [];
    await Promise.allSettled(launched);
    launched = [];
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    fake = new FakeObjectStorage(); cleanup = new FakeCleanupStorage(); owners = 0;
    f.storage = fake; await f.reset();
    await f.db.collection("tripMembers").updateOne({ tripId: f.trip, userId: f.actor }, { $set: { role: "admin" } });
  });

  const jobsCollection = () => f.db.collection("storageDeletionJobs");
  const keyOf = (trip: ObjectId, user: ObjectId = f.actor, uploadId: string = randomUUID()) =>
    createPhotoUploadKey({ tripId: domainId(trip), userId: domainId(user), uploadId, extension: "jpg" });
  /** Registers photos through the real T72 protocol and mirrors the objects in the cleanup bucket. */
  const attach = async (count: number, user: ObjectId = f.actor) => {
    const list = Array.from({ length: count }, () => keyOf(f.trip, user));
    for (const key of list) { fake.put(key, "image/jpeg"); cleanup.put(key, ago(10)); }
    const post = await f.api.createPost!({ tripId: domainId(f.trip), authenticatedUserId: domainId(user), description: "Recuerdo", photos: list.map((key) => ({ key })) });
    if (!post.ok) throw post.error;
    return list;
  };
  /** Another Trip whose photo keys look like the removed Trip's (same user, same upload id). */
  const otherTrip = async (uploadId: string) => {
    const trip = new ObjectId(), key = keyOf(trip, f.actor, uploadId);
    await f.db.collection("trips").insertOne({ _id: trip, inviteCode: trip.toHexString() });
    await f.db.collection("postPhotos").insertOne({ tripId: trip, postId: new ObjectId(), uploaderId: f.actor, s3Key: key, order: 1, uploadedAt: new Date() });
    cleanup.put(key, ago(10));
    return { trip, key };
  };
  const deleteTripRequest = () => f.request("DELETE", `/trips/${f.trip}`);
  const deps = (over: Partial<ProcessStorageDeletionJobsDeps> = {}, now: Date = WORKER_NOW): ProcessStorageDeletionJobsDeps => ({
    jobs: createMongoStorageDeletionJobRepository(f.db), links: createMongoPhotoLinkRepository(f.db), storage: cleanup,
    now: () => now, createOwner: () => `owner-${++owners}`, deadline: new Date(now.getTime() + 45_000), maxJobs: 10, ...over });
  const sweep = (over: Partial<Parameters<typeof sweepAbandonedPhotoUploads>[0]> = {}) => sweepAbandonedPhotoUploads({
    links: createMongoPhotoLinkRepository(f.db), storage: cleanup, now: () => SWEEP_NOW, deadline: new Date(SWEEP_NOW.getTime() + 45_000), maxPages: 20, ...over });
  const onlyJob = async () => (await jobsCollection().find({}).toArray())[0]!;

  it("deletes the Trip over HTTP without touching the storage, then the worker deletes only that Trip's keys", async () => {
    const mine = await attach(3), other = await otherTrip(mine[0]!.split("/").pop()!.replace(".jpg", ""));
    cleanup.put("trips/unrelated/other.jpg", ago(10));
    const response = await deleteTripRequest();
    expect(response.statusCode).toBe(204);
    expect(cleanup.deleteCalls).toBe(0);
    expect(await f.db.collection("trips").findOne({ _id: f.trip })).toBeNull();
    expect(await onlyJob()).toMatchObject({ tripId: f.trip, status: "pending", attempts: 0, resolvedKeys: [] });
    const result = await processStorageDeletionJobs(deps());
    expect(result).toEqual({ ok: true, value: { processed: 1, completed: 1, failed: 0, exhausted: 0, resolvedKeys: 3, rejectedKeys: 0, claimFailed: false } });
    expect([...cleanup.deleted].sort()).toEqual([...mine].sort());
    expect(cleanup.keys()).toEqual([other.key, "trips/unrelated/other.jpg"].sort());
    expect(await onlyJob()).toMatchObject({ status: "completed", completedAt: WORKER_NOW });
    expect([...(await onlyJob()).resolvedKeys].sort()).toEqual([...mine].sort());
    expect(await f.db.collection("postPhotos").countDocuments({ s3Key: other.key })).toBe(1);
  });

  it("answers 204 and keeps the Trip deleted when the storage fails afterwards, recording attempts and the error code", async () => {
    const mine = await attach(2);
    expect((await deleteTripRequest()).statusCode).toBe(204);
    cleanup.failAllDeletes = true;
    const result = await processStorageDeletionJobs(deps());
    expect(result).toMatchObject({ ok: true, value: { processed: 1, completed: 0, failed: 1 } });
    expect(await f.db.collection("trips").findOne({ _id: f.trip })).toBeNull();
    expect(await f.db.collection("tripMembers").countDocuments({ tripId: f.trip })).toBe(0);
    expect(await onlyJob()).toMatchObject({ status: "pending", attempts: 1, lastErrorCode: "delete_failed", resolvedKeys: [],
      nextAttemptAt: new Date(WORKER_NOW.getTime() + computeRetryDelay(1)) });
    expect(await onlyJob()).not.toHaveProperty("leaseOwner");
    expect([...(await onlyJob()).objectKeys].sort()).toEqual([...mine].sort());
  });

  it("keeps partial progress on a failure and a rerun only deletes what is pending", async () => {
    const [a, b, c] = await attach(3) as [string, string, string];
    await deleteTripRequest();
    cleanup.failDeleteFor.add(b);
    await processStorageDeletionJobs(deps());
    expect((await onlyJob()).status).toBe("pending");
    expect([...(await onlyJob()).resolvedKeys].sort()).toEqual([a, c].sort());
    expect(cleanup.keys()).toEqual([b]);
    const callsBefore = cleanup.deleteCalls;
    const early = await processStorageDeletionJobs(deps({}, new Date(WORKER_NOW.getTime() + computeRetryDelay(1) - 1)));
    expect(early).toMatchObject({ ok: true, value: { processed: 0 } });
    expect(cleanup.deleteCalls).toBe(callsBefore);
    cleanup.failDeleteFor.clear();
    const rerun = await processStorageDeletionJobs(deps({}, new Date(WORKER_NOW.getTime() + computeRetryDelay(1))));
    expect(rerun).toMatchObject({ ok: true, value: { processed: 1, completed: 1, resolvedKeys: 1 } });
    expect(cleanup.deleteCalls - callsBefore).toBe(1);
    expect(cleanup.keys()).toEqual([]);
    expect(await onlyJob()).toMatchObject({ status: "completed", attempts: 1 });
  });

  it("completes a job whose objects are already absent from the bucket", async () => {
    const mine = await attach(2);
    await deleteTripRequest();
    for (const key of mine) cleanup.objects.delete(key);
    expect(await processStorageDeletionJobs(deps())).toMatchObject({ ok: true, value: { completed: 1, resolvedKeys: 2 } });
  });

  it("never deletes foreign keys of a job: they are rejected and the job completes", async () => {
    const trip = f.trip, own = keyOf(trip), foreign = keyOf(new ObjectId());
    cleanup.put(own, ago(10)); cleanup.put(foreign, ago(10));
    await jobsCollection().insertOne({ tripId: trip, objectKeys: [own, foreign, "../escape.jpg", "avatars/x.jpg"], createdAt: ago(10), status: "pending", attempts: 0,
      resolvedKeys: [], rejectedKeys: [], nextAttemptAt: ago(10) });
    await f.db.collection("trips").deleteOne({ _id: trip });
    expect(await processStorageDeletionJobs(deps())).toMatchObject({ ok: true, value: { completed: 1, resolvedKeys: 1, rejectedKeys: 3 } });
    expect(cleanup.deleted).toEqual([own]);
    expect(cleanup.keys()).toEqual([foreign]);
    expect(await onlyJob()).toMatchObject({ status: "completed", rejectedKeys: [foreign, "../escape.jpg", "avatars/x.jpg"] });
  });

  it("never deletes an object that is still linked to a photo, even if a job lists it", async () => {
    const linked = keyOf(f.trip), free = keyOf(f.trip);
    cleanup.put(linked, ago(10)); cleanup.put(free, ago(10));
    await f.db.collection("postPhotos").insertOne({ tripId: f.trip, postId: new ObjectId(), uploaderId: f.actor, s3Key: linked, order: 1, uploadedAt: new Date() });
    await jobsCollection().insertOne({ tripId: f.trip, objectKeys: [linked, free], createdAt: ago(10), status: "pending", attempts: 0, resolvedKeys: [], rejectedKeys: [], nextAttemptAt: ago(10) });
    expect(await processStorageDeletionJobs(deps())).toMatchObject({ ok: true, value: { completed: 1, resolvedKeys: 1, rejectedKeys: 1 } });
    expect(cleanup.deleted).toEqual([free]);
    expect(cleanup.keys()).toEqual([linked]);
    expect(await onlyJob()).toMatchObject({ status: "completed", resolvedKeys: [free], rejectedKeys: [linked] });
  });

  it("processes a legacy job after the 0005 migration", async () => {
    const key = keyOf(f.trip);
    cleanup.put(key, ago(10));
    await jobsCollection().insertOne({ tripId: f.trip, objectKeys: [key], createdAt: ago(100) });
    expect(await processStorageDeletionJobs(deps())).toMatchObject({ ok: true, value: { processed: 0 } });
    await f.db.collection("_migrations").deleteOne({ id: STORAGE_DELETION_MIGRATION_ID });
    await migrateMongoSchema(f.db);
    expect(await onlyJob()).toMatchObject({ status: "pending", attempts: 0, resolvedKeys: [], rejectedKeys: [], nextAttemptAt: ago(100) });
    expect(await processStorageDeletionJobs(deps())).toMatchObject({ ok: true, value: { processed: 1, completed: 1 } });
    expect(cleanup.deleted).toEqual([key]);
  });

  // Deterministic ordering: the first call of `method` on `name` runs for real and then stays paused until `release()`.
  const pauseAfterFirst = (name: string, method: "insertOne" | "findOneAndUpdate") => {
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
  const concurrent = (name: string, fn: () => Promise<void>) => it(name, fn, 15_000);

  concurrent("lets only one of two concurrent workers claim and delete a job", async () => {
    const mine = await attach(3);
    await deleteTripRequest();
    const paused = pauseAfterFirst("storageDeletionJobs", "findOneAndUpdate");
    const first = launch(processStorageDeletionJobs(deps()));
    let second!: ReturnType<typeof processStorageDeletionJobs>;
    try {
      await paused.reached;
      second = launch(processStorageDeletionJobs(deps()));
      expect(await second).toMatchObject({ ok: true, value: { processed: 0, completed: 0 } });
      expect(cleanup.deleteCalls).toBe(0);
    } finally { paused.release(); }
    expect(await first).toMatchObject({ ok: true, value: { processed: 1, completed: 1, resolvedKeys: 3 } });
    expect(cleanup.deleted).toHaveLength(3);
    expect([...cleanup.deleted].sort()).toEqual([...mine].sort());
  });

  concurrent("a worker whose lease expired cannot overwrite the progress of the worker that reclaimed the job", async () => {
    const mine = await attach(2);
    await deleteTripRequest();
    let releaseA!: () => void, reachedA!: () => void, first = true;
    const gate = new Promise<void>((resolve) => { releaseA = resolve; });
    const started = new Promise<void>((resolve) => { reachedA = resolve; });
    pendingReleases.push(() => releaseA());
    cleanup.beforeDelete = async () => { if (first) { first = false; reachedA(); await gate; } };
    const workerA = launch(processStorageDeletionJobs(deps()));
    try {
      await Promise.race([started, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Worker A never started.")), 3_000))]);
      const later = new Date(WORKER_NOW.getTime() + (STORAGE_DELETION_LEASE_SECONDS + 1) * 1000);
      const workerB = await processStorageDeletionJobs(deps({}, later));
      expect(workerB).toMatchObject({ ok: true, value: { processed: 1, completed: 1, resolvedKeys: 2 } });
      // Worker A resumes after losing its lease and every one of its deletes fails: it must not release the job as failed.
      cleanup.failAllDeletes = true;
    } finally { releaseA(); }
    expect(await workerA).toMatchObject({ ok: true, value: { processed: 1, completed: 0, failed: 0 } });
    expect(await onlyJob()).toMatchObject({ status: "completed", attempts: 0 });
    expect(await onlyJob()).not.toHaveProperty("lastErrorCode");
    expect([...(await onlyJob()).resolvedKeys].sort()).toEqual([...mine].sort());
  });

  describe("abandoned upload sweep", () => {
    it("deletes old orphans of existing and removed Trips and keeps linked, recent and foreign objects (avatars are outside the trips/ prefix)", async () => {
      const linked = await attach(1);
      cleanup.put(linked[0]!, ago(OLD));
      const orphanExisting = keyOf(f.trip), orphanRemoved = keyOf(new ObjectId()), recent = keyOf(f.trip);
      cleanup.put(orphanExisting, ago(OLD)); cleanup.put(orphanRemoved, ago(OLD + 5000)); cleanup.put(recent, ago(ABANDONED_UPLOAD_MIN_AGE_SECONDS - 1));
      const avatar = `avatars/${f.actor}.jpg`, alien = `trips/${f.trip}/photo.jpg`;
      cleanup.put(avatar, ago(OLD * 10)); cleanup.put(alien, ago(OLD * 10));
      const result = await sweep();
      expect(result).toEqual({ ok: true, value: { pages: 1, scanned: 5, deleted: 2, keptRecent: 1, keptLinked: 1, ignored: 1, listFailed: false, deleteFailed: 0, linkCheckFailed: 0, truncated: false } });
      expect([...cleanup.deleted].sort()).toEqual([orphanExisting, orphanRemoved].sort());
      expect(cleanup.keys()).toEqual([linked[0]!, recent, avatar, alien].sort());
    });

    it("walks several pages of the bucket", async () => {
      const orphans = Array.from({ length: 5 }, () => keyOf(f.trip));
      for (const key of orphans) cleanup.put(key, ago(OLD));
      cleanup.pageSize = 2;
      expect(await sweep()).toMatchObject({ ok: true, value: { pages: 3, deleted: 5 } });
      expect(cleanup.listCalls.map((call) => call.continuationToken === undefined)).toEqual([true, false, false]);
      expect(cleanup.keys()).toEqual([]);
    });

    it("does not delete a recent object whose confirmation is in flight, and the confirmed photo stays readable", async () => {
      const key = keyOf(f.trip);
      fake.put(key, "image/jpeg");
      cleanup.put(key, ago(60));
      const paused = (() => {
        const collection = f.db.collection("postPhotos"), original = f.db.collection.bind(f.db);
        const real = collection.insertOne.bind(collection) as (...args: unknown[]) => Promise<unknown>;
        let reached!: () => void, release!: () => void, first = true;
        const reachedPromise = new Promise<void>((resolve) => { reached = resolve; });
        const gate = new Promise<void>((resolve) => { release = resolve; });
        pendingReleases.push(() => release());
        vi.spyOn(collection, "insertOne").mockImplementation((async (...args: unknown[]) => {
          const result = await real(...args);
          if (first) { first = false; reached(); await gate; }
          return result;
        }) as never);
        vi.spyOn(f.db, "collection").mockImplementation((name, options) => name === "postPhotos" ? collection : original(name, options));
        return { reached: Promise.race([reachedPromise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("The save never reached postPhotos.")), 3_000))]), release };
      })();
      const saving = launch(f.api.createPost!({ tripId: domainId(f.trip), authenticatedUserId: domainId(f.actor), description: "Recuerdo", photos: [{ key }] }));
      try {
        await paused.reached;
        expect(await sweep()).toMatchObject({ ok: true, value: { deleted: 0, keptRecent: 1 } });
        expect(cleanup.keys()).toEqual([key]);
      } finally { paused.release(); }
      expect((await saving).ok).toBe(true);
      expect(await f.db.collection("postPhotos").countDocuments({ s3Key: key })).toBe(1);
      expect(cleanup.keys()).toEqual([key]);
    });

    describe("rolled-back joint save (T87)", () => {
      const failingJointSave = async (photos: string[], postId = new ObjectId()) => {
        const collection = f.db.collection("activities"), original = f.db.collection.bind(f.db);
        const spy = vi.spyOn(collection, "insertOne").mockRejectedValueOnce(new Error("forced failure"));
        const spyCollection = vi.spyOn(f.db, "collection").mockImplementation((name, options) => name === "activities" ? collection : original(name, options));
        const result = await f.api.createPost!({ tripId: domainId(f.trip), authenticatedUserId: domainId(f.actor), postId: domainId(postId),
          description: "Recuerdo", newActivity: { title: "Cena", scheduledAt: f.occurrence }, photos: photos.map((key) => ({ key })) });
        spy.mockRestore(); spyCollection.mockRestore();
        return { result, postId };
      };
      const uploaded = (count: number) => {
        const keys = Array.from({ length: count }, () => keyOf(f.trip));
        for (const key of keys) { fake.put(key, "image/jpeg"); cleanup.put(key, ago(OLD)); }
        return keys;
      };

      it("leaves no post, activity, photo record or reference, and the old unreferenced keys are swept", async () => {
        const keys = uploaded(2);
        const { result } = await failingJointSave(keys);
        expect(result).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
        for (const name of ["posts", "activities", "activityParticipations", "postPhotos", "postExpenses"]) expect(await f.db.collection(name).countDocuments({})).toBe(0);
        expect(await sweep()).toMatchObject({ ok: true, value: { deleted: 2, keptLinked: 0 } });
        expect(cleanup.keys()).toEqual([]);
      });

      it("a retry of the failed save with the same id registers only its keys; the sweep then keeps them and removes the rest", async () => {
        const keys = uploaded(2);
        const { result, postId } = await failingJointSave(keys);
        expect(result.ok).toBe(false);
        const retry = await f.api.createPost!({ tripId: domainId(f.trip), authenticatedUserId: domainId(f.actor), postId: domainId(postId),
          description: "Recuerdo", newActivity: { title: "Cena", scheduledAt: f.occurrence }, photos: [{ key: keys[0]! }] });
        expect(retry.ok).toBe(true);
        expect(await sweep()).toMatchObject({ ok: true, value: { deleted: 1, keptLinked: 1 } });
        expect(cleanup.keys()).toEqual([keys[0]!]);
        // A second retry of the committed save references the same key and registers nothing new.
        const again = await f.api.createPost!({ tripId: domainId(f.trip), authenticatedUserId: domainId(f.actor), postId: domainId(postId),
          description: "Recuerdo", newActivity: { title: "Cena", scheduledAt: f.occurrence }, photos: [{ key: keys[0]! }] });
        expect(again).toEqual(retry);
        expect(await f.db.collection("postPhotos").countDocuments({})).toBe(1);
      });
    });

    it("a failing bucket listing or delete does not change any record", async () => {
      const orphan = keyOf(f.trip);
      cleanup.put(orphan, ago(OLD));
      cleanup.failList = true;
      expect(await sweep()).toMatchObject({ ok: true, value: { listFailed: true, deleted: 0 } });
      cleanup.failList = false; cleanup.failAllDeletes = true;
      expect(await sweep()).toMatchObject({ ok: true, value: { deleted: 0, deleteFailed: 1 } });
      expect(cleanup.keys()).toEqual([orphan]);
    });
  });
});
