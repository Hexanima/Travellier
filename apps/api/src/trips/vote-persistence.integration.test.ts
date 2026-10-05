import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createObjectId, setTripActivityVote, type TripVotePort } from "app-domain";
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

describe("individual vote persistence", () => {
  let server: MongoMemoryReplSet, client: MongoClient, db: Db, api: TripApi;
  let trip: ObjectId, actor: ObjectId, other: ObjectId, activity: ObjectId, otherActivity: ObjectId;
  const context = (user = actor, target = activity) => ({ tripId: id(trip), activityId: id(target), authenticatedUserId: id(user) });
  const set = (value: unknown, user = actor, target = activity) => {
    expect(api.setActivityVote).toBeTypeOf("function");
    return api.setActivityVote!({ ...context(user, target), value });
  };
  const get = (user = actor, target = activity) => {
    expect(api.getActivityVote).toBeTypeOf("function");
    return api.getActivityVote!(context(user, target));
  };
  const saved = async (value: string, user = actor, target = activity) => {
    const result = await set(value, user, target);
    if (!result.ok) throw result.error;
    return result.value;
  };
  const snapshot = () => Promise.all(["trips", "activities", "activityParticipations", "activityVotes"].map((name) => db.collection(name).find().toArray()));

  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    client = new MongoClient(server.getUri()); await client.connect();
    db = client.db("vote_persistence"); await migrateMongoSchema(db);
  }, 120_000);
  afterAll(async () => { await client?.close(); await server?.stop(); });
  beforeEach(async () => {
    vi.restoreAllMocks();
    for (const name of ["trips", "tripMembers", "destinations", "activities", "activityParticipations", "activityVotes", "posts"]) {
      await db.collection(name).deleteMany({});
    }
    trip = new ObjectId(); actor = new ObjectId(); other = new ObjectId(); activity = new ObjectId(); otherActivity = new ObjectId();
    await db.collection("trips").insertOne({ _id: trip, inviteCode: trip.toHexString(), name: "Viaje", description: null,
      visibility: "public", votingEnabled: true, expenseMode: "register", createdBy: other, createdAt: new Date() });
    await db.collection("destinations").insertOne({ tripId: trip, order: 1, name: "Córdoba", createdAt: new Date() });
    await db.collection("tripMembers").insertMany([
      { tripId: trip, userId: actor, role: "participant", joinedAt: new Date() },
      { tripId: trip, userId: other, role: "admin", joinedAt: new Date() },
    ]);
    await db.collection("activities").insertMany([activity, otherActivity].map((_id) => ({ _id, tripId: trip, dayId: new ObjectId(),
      title: "Paseo", scheduledAt: new Date(), status: "proposed", createdBy: other, createdAt: new Date(), description: null, mapsUrl: null })));
    api = createTripApi(db);
  });

  it.each(["admin", "participant"])("persists BSON references and a single replaceable vote for %s", async (role) => {
    await db.collection("tripMembers").updateOne({ tripId: trip, userId: actor }, { $set: { role } });
    const first = await saved("up");
    for (const value of ["down", "up", "up"]) {
      const record = await saved(value);
      expect(record).toEqual({ vote: { ...first.vote, value }, activityStatus: "voting" });
      expect(await get()).toEqual({ ok: true, value: record });
      expect(await db.collection("activityVotes").countDocuments({ activityId: activity, userId: actor })).toBe(1);
    }
    const stored = await db.collection("activityVotes").findOne({ activityId: activity, userId: actor });
    expect(stored).toMatchObject({ _id: new ObjectId(first.vote.id), tripId: trip, activityId: activity, userId: actor, value: "up", createdAt: first.vote.createdAt });
    expect(stored!.createdAt).toBeInstanceOf(Date);
  });
  it.each(["up", "down"])("starts voting atomically after the first %s and preserves all other activity fields", async (value) => {
    const before = await db.collection("activities").findOne({ _id: activity });
    expect(await saved(value)).toMatchObject({ activityStatus: "voting" });
    expect(await db.collection("activities").findOne({ _id: activity })).toEqual({ ...before, status: "voting" });
  });
  it("keeps other users, activities, Trips, posts and participation data unchanged", async () => {
    await saved("down", other); await saved("up", actor, otherActivity);
    const foreign = { tripId: new ObjectId(), activityId: new ObjectId(), userId: actor, value: "up", createdAt: new Date() };
    await db.collection("activityVotes").insertOne(foreign);
    await db.collection("activityParticipations").insertOne({ tripId: trip, activityId: activity, userId: actor, status: "going", updatedAt: new Date() });
    await db.collection("posts").insertOne({ tripId: trip, activityId: activity, description: "Paseo" });
    const preserved = await db.collection("activityVotes").find().toArray();
    const activities = await db.collection("activities").find().toArray();
    const participations = await db.collection("activityParticipations").find().toArray(), posts = await db.collection("posts").find().toArray();
    await saved("up"); await saved("down");
    expect(await db.collection("activityVotes").find({ _id: { $in: preserved.map((p) => p._id) } }).toArray()).toEqual(preserved);
    expect(await db.collection("activities").find().toArray()).toEqual(activities);
    expect(await db.collection("activityParticipations").find().toArray()).toEqual(participations);
    expect(await db.collection("posts").find().toArray()).toEqual(posts);
    expect(await db.collection("activityVotes").countDocuments()).toBe(4);
  });
  it("reads absence without creating a record, changing status or changing Trip coordination", async () => {
    const before = await snapshot();
    expect(await get()).toEqual({ ok: true, value: { vote: null, activityStatus: "proposed" } });
    expect(await snapshot()).toEqual(before);
  });
  it("rejects registration and replacement when disabled while preserving readable history", async () => {
    const first = await saved("up");
    await db.collection("trips").updateOne({ _id: trip }, { $set: { votingEnabled: false } });
    const before = await snapshot();
    expect(await set("down")).toMatchObject({ ok: false, error: { tag: "ActivityVotingDisabledError" } });
    expect(await set("up", actor, otherActivity)).toMatchObject({ ok: false, error: { tag: "ActivityVotingDisabledError" } });
    expect(await get()).toEqual({ ok: true, value: first });
    expect(await snapshot()).toEqual(before);
  });
  it("rejects confirmed activities without reopening them or changing an existing vote", async () => {
    const first = await saved("up");
    await db.collection("activities").updateOne({ _id: activity }, { $set: { status: "confirmed" } });
    const before = await snapshot();
    expect(await set("down")).toMatchObject({ ok: false, error: { tag: "ActivityVotingClosedError" } });
    expect(await get()).toEqual({ ok: true, value: { ...first, activityStatus: "confirmed" } });
    expect(await snapshot()).toEqual(before);
  });
  it("denies external and revoked users, even on public Trips", async () => {
    await saved("up");
    const before = await snapshot();
    for (const user of [new ObjectId(), actor]) {
      if (user === actor) await db.collection("tripMembers").deleteOne({ tripId: trip, userId: actor });
      expect(await set("down", user)).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
      expect(await get(user)).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    }
    expect(await snapshot()).toEqual(before);
  });
  it("rejects missing and foreign activities without writing", async () => {
    const foreign = new ObjectId();
    await db.collection("activities").insertOne({ _id: foreign, tripId: new ObjectId() });
    const before = await snapshot();
    for (const target of [new ObjectId(), foreign]) {
      expect(await set("up", actor, target)).toMatchObject({ ok: false, error: { tag: "ActivityNotFoundError" } });
      expect(await get(actor, target)).toMatchObject({ ok: false, error: { tag: "ActivityNotFoundError" } });
    }
    expect(await snapshot()).toEqual(before);
  });
  it("rolls back invalid values including the coordination revision", async () => {
    const before = await snapshot();
    expect(await set("going")).toMatchObject({ ok: false, error: { tag: "ValidationError" } });
    expect(await snapshot()).toEqual(before);
  });
  it("rolls back a database failure after the upsert", async () => {
    await saved("up");
    const before = await snapshot(), records = db.collection("activityVotes"), originalCollection = db.collection.bind(db);
    const update = records.findOneAndUpdate.bind(records);
    vi.spyOn(db, "collection").mockImplementation((name, options) => name === "activityVotes" ? records : originalCollection(name, options));
    vi.spyOn(records, "findOneAndUpdate").mockImplementation(async (...args) => {
      await update(...args); throw new Error("forced failure after write");
    });
    api = createTripApi(db);
    expect(await set("down")).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
    expect(await snapshot()).toEqual(before);
  });
  it("rolls back the vote and coordination revision when changing activity status fails after its write", async () => {
    const before = await snapshot(), activities = db.collection("activities"), originalCollection = db.collection.bind(db);
    const update = activities.updateOne.bind(activities);
    vi.spyOn(db, "collection").mockImplementation((name, options) => name === "activities" ? activities : originalCollection(name, options));
    vi.spyOn(activities, "updateOne").mockImplementation(async (...args) => {
      await update(...args); throw new Error("forced failure after status write");
    });
    api = createTripApi(db);
    expect(await set("up")).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
    expect(await snapshot()).toEqual(before);
  });
  it("preserves the unique activity/user index and rejects direct duplicate insertion", async () => {
    await saved("up");
    expect(await db.collection("activityVotes").listIndexes().toArray())
      .toContainEqual(expect.objectContaining({ key: { activityId: 1, userId: 1 }, unique: true }));
    await expect(db.collection("activityVotes").insertOne({ tripId: trip, activityId: activity, userId: actor, value: "down" }))
      .rejects.toMatchObject({ code: 11000 });
  });
  it("serializes simultaneous initial upserts without duplicate records or failed valid requests", async () => {
    const values = ["up", "down", "down", "up"];
    const results = await Promise.all(values.map((value) => set(value)));
    expect(results.every((r) => r.ok)).toBe(true);
    const identities = results.flatMap((r) => r.ok ? [r.value.vote.id] : []);
    expect(new Set(identities).size).toBe(1);
    const dates = results.flatMap((r) => r.ok ? [r.value.vote.createdAt.getTime()] : []);
    expect(new Set(dates).size).toBe(1);
    const stored = await db.collection("activityVotes").find({ activityId: activity, userId: actor }).toArray();
    expect(stored).toHaveLength(1); expect(values).toContain(stored[0]!.value);
    expect(await db.collection("activities").findOne({ _id: activity })).toMatchObject({ status: "voting" });
  });
  it("persists simultaneous votes from distinct members independently without confirming by unanimity", async () => {
    const results = await Promise.all([set("up"), set("up", other)]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await get()).toMatchObject({ ok: true, value: { vote: { value: "up" }, activityStatus: "voting" } });
    expect(await get(other)).toMatchObject({ ok: true, value: { vote: { value: "up" }, activityStatus: "voting" } });
    expect(await db.collection("activityVotes").countDocuments()).toBe(2);
  });
  it("serializes vote creation with activity deletion without orphaned votes", async () => {
    const [registered, deleted] = await Promise.all([set("up"), api.deleteActivity!(context())]);
    expect(deleted.ok).toBe(true);
    if (!registered.ok) expect(registered.error.tag).toBe("ActivityNotFoundError");
    expect(await db.collection("activityVotes").countDocuments({ activityId: activity })).toBe(0);
    expect(await db.collection("activities").countDocuments({ _id: activity })).toBe(0);
  });
  it("serializes vote creation with Trip deletion without orphaned votes", async () => {
    const [registered, deleted] = await Promise.all([set("up"), api.delete!({ tripId: id(trip), authenticatedUserId: id(other) })]);
    expect(deleted.ok).toBe(true);
    if (!registered.ok) expect(registered.error.tag).toBe("TripNotFoundError");
    expect(await db.collection("activityVotes").countDocuments({ tripId: trip })).toBe(0);
    expect(await db.collection("trips").countDocuments({ _id: trip })).toBe(0);
  });
  it("finishes an authorized vote before an expulsion waiting on the same Trip", async () => {
    expect(api.setActivityVote).toBeTypeOf("function");
    const { createMongoTripVoteRepository } = await import("../adapters/mongodb/trip-vote-repository.js");
    const repository = createMongoTripVoteRepository(db), authorized = gate(), resume = gate(), attempted = gate();
    const paused: TripVotePort = { ...repository, withTransaction: (tripId, work) => repository.withTransaction(tripId, (scope) => work({
      ...scope, findMemberRole: async (userId) => { const result = await scope.findMemberRole(userId); authorized.release(); await resume.ready; return result; },
    })) };
    const order: string[] = [];
    const registered = setTripActivityVote.execute({ votes: paused, createId: () => id(new ObjectId()), now: () => new Date() },
      { ...context(), value: "up" }).then((result) => { if (result.ok) order.push("vote"); return result; });
    await authorized.ready;
    const trips = db.collection("trips"), collection = db.collection.bind(db), update = trips.updateOne.bind(trips);
    vi.spyOn(db, "collection").mockImplementation((name, options) => name === "trips" ? trips : collection(name, options));
    vi.spyOn(trips, "updateOne").mockImplementation((...args) => { attempted.release(); return update(...args); });
    api = createTripApi(db);
    const expelled = api.expelMember!({ tripId: id(trip), actorUserId: id(other), targetUserId: id(actor) })
      .then((result) => { if (result.ok) order.push("expulsion"); return result; });
    try { await Promise.race([expelled, attempted.ready]); } finally { resume.release(); }
    const results = await Promise.all([registered, expelled]);
    expect(results.every((r) => r.ok)).toBe(true); expect(order).toEqual(["vote", "expulsion"]);
    expect(await set("down")).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
  }, 20_000);
  it("rejects a vote when concurrent expulsion acquires coordination first", async () => {
    expect(api.setActivityVote).toBeTypeOf("function");
    const deleting = gate(), resumeDeletion = gate(), attempted = gate();
    const before = await snapshot(), members = db.collection("tripMembers"), trips = db.collection("trips"), collection = db.collection.bind(db);
    const remove = members.deleteOne.bind(members), update = trips.updateOne.bind(trips);
    vi.spyOn(db, "collection").mockImplementation((name, options) => name === "tripMembers" ? members : name === "trips" ? trips : collection(name, options));
    vi.spyOn(members, "deleteOne").mockImplementation(async (...args) => { deleting.release(); await resumeDeletion.ready; return remove(...args); });
    api = createTripApi(db);
    const expelled = api.expelMember!({ tripId: id(trip), actorUserId: id(other), targetUserId: id(actor) });
    await deleting.ready;
    vi.spyOn(trips, "updateOne").mockImplementation((...args) => { attempted.release(); return update(...args); });
    const registered = set("up");
    try { await attempted.ready; } finally { resumeDeletion.release(); }
    expect(await expelled).toEqual({ ok: true, value: undefined });
    expect(await registered).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    expect((await snapshot()).slice(1)).toEqual(before.slice(1));
  }, 20_000);
  it("rejects a vote if configuration is disabled before vote coordination is acquired", async () => {
    expect(api.setActivityVote).toBeTypeOf("function");
    const attempted = gate(), resume = gate(), trips = db.collection("trips"), collection = db.collection.bind(db);
    const update = trips.updateOne.bind(trips);
    vi.spyOn(db, "collection").mockImplementation((name, options) => name === "trips" ? trips : collection(name, options));
    vi.spyOn(trips, "updateOne").mockImplementation(async (...args) => {
      attempted.release(); await resume.ready; return update(...args);
    });
    api = createTripApi(db);
    const registered = set("up");
    await attempted.ready;
    try {
      expect(await api.updateConfiguration!({ tripId: id(trip), authenticatedUserId: id(other), votingEnabled: false }))
        .toMatchObject({ ok: true, value: { votingEnabled: false } });
    } finally { resume.release(); }
    expect(await registered).toMatchObject({ ok: false, error: { tag: "ActivityVotingDisabledError" } });
    expect(await db.collection("activityVotes").countDocuments()).toBe(0);
    expect(await db.collection("activities").findOne({ _id: activity })).toMatchObject({ status: "proposed" });
    expect(await db.collection("trips").findOne({ _id: trip })).not.toHaveProperty("destinationOrderRevision");
  }, 20_000);
});
