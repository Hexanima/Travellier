import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createObjectId, setTripActivityParticipation, type ActivityParticipation, type TripParticipationPort } from "app-domain";
import { createTripApi } from "./trip-api.js";
import type { TripApi } from "../app.js";
import { migrateMongoSchema } from "../adapters/mongodb/migrations.js";

const id = (value: ObjectId) => {
  const result = createObjectId(value.toHexString());
  if (!result.ok) throw result.error;
  return result.value;
};
const gate = () => {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  return { ready, release };
};

describe("individual participation persistence", () => {
  let server: MongoMemoryReplSet, client: MongoClient, db: Db, api: TripApi;
  let trip: ObjectId, actor: ObjectId, other: ObjectId, activity: ObjectId, otherActivity: ObjectId;
  const context = (user = actor, target = activity) => ({ tripId: id(trip), activityId: id(target), authenticatedUserId: id(user) });
  const set = (status: unknown, user = actor, target = activity, extra: Record<string, unknown> = {}) => {
    expect(api.setActivityParticipation).toBeTypeOf("function");
    return api.setActivityParticipation!({ ...context(user, target), status, ...extra });
  };
  const get = (user = actor, target = activity) => {
    expect(api.getActivityParticipation).toBeTypeOf("function");
    return api.getActivityParticipation!(context(user, target));
  };
  const saved = async (status: string, user = actor, target = activity): Promise<ActivityParticipation> => {
    const result = await set(status, user, target);
    if (!result.ok) throw result.error;
    if (result.value.outcome !== "saved") throw new Error("expected a saved participation");
    return result.value.participation;
  };
  const insertPending = async (user: ObjectId, target: ObjectId, decisionRequired: unknown = null) => {
    await db.collection("activityParticipations").insertOne({ tripId: trip, activityId: target, userId: user, status: "pending",
      updatedAt: new Date(), ...(decisionRequired === null ? {} : { decisionRequired }) });
  };
  const confirmationOf = (value: { conflicts: { activityId: string; scheduledAt: Date; durationMinutes: number | null }[];
    activity: { scheduledAt: Date; durationMinutes: number | null } }) => ({
    confirmedConflicts: value.conflicts.map((c) => ({ activityId: c.activityId, scheduledAt: c.scheduledAt.getTime(), durationMinutes: c.durationMinutes })),
    confirmedActivity: { scheduledAt: value.activity.scheduledAt.getTime(), durationMinutes: value.activity.durationMinutes } });
  const dataOf = () => Promise.all(["activities", "activityParticipations"].map((name) => db.collection(name).find().toArray()));
  const statusOf = async (user: ObjectId, target: ObjectId) =>
    (await db.collection("activityParticipations").findOne({ userId: user, activityId: target }))?.status;
  const snapshot = () => Promise.all(["trips", "activities", "activityParticipations", "activityVotes"].map((name) => db.collection(name).find().toArray()));

  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    client = new MongoClient(server.getUri()); await client.connect();
    db = client.db("participation_persistence"); await migrateMongoSchema(db);
  }, 120_000);
  afterAll(async () => { await client?.close(); await server?.stop(); });
  beforeEach(async () => {
    vi.restoreAllMocks();
    for (const name of ["trips", "tripMembers", "activities", "activityParticipations", "activityVotes", "posts"]) {
      await db.collection(name).deleteMany({});
    }
    trip = new ObjectId(); actor = new ObjectId(); other = new ObjectId(); activity = new ObjectId(); otherActivity = new ObjectId();
    await db.collection("trips").insertOne({ _id: trip, inviteCode: trip.toHexString(), visibility: "public", votingEnabled: false, ownerId: other });
    await db.collection("tripMembers").insertMany([
      { tripId: trip, userId: actor, role: "participant", joinedAt: new Date() },
      { tripId: trip, userId: other, role: "admin", joinedAt: new Date() },
    ]);
    await db.collection("activities").insertMany([activity, otherActivity].map((_id) => ({ _id, tripId: trip, dayId: new ObjectId(),
      title: "Paseo", scheduledAt: new Date(_id === activity ? "2026-11-10T10:00:00.000Z" : "2026-11-12T10:00:00.000Z"), status: "confirmed", createdBy: other, createdAt: new Date(), description: null, mapsUrl: null })));
    api = createTripApi(db);
  });

  it.each(["admin", "participant"])("persists BSON references and a single replaceable status for %s", async (role) => {
    await db.collection("tripMembers").updateOne({ tripId: trip, userId: actor }, { $set: { role } });
    const first = await saved("going");
    for (const status of ["not_going", "going", "going"]) {
      const record = await saved(status);
      expect(record).toMatchObject({ id: first.id, tripId: id(trip), activityId: id(activity), userId: id(actor), status });
      expect(record.updatedAt.getTime()).toBeGreaterThanOrEqual(first.updatedAt.getTime());
      expect(await get()).toEqual({ ok: true, value: record });
      expect(await db.collection("activityParticipations").countDocuments({ activityId: activity, userId: actor })).toBe(1);
    }
    const stored = await db.collection("activityParticipations").findOne({ activityId: activity, userId: actor });
    expect(stored).toMatchObject({ _id: new ObjectId(first.id), tripId: trip, activityId: activity, userId: actor, status: "going" });
    expect(stored!.updatedAt).toBeInstanceOf(Date);
  });
  it("keeps other users, activities, Trips and voting data unchanged", async () => {
    await saved("not_going", other); await insertPending(actor, otherActivity);
    const foreign = { tripId: new ObjectId(), activityId: new ObjectId(), userId: actor, status: "going", updatedAt: new Date() };
    await db.collection("activityParticipations").insertOne(foreign);
    await db.collection("activityVotes").insertOne({ tripId: trip, activityId: activity, userId: actor, value: "up" });
    const preserved = await db.collection("activityParticipations").find().toArray();
    const activities = await db.collection("activities").find().toArray(), votes = await db.collection("activityVotes").find().toArray();
    for (const status of ["going", "not_going"]) await saved(status);
    expect(await db.collection("activityParticipations").find({ _id: { $in: preserved.map((p) => p._id) } }).toArray()).toEqual(preserved);
    expect(await db.collection("activities").find().toArray()).toEqual(activities);
    expect(await db.collection("activityVotes").find().toArray()).toEqual(votes);
    expect(await db.collection("activityParticipations").countDocuments()).toBe(4);
  });
  it("reads absence without creating a record or changing Trip coordination", async () => {
    const before = await snapshot();
    expect(await get()).toEqual({ ok: true, value: null });
    expect(await snapshot()).toEqual(before);
  });
  it("denies external and revoked users, even on public Trips", async () => {
    await saved("going");
    const before = await snapshot();
    for (const user of [new ObjectId(), actor]) {
      if (user === actor) await db.collection("tripMembers").deleteOne({ tripId: trip, userId: actor });
      expect(await set("not_going", user)).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
      expect(await get(user)).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    }
    expect(await snapshot()).toEqual(before);
  });
  it("rejects missing and foreign activities without writing", async () => {
    const foreign = new ObjectId();
    await db.collection("activities").insertOne({ _id: foreign, tripId: new ObjectId() });
    const before = await snapshot();
    for (const target of [new ObjectId(), foreign]) {
      expect(await set("going", actor, target)).toMatchObject({ ok: false, error: { tag: "ActivityNotFoundError" } });
      expect(await get(actor, target)).toMatchObject({ ok: false, error: { tag: "ActivityNotFoundError" } });
    }
    expect(await snapshot()).toEqual(before);
  });
  it("rolls back an invalid update including the coordination revision", async () => {
    await saved("going");
    const before = await snapshot();
    expect(await set("confirmed")).toMatchObject({ ok: false, error: { tag: "ValidationError" } });
    expect(await snapshot()).toEqual(before);
  });
  it("rolls back a database failure after the upsert", async () => {
    await saved("going");
    const before = await snapshot(), records = db.collection("activityParticipations"), originalCollection = db.collection.bind(db);
    const update = records.findOneAndUpdate.bind(records);
    vi.spyOn(db, "collection").mockImplementation((name, options) => name === "activityParticipations" ? records : originalCollection(name, options));
    vi.spyOn(records, "findOneAndUpdate").mockImplementation(async (...args) => {
      await update(...args); throw new Error("forced failure after write");
    });
    api = createTripApi(db);
    expect(await set("not_going")).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
    expect(await snapshot()).toEqual(before);
  });
  it("preserves the unique activity/user index and rejects direct duplicate insertion", async () => {
    await saved("going");
    const indexes = await db.collection("activityParticipations").listIndexes().toArray();
    expect(indexes).toContainEqual(expect.objectContaining({ key: { activityId: 1, userId: 1 }, unique: true }));
    await expect(db.collection("activityParticipations").insertOne({ tripId: trip, activityId: activity, userId: actor, status: "pending" }))
      .rejects.toMatchObject({ code: 11000 });
  });
  it("serializes simultaneous initial upserts without duplicate records or failed valid requests", async () => {
    const statuses = ["going", "not_going", "going"];
    const results = await Promise.all(statuses.map((status) => set(status)));
    expect(results.every((r) => r.ok)).toBe(true);
    const ids = results.flatMap((r) => r.ok && r.value.outcome === "saved" ? [r.value.participation.id] : []);
    expect(new Set(ids).size).toBe(1);
    const stored = await db.collection("activityParticipations").find({ activityId: activity, userId: actor }).toArray();
    expect(stored).toHaveLength(1); expect(statuses).toContain(stored[0]!.status);
  });
  it("persists simultaneous responses from distinct members independently", async () => {
    const results = await Promise.all([set("going"), set("not_going", other)]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await get()).toMatchObject({ ok: true, value: { status: "going" } });
    expect(await get(other)).toMatchObject({ ok: true, value: { status: "not_going" } });
    expect(await db.collection("activityParticipations").countDocuments()).toBe(2);
  });
  it.each(["proposed", "voting", "confirmed"])("keeps activity status %s independent of attendance", async (status) => {
    await db.collection("activities").updateOne({ _id: activity }, { $set: { status } });
    const before = await db.collection("activities").findOne({ _id: activity });
    await saved("not_going");
    expect(await db.collection("activities").findOne({ _id: activity })).toEqual(before);
  });
  it("serializes participation creation with activity deletion without orphaned responses", async () => {
    const [registered, deleted] = await Promise.all([set("going"), api.deleteActivity!(context())]);
    expect(deleted.ok).toBe(true);
    if (!registered.ok) expect(registered.error.tag).toBe("ActivityNotFoundError");
    expect(await db.collection("activityParticipations").countDocuments({ activityId: activity })).toBe(0);
    expect(await db.collection("activities").countDocuments({ _id: activity })).toBe(0);
  });
  it("serializes participation creation with Trip deletion without orphaned responses", async () => {
    const [registered, deleted] = await Promise.all([set("going"), api.delete!({ tripId: id(trip), authenticatedUserId: id(other) })]);
    expect(deleted.ok).toBe(true);
    if (!registered.ok) expect(registered.error.tag).toBe("TripNotFoundError");
    expect(await db.collection("activityParticipations").countDocuments({ tripId: trip })).toBe(0);
    expect(await db.collection("trips").countDocuments({ _id: trip })).toBe(0);
  });
  it("finishes an authorized participation before an expulsion waiting on the same Trip", async () => {
    expect(api.setActivityParticipation).toBeTypeOf("function");
    const { createMongoTripParticipationRepository } = await import("../adapters/mongodb/trip-participation-repository.js");
    const repository = createMongoTripParticipationRepository(db), authorized = gate(), resume = gate(), attempted = gate();
    const paused: TripParticipationPort = { ...repository, withTransaction: (tripId, work) => repository.withTransaction(tripId, (scope) => work({
      ...scope, findMemberRole: async (userId) => { const result = await scope.findMemberRole(userId); authorized.release(); await resume.ready; return result; },
    })) };
    // Harness: delay the teardown of the participation session so the losing interleaving is deterministic.
    const start = db.client.startSession.bind(db.client);
    let participationSession: ReturnType<typeof start> | undefined;
    let pending = true;
    vi.spyOn(db.client, "startSession").mockImplementation((...args: Parameters<typeof start>) => {
      const session = start(...args);
      if (pending) {
        pending = false;
        participationSession = session;
        const end = session.endSession.bind(session);
        session.endSession = (async () => { await new Promise((resolve) => setTimeout(resolve, 50)); await end(); }) as typeof session.endSession;
      }
      return session;
    });
    const lockedAfterParticipation: boolean[] = [];
    const registered = setTripActivityParticipation.execute({ participations: paused, createId: () => id(new ObjectId()), now: () => new Date() },
      { ...context(), status: "going" });
    await authorized.ready;
    const trips = db.collection("trips"), collection = db.collection.bind(db), update = trips.updateOne.bind(trips);
    vi.spyOn(db, "collection").mockImplementation((name, options) => name === "trips" ? trips : collection(name, options));
    vi.spyOn(trips, "updateOne").mockImplementation(async (...args) => {
      attempted.release();
      const result = await update(...args);
      // Only the expulsion lock matters; read outside its session to see what is already committed.
      if (args[2]?.session !== participationSession)
        lockedAfterParticipation.push(await db.collection("activityParticipations")
          .countDocuments({ activityId: activity, userId: actor }) === 1);
      return result;
    });
    api = createTripApi(db);
    const expelled = api.expelMember!({ tripId: id(trip), actorUserId: id(other), targetUserId: id(actor) });
    try { await Promise.race([expelled, attempted.ready]); } finally { resume.release(); }
    const results = await Promise.all([registered, expelled]);
    expect(results.every((r) => r.ok)).toBe(true);
    // The settling order of the promises is not the invariant: after committing, the participation still tears
    // down its session, so the expulsion may resolve first. The invariant is that the expulsion only acquired
    // the Trip lock once the response was already durable.
    expect(lockedAfterParticipation.length).toBeGreaterThan(0);
    expect(lockedAfterParticipation[0]).toBe(true);
    expect(await set("going")).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
  }, 20_000);
  it("rejects participation when concurrent expulsion acquires coordination first", async () => {
    expect(api.setActivityParticipation).toBeTypeOf("function");
    const deleting = gate(), resumeDeletion = gate(), attempted = gate();
    const before = await snapshot(), members = db.collection("tripMembers"), trips = db.collection("trips"), collection = db.collection.bind(db);
    const remove = members.deleteOne.bind(members), update = trips.updateOne.bind(trips);
    vi.spyOn(db, "collection").mockImplementation((name, options) => name === "tripMembers" ? members : name === "trips" ? trips : collection(name, options));
    vi.spyOn(members, "deleteOne").mockImplementation(async (...args) => { deleting.release(); await resumeDeletion.ready; return remove(...args); });
    api = createTripApi(db);
    const expelled = api.expelMember!({ tripId: id(trip), actorUserId: id(other), targetUserId: id(actor) });
    await deleting.ready;
    vi.spyOn(trips, "updateOne").mockImplementation((...args) => { attempted.release(); return update(...args); });
    const registered = set("going");
    try { await attempted.ready; } finally { resumeDeletion.release(); }
    expect(await expelled).toEqual({ ok: true, value: undefined });
    expect(await registered).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    // Expulsion changes membership and its revision, but cannot create attendance.
    const after = await snapshot();
    expect(after.slice(1)).toEqual(before.slice(1));
  }, 20_000);
  describe("conflicts and decisionRequired", () => {
    const mark = { reason: "schedule_conflict", changedFields: ["scheduledAt"], changedAt: new Date("2026-11-08T10:00:00.000Z") };
    const overlap = async () => {
      await db.collection("activities").updateOne({ _id: otherActivity }, { $set: { scheduledAt: new Date("2026-11-10T10:30:00.000Z"), durationMinutes: 60 } });
      await db.collection("activities").updateOne({ _id: activity }, { $set: { durationMinutes: 60 } });
    };
    const ask = async (target = activity) => {
      const result = await set("going", actor, target);
      if (!result.ok || result.value.outcome !== "confirmation_required") throw new Error("expected confirmation_required");
      return result.value;
    };
    it.each(["going", "not_going"])("clears decisionRequired to null atomically when %s is saved", async (status) => {
      await insertPending(actor, activity, mark);
      expect(await get()).toMatchObject({ ok: true, value: { status: "pending", decisionRequired: mark } });
      expect(await saved(status)).toMatchObject({ status, decisionRequired: null });
      expect(await db.collection("activityParticipations").findOne({ activityId: activity, userId: actor }))
        .toMatchObject({ status, decisionRequired: null });
    });
    it("keeps pending, its mark and the whole snapshot when pending is rejected", async () => {
      await insertPending(actor, activity, mark);
      const before = await snapshot();
      expect(await set("pending")).toMatchObject({ ok: false, error: { tag: "ValidationError" } });
      expect(await snapshot()).toEqual(before);
      expect(await get()).toMatchObject({ ok: true, value: { status: "pending", decisionRequired: mark } });
    });
    it("reads absent decisionRequired as a participation without a mark", async () => {
      await insertPending(actor, activity);
      expect(await get()).toMatchObject({ ok: true, value: { status: "pending" } });
    });
    it("asks for confirmation without writes, then saves not_going on the incompatibles and going on the chosen one", async () => {
      await overlap(); await saved("going", actor, otherActivity); await saved("going", other, otherActivity);
      const before = await dataOf();
      const value = await ask();
      expect(value.conflicts).toMatchObject([{ activityId: id(otherActivity), reason: "overlap", durationMinutes: 60 }]);
      expect(await dataOf()).toEqual(before);
      const otherBefore = await db.collection("activityParticipations").find({ userId: other }).toArray();
      expect(await set("going", actor, activity, confirmationOf(value))).toMatchObject({ ok: true, value: { outcome: "saved" } });
      expect(await statusOf(actor, otherActivity)).toBe("not_going"); expect(await statusOf(actor, activity)).toBe("going");
      expect(await db.collection("activityParticipations").find({ userId: other }).toArray()).toEqual(otherBefore);
    });
    it("asks again without writes when the snapshot changed before confirming", async () => {
      await overlap(); await saved("going", actor, otherActivity);
      const value = await ask();
      await db.collection("activities").updateOne({ _id: otherActivity }, { $set: { durationMinutes: 30 } });
      const before = await dataOf();
      expect(await set("going", actor, activity, confirmationOf(value))).toMatchObject({ ok: true, value: { outcome: "confirmation_required" } });
      expect(await dataOf()).toEqual(before);
    });
    it("rolls back the whole confirmation and keeps the mark if the second write fails", async () => {
      await overlap(); await saved("going", actor, otherActivity); await insertPending(actor, activity, mark);
      const value = await ask();
      const before = await snapshot(), records = db.collection("activityParticipations"), originalCollection = db.collection.bind(db);
      const update = records.findOneAndUpdate.bind(records);
      let calls = 0;
      vi.spyOn(db, "collection").mockImplementation((name, options) => name === "activityParticipations" ? records : originalCollection(name, options));
      vi.spyOn(records, "findOneAndUpdate").mockImplementation(async (...args) => {
        if (++calls === 2) throw new Error("forced failure in second write");
        return update(...args);
      });
      api = createTripApi(db);
      expect(await set("going", actor, activity, confirmationOf(value))).toMatchObject({ ok: false });
      expect(await snapshot()).toEqual(before);
      expect(await db.collection("activityParticipations").findOne({ activityId: activity, userId: actor })).toMatchObject({ status: "pending", decisionRequired: mark });
    });
    it("lets only one of two simultaneous incompatible going responses win", async () => {
      await overlap();
      const results = await Promise.all([set("going", actor, activity), set("going", actor, otherActivity)]);
      const outcomes = results.map((r) => r.ok ? r.value.outcome : "error").sort();
      expect(outcomes).toEqual(["confirmation_required", "saved"]);
      expect(await db.collection("activityParticipations").countDocuments({ userId: actor, status: "going" })).toBe(1);
    });
    it("never modifies other participants or their incompatible activities", async () => {
      await overlap();
      await db.collection("activityParticipations").insertMany([activity, otherActivity].map((target) => ({ tripId: trip, activityId: target,
        userId: other, status: "going", updatedAt: new Date() })));
      const before = await db.collection("activityParticipations").find({ userId: other }).toArray();
      expect(await set("going", actor, activity)).toMatchObject({ ok: true, value: { outcome: "saved" } });
      expect(await set("not_going", actor, otherActivity)).toMatchObject({ ok: true });
      expect(await db.collection("activityParticipations").find({ userId: other }).toArray()).toEqual(before);
    });
  });
});
