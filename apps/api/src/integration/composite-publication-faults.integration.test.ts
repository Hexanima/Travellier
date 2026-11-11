import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { ABANDONED_UPLOAD_MIN_AGE_SECONDS, sweepAbandonedPhotoUploads } from "app-domain";

import { createMongoPhotoLinkRepository } from "../adapters/mongodb/photo-link-repository.js";
import { startE2EHarness, type E2EHarness, type HttpResult } from "../../test/e2e-harness.js";

/**
 * T103: the joint publication (activity, agenda, photos and expense with payments and shares) over real HTTP with injected failures
 * (the same `vi.spyOn(collection)` technique as the persistence suites), its retries by client post id and the legacy `paidBy` fixture.
 * In-memory MongoDB and fake object storage only: see test/e2e-harness.ts.
 */
const MONGO_WRITES = ["trips", "posts", "activities", "activityParticipations", "postPhotos", "postExpenses", "outboxEvents"];

describe("composite publication with injected failures over HTTP (T103)", () => {
  let h: E2EHarness;
  let A: string, B: string, tokA: string, tokB: string;
  beforeAll(async () => {
    h = await startE2EHarness("composite");
    [A, B] = [new ObjectId().toHexString(), new ObjectId().toHexString()];
    await h.db.collection("users").insertMany([A, B].map((id, index) => ({ _id: new ObjectId(id), email: `user${index}@example.com`, passwordHash: "not-a-real-hash", name: null })));
    [tokA, tokB] = [await h.tokenFor(A), await h.tokenFor(B)];
  }, 120_000);
  afterEach(() => { vi.restoreAllMocks(); });
  afterAll(async () => { await h?.close(); });

  let tripId = "";
  const path = (suffix = "") => `/trips/${tripId}${suffix}`;
  const expectStatus = (response: HttpResult, status: number) => { expect(response.status, response.text).toBe(status); return response; };
  /** A fresh Trip per test (A owner, B participant) with a transport window on 2099-03-01..06 so activities have a destination window. */
  const newTrip = async () => {
    const created = expectStatus(await h.http(tokA, "POST", "/trips", { name: "Compuesta", primaryDestination: "Mendoza" }), 201).json.trip;
    tripId = created.id;
    expectStatus(await h.http(tokB, "POST", "/trips/join", { code: created.inviteCode }), 200);
    const base = { type: "car", departurePlace: "Origen", arrivalPlace: "Mendoza", costPerPerson: null, details: {} };
    const transports = path(`/destinations/${created.primaryDestination.id}/transports`);
    expectStatus(await h.http(tokA, "POST", transports, { ...base, direction: "outbound", departureAt: "2099-03-01T08:00:00.000Z", arrivalAt: "2099-03-01T10:00:00.000Z" }), 201);
    expectStatus(await h.http(tokA, "POST", transports, { ...base, direction: "return", departureAt: "2099-03-06T18:00:00.000Z", arrivalAt: "2099-03-06T20:00:00.000Z" }), 201);
  };
  const state = (names: string[] = MONGO_WRITES) => h.snapshot(names);
  const withoutTripLock = async () => state(MONGO_WRITES.filter((name) => name !== "trips"));
  const photoKey = async (token = tokA, user = A) => {
    const reserved = expectStatus(await h.http(token, "POST", path("/photo-uploads"), { files: [{ contentType: "image/jpeg", sizeBytes: 1000 }] }), 201);
    const { key } = reserved.json.uploads[0] as { key: string };
    expect(key).toContain(`/photos/${user}/`);
    h.storage.put(key);
    return key;
  };
  const expense = () => ({ totalAmount: 1000, currency: "ARS",
    payments: [{ userId: A, unit: "amount", value: 700 }, { userId: B, unit: "amount", value: 300 }],
    shares: [{ userId: A, unit: "percent", value: 50 }, { userId: B, unit: "remainder", value: null }] });
  const composite = async (extra: Record<string, unknown> = {}, scheduledAt = "2099-03-03T12:00:00.000Z") => ({
    id: new ObjectId().toHexString(), description: "Cena", newActivity: { title: "Cena", scheduledAt, durationMinutes: 60 },
    photos: [{ key: await photoKey() }, { key: await photoKey() }], expense: expense(), ...extra });
  const publish = (body: unknown, token = tokA) => h.http(token, "POST", path("/posts"), body);
  const counts = async () => Object.fromEntries(await Promise.all(["posts", "activities", "activityParticipations", "postPhotos", "postExpenses"]
    .map(async (name) => [name, await h.db.collection(name).countDocuments({ tripId: new ObjectId(tripId) })])));
  const storageState = () => ({ objects: [...h.storage.objects.keys()].sort(), uploads: h.storage.uploads.length });
  /** Makes the next `method` on `name` fail (after recording the call order), leaving every other write real. */
  type Hook = { name: string; method: "insertOne" | "updateOne" | "findOneAndUpdate"; failOnce?: boolean };
  const intercept = (hooks: Hook[]) => {
    const original = h.db.collection.bind(h.db), order: string[] = [], instances = new Map<string, ReturnType<typeof original>>();
    for (const { name, method, failOnce } of hooks) {
      const collection = instances.get(name) ?? original(name);
      instances.set(name, collection);
      const real = (collection[method] as (...args: unknown[]) => Promise<unknown>).bind(collection);
      let armed = failOnce === true;
      vi.spyOn(collection, method).mockImplementation((async (...args: unknown[]) => {
        order.push(`${name}.${method}`);
        if (armed) { armed = false; throw new Error("injected failure"); }
        return real(...args);
      }) as never);
    }
    vi.spyOn(h.db, "collection").mockImplementation(((key: string, options?: never) => instances.get(key) ?? original(key, options)) as never);
    return order;
  };
  const failOn = (name: string, method: Hook["method"]) => intercept([{ name, method, failOnce: true }]);
  const dayOf = async (date: string) => {
    const itinerary = expectStatus(await h.http(tokA, "GET", path("/itinerary")), 200).json.itinerary;
    return itinerary.days.find((day: { type: string; date: string }) => day.type === "activity" && day.date.startsWith(date)).id as string;
  };

  it("rolls everything back when the expense insert fails, then a retry by the same id saves once and a second retry replays the same 201", async () => {
    await newTrip();
    const body = await composite();
    const before = await state();
    const storageBefore = storageState();
    failOn("postExpenses", "insertOne");
    const failed = await publish(body);
    expect(failed.status, failed.text).toBe(500);
    vi.restoreAllMocks();
    expect(await state()).toEqual(before);
    expect(await counts()).toEqual({ posts: 0, activities: 0, activityParticipations: 0, postPhotos: 0, postExpenses: 0 });
    expect(storageState()).toEqual(storageBefore);
    const retry = expectStatus(await publish(body), 201);
    expect(retry.json).toMatchObject({ post: { id: body.id, authorId: A }, activity: { title: "Cena", createdBy: A }, participation: { userId: A, status: "going" },
      photos: [{ order: 1 }, { order: 2 }], expense: { totalAmount: 1000, currency: "ARS", completeness: { status: "complete" } } });
    expect(await counts()).toEqual({ posts: 1, activities: 1, activityParticipations: 1, postPhotos: 2, postExpenses: 1 });
    const committed = await state();
    const replay = expectStatus(await publish(body), 201);
    expect(replay.json).toEqual(retry.json);
    // A replay answers from what is stored; only the Trip lock counter (bumped by every Trip transaction) may move.
    expect(await withoutTripLock()).toEqual(Object.fromEntries(Object.entries(committed).filter(([name]) => name !== "trips")));
  }, 30_000);

  it("rolls everything back when the author's participation (the last write, after the expense) fails, and the retry leaves no duplicates", async () => {
    await newTrip();
    const body = await composite();
    const before = await state();
    const order = intercept([{ name: "postExpenses", method: "insertOne" }, { name: "activityParticipations", method: "findOneAndUpdate", failOnce: true }]);
    const failed = await publish(body);
    expect(failed.status, failed.text).toBe(500);
    // The expense was already written inside the transaction when the participation failed: the rollback must have removed it.
    expect(order).toEqual(["postExpenses.insertOne", "activityParticipations.findOneAndUpdate"]);
    vi.restoreAllMocks();
    expect(await state()).toEqual(before);
    expectStatus(await publish(body), 201);
    expect(await counts()).toEqual({ posts: 1, activities: 1, activityParticipations: 1, postPhotos: 2, postExpenses: 1 });
    expect(await h.db.collection("postPhotos").distinct("s3Key", { tripId: new ObjectId(tripId) })).toHaveLength(2);
  }, 30_000);

  it("answers 409 on an agenda conflict without writing, and the confirmation saves once (a replay writes nothing)", async () => {
    await newTrip();
    expectStatus(await h.http(tokA, "POST", path("/activities"), { dayId: await dayOf("2099-03-03"), title: "Previa", scheduledAt: "2099-03-03T11:30:00.000Z", durationMinutes: 60 }), 201);
    const previous = (await h.db.collection("activities").findOne({ title: "Previa", tripId: new ObjectId(tripId) }))!._id.toHexString();
    const body = await composite();
    const before = await withoutTripLock();
    const refused = await publish(body);
    expect(refused.status, refused.text).toBe(409);
    expect(refused.json.error).toMatchObject({ code: "ParticipationConflictError", conflicts: [{ activityId: previous }] });
    expect(await withoutTripLock()).toEqual(before);
    const { conflicts, activity } = refused.json.error as { conflicts: Array<{ activityId: string; scheduledAt: string; durationMinutes: number }>; activity: unknown };
    const confirmedBody = { ...body, confirmedConflicts: conflicts.map(({ activityId, scheduledAt, durationMinutes }) => ({ activityId, scheduledAt, durationMinutes })), confirmedActivity: activity };
    const saved = expectStatus(await publish(confirmedBody), 201);
    expect(await counts()).toEqual({ posts: 1, activities: 2, activityParticipations: 2, postPhotos: 2, postExpenses: 1 });
    expect(await h.db.collection("activityParticipations").findOne({ activityId: new ObjectId(previous), userId: new ObjectId(A) })).toMatchObject({ status: "not_going" });
    const committed = await withoutTripLock();
    expect(expectStatus(await publish(confirmedBody), 201).json).toEqual(saved.json);
    expect(await withoutTripLock()).toEqual(committed);
  }, 30_000);

  it("two simultaneous publications with the same client id leave exactly one of everything and never answer 500", async () => {
    await newTrip();
    const body = await composite();
    const responses = await Promise.all([publish(body), publish(body)]);
    // Observed T87 contract: the loser of the race is serialized by the Trip lock and answers the stored result, so both get 201 (no 409).
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    expect(responses[1]!.json).toEqual(responses[0]!.json);
    expect(await counts()).toEqual({ posts: 1, activities: 1, activityParticipations: 1, postPhotos: 2, postExpenses: 1 });
  }, 30_000);

  it("two simultaneous leaves of the same participant answer one 204 and one 404, and the membership is removed once", async () => {
    await newTrip();
    const responses = await Promise.all([h.http(tokB, "POST", path("/leave")), h.http(tokB, "POST", path("/leave"))]);
    expect(responses.map((r) => r.status).sort()).toEqual([204, 404]);
    expect(await h.db.collection("tripMembers").countDocuments({ tripId: new ObjectId(tripId), userId: new ObjectId(B) })).toBe(0);
    expect(await h.db.collection("tripMembers").countDocuments({ tripId: new ObjectId(tripId) })).toBe(1);
  }, 30_000);

  describe("legacy paidBy fixture", () => {
    const seedLegacy = async () => {
      await newTrip();
      const post = expectStatus(await publish({ description: "Con gasto viejo" }), 201).json.post as { id: string };
      const paidBy = new ObjectId();
      const legacy = { _id: new ObjectId(), tripId: new ObjectId(tripId), postId: new ObjectId(post.id), totalAmount: 100, paidBy, createdAt: new Date("2026-01-01T00:00:00.000Z") };
      await h.db.collection("postExpenses").insertOne(legacy);
      return { post, paidBy, legacy };
    };
    const stored = () => h.db.collection("postExpenses").findOne({ tripId: new ObjectId(tripId) });

    it("reads the legacy payer as a 100 percent payment without writing anything", async () => {
      const { post, paidBy, legacy } = await seedLegacy();
      const before = await state();
      const read = expectStatus(await h.http(tokB, "GET", path(`/posts/${post.id}`)), 200).json;
      expect(read.expense).toMatchObject({ payments: [{ userId: paidBy.toHexString(), unit: "percent", value: 100 }], shares: [], formerMemberIds: [paidBy.toHexString()],
        completeness: { status: "incomplete", reasons: expect.arrayContaining(["missing_shares"]) } });
      expect(await state()).toEqual(before);
      expect(await stored()).toEqual(legacy);
    });

    it("keeps the exact legacy document when the update fails, then applies the retry once without bringing paidBy back", async () => {
      const { post, paidBy, legacy } = await seedLegacy();
      const edit = { expense: { currency: "ARS", payments: [] } };
      failOn("postExpenses", "updateOne");
      const failed = await h.http(tokA, "PATCH", path(`/posts/${post.id}`), edit);
      expect(failed.status, failed.text).toBe(500);
      vi.restoreAllMocks();
      expect(await stored()).toEqual(legacy);
      const retried = expectStatus(await h.http(tokA, "PATCH", path(`/posts/${post.id}`), edit), 200);
      expect(retried.json.expense).toMatchObject({ currency: "ARS", payments: [], formerMemberIds: [] });
      const afterRetry = await stored();
      expect(afterRetry).toMatchObject({ currency: "ARS", payments: [], totalAmount: 100, createdAt: legacy.createdAt });
      expect(afterRetry?.paidBy).toEqual(paidBy);
      // Applying the same edit again changes nothing, and the explicit empty list is not adapted again from paidBy.
      expectStatus(await h.http(tokA, "PATCH", path(`/posts/${post.id}`), edit), 200);
      expect(await stored()).toEqual(afterRetry);
      expect(await h.db.collection("postExpenses").countDocuments({ tripId: new ObjectId(tripId) })).toBe(1);
      expect(expectStatus(await h.http(tokB, "GET", path(`/posts/${post.id}`)), 200).json.expense).toMatchObject({ payments: [] });
    });
  });

  it("answers 500 without writing when the storage cannot inspect an object, and the sweep only removes the unreferenced key after its threshold", async () => {
    await newTrip();
    const body = await composite();
    const failingKey = (body.photos as Array<{ key: string }>)[1]!.key;
    h.storage.failHeadFor.add(failingKey);
    const before = await state();
    const failed = await publish(body);
    expect(failed.status, failed.text).toBe(500);
    expect(await state()).toEqual(before);
    h.storage.failHeadFor.clear();
    const keys = (body.photos as Array<{ key: string }>).map((photo) => photo.key);
    const swept = (ageSeconds: number) => {
      const now = new Date("2026-11-10T12:00:00.000Z");
      for (const key of keys) h.cleanupStorage.put(key, new Date(now.getTime() - ageSeconds * 1000));
      return sweepAbandonedPhotoUploads({ links: createMongoPhotoLinkRepository(h.db), storage: h.cleanupStorage, now: () => now,
        deadline: new Date(now.getTime() + 45_000), maxPages: 20 });
    };
    // Younger than the threshold: an upload may still be waiting for its confirmation, so nothing is deleted.
    expect(await swept(ABANDONED_UPLOAD_MIN_AGE_SECONDS - 60)).toMatchObject({ ok: true, value: { deleted: 0, keptRecent: 2 } });
    expect(h.cleanupStorage.deleted).toEqual([]);
    // Older than the threshold and linked to no photo: removed.
    expect(await swept(ABANDONED_UPLOAD_MIN_AGE_SECONDS + 60)).toMatchObject({ ok: true, value: { deleted: 2 } });
    expect([...h.cleanupStorage.deleted].sort()).toEqual([...keys].sort());
    // The same publication still succeeds afterwards with the retried keys if they exist again (new uploads, new keys).
    const again = await composite({ id: body.id });
    expectStatus(await publish(again), 201);
    expect(await counts()).toEqual({ posts: 1, activities: 1, activityParticipations: 1, postPhotos: 2, postExpenses: 1 });
  }, 30_000);
});
