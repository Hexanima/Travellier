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
  const set = (status: unknown, user = actor, target = activity) => {
    expect(api.setActivityParticipation).toBeTypeOf("function");
    return api.setActivityParticipation!({ ...context(user, target), status });
  };
  const get = (user = actor, target = activity) => {
    expect(api.getActivityParticipation).toBeTypeOf("function");
    return api.getActivityParticipation!(context(user, target));
  };
  const saved = async (status: string, user = actor, target = activity): Promise<ActivityParticipation> => {
    const result = await set(status, user, target);
    if (!result.ok) throw result.error;
    return result.value;
  };
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
    await db.collection("trips").insertOne({ _id: trip, inviteCode: trip.toHexString(), visibility: "public", votingEnabled: false });
    await db.collection("tripMembers").insertMany([
      { tripId: trip, userId: actor, role: "participant", joinedAt: new Date() },
      { tripId: trip, userId: other, role: "admin", joinedAt: new Date() },
    ]);
    await db.collection("activities").insertMany([activity, otherActivity].map((_id) => ({ _id, tripId: trip, dayId: new ObjectId(),
      title: "Paseo", scheduledAt: new Date(), status: "confirmed", createdBy: other, createdAt: new Date(), description: null, mapsUrl: null })));
    api = createTripApi(db);
  });

  it.each(["admin", "participant"])("persists BSON references and a single replaceable status for %s", async (role) => {
    await db.collection("tripMembers").updateOne({ tripId: trip, userId: actor }, { $set: { role } });
    const first = await saved("going");
    for (const status of ["not_going", "pending", "going", "going"]) {
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
    await saved("not_going", other); await saved("pending", actor, otherActivity);
    const foreign = { tripId: new ObjectId(), activityId: new ObjectId(), userId: actor, status: "going", updatedAt: new Date() };
    await db.collection("activityParticipations").insertOne(foreign);
    await db.collection("activityVotes").insertOne({ tripId: trip, activityId: activity, userId: actor, value: "up" });
    const preserved = await db.collection("activityParticipations").find().toArray();
    const activities = await db.collection("activities").find().toArray(), votes = await db.collection("activityVotes").find().toArray();
    for (const status of ["going", "not_going", "pending"]) await saved(status);
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
    const statuses = ["going", "not_going", "pending", "going"];
    const results = await Promise.all(statuses.map((status) => set(status)));
    expect(results.every((r) => r.ok)).toBe(true);
    const ids = results.flatMap((r) => r.ok ? [r.value.id] : []);
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
    const order: string[] = [];
    const registered = setTripActivityParticipation.execute({ participations: paused, createId: () => id(new ObjectId()), now: () => new Date() },
      { ...context(), status: "going" }).then((result) => { if (result.ok) order.push("participation"); return result; });
    await authorized.ready;
    const trips = db.collection("trips"), collection = db.collection.bind(db), update = trips.updateOne.bind(trips);
    vi.spyOn(db, "collection").mockImplementation((name, options) => name === "trips" ? trips : collection(name, options));
    vi.spyOn(trips, "updateOne").mockImplementation((...args) => { attempted.release(); return update(...args); });
    api = createTripApi(db);
    const expelled = api.expelMember!({ tripId: id(trip), actorUserId: id(other), targetUserId: id(actor) })
      .then((result) => { if (result.ok) order.push("expulsion"); return result; });
    try { await Promise.race([expelled, attempted.ready]); } finally { resume.release(); }
    const results = await Promise.all([registered, expelled]);
    expect(results.every((r) => r.ok)).toBe(true); expect(order).toEqual(["participation", "expulsion"]);
    expect(await set("pending")).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
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
});
