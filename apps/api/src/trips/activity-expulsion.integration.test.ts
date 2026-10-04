import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createObjectId, type TripActivityPort } from "app-domain";
import { createTripApi } from "./trip-api.js";
import { handleApiRequest, type TripApi } from "../app.js";
import { migrateMongoSchema } from "../adapters/mongodb/migrations.js";
import { createMongoTripActivityRepository } from "../adapters/mongodb/trip-activity-repository.js";
import { createTripActivity, updateTripActivity, deleteTripActivity } from "app-domain";

const id = (value: ObjectId) => {
  const parsed = createObjectId(value.toHexString());
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};
const gate = () => {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  return { ready, release };
};

describe("activity mutations concurrent with participant expulsion", () => {
  let server: MongoMemoryReplSet, client: MongoClient, db: Db, api: TripApi;
  let trip: ObjectId, participant: ObjectId, admin: ObjectId, day: ObjectId, activity: ObjectId;
  const context = () => ({ tripId: id(trip), authenticatedUserId: id(participant) });
  const fields = () => ({ dayId: id(day), title: "Paseo", scheduledAt: new Date("2026-09-25T12:00:00.456Z") });
  const expel = () => api.expelMember!({ tripId: id(trip), actorUserId: id(admin), targetUserId: id(participant) });
  const mutate = (method: "POST" | "PATCH" | "DELETE", activities: TripActivityPort) => {
    const dependencies = { activities, createId: () => id(new ObjectId()), now: () => new Date() };
    if (method === "POST") return createTripActivity.execute(dependencies, { ...context(), ...fields() });
    if (method === "PATCH") return updateTripActivity.execute(dependencies, { ...context(), activityId: id(activity), title: "Museo" });
    return deleteTripActivity.execute(dependencies, { ...context(), activityId: id(activity) });
  };
  const snapshot = () => Promise.all(["activities", "posts", "activityVotes", "activityParticipations"].map((name) => db.collection(name).find().toArray()));
  const interceptTripWrites = () => {
    const trips = db.collection("trips"), original = db.collection.bind(db);
    vi.spyOn(db, "collection").mockImplementation((name, options) => name === "trips" ? trips : original(name, options));
    api = createTripApi(db);
    return trips;
  };

  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    client = new MongoClient(server.getUri()); await client.connect();
    db = client.db("activity_expulsion"); await migrateMongoSchema(db);
  }, 120_000);
  afterAll(async () => { await client?.close(); await server?.stop(); });
  beforeEach(async () => {
    vi.restoreAllMocks();
    for (const name of ["trips", "tripMembers", "itineraryDays", "activities", "posts", "activityVotes", "activityParticipations"]) {
      await db.collection(name).deleteMany({});
    }
    trip = new ObjectId(); participant = new ObjectId(); admin = new ObjectId(); day = new ObjectId(); activity = new ObjectId();
    await db.collection("trips").insertOne({ _id: trip, inviteCode: trip.toHexString(), votingEnabled: false, expenseMode: "register", destinationOrderRevision: 0 });
    await db.collection("tripMembers").insertMany([
      { tripId: trip, userId: participant, role: "participant", joinedAt: new Date() },
      { tripId: trip, userId: admin, role: "admin", joinedAt: new Date() },
    ]);
    await db.collection("itineraryDays").insertOne({ _id: day, tripId: trip, destinationId: new ObjectId(), type: "activity", order: 1,
      date: new Date("2026-09-25T00:00:00Z"), startsAt: new Date("2026-09-25T10:00:00Z"), endsAt: new Date("2026-09-25T18:00:00Z") });
    await db.collection("activities").insertOne({ _id: activity, tripId: trip, dayId: day, title: "Paseo", scheduledAt: fields().scheduledAt,
      description: null, mapsUrl: null, status: "confirmed", createdBy: participant, createdAt: new Date() });
    await db.collection("posts").insertOne({ tripId: trip, activityId: activity });
    await db.collection("activityVotes").insertOne({ tripId: trip, activityId: activity, userId: participant });
    await db.collection("activityParticipations").insertOne({ tripId: trip, activityId: activity, userId: participant });
    api = createTripApi(db);
  });

  it.each(["POST", "PATCH", "DELETE"] as const)("commits %s before an expulsion that starts after its authorization", async (method) => {
    const authorized = gate(), resumeActivity = gate(), expulsionWriteAttempted = gate();
    const repository = createMongoTripActivityRepository(db);
    const paused: TripActivityPort = { ...repository, withTransaction: (tripId, work) => repository.withTransaction(tripId, (scope) => work({
      ...scope, findMemberRole: async (userId) => {
        const membership = await scope.findMemberRole(userId);
        authorized.release(); await resumeActivity.ready;
        return membership;
      },
    })) };
    const order: string[] = [];
    const mutation = mutate(method, paused).then((result) => { if (result.ok) order.push("activity"); return result; });
    await authorized.ready;
    const trips = interceptTripWrites(), update = trips.updateOne.bind(trips);
    vi.spyOn(trips, "updateOne").mockImplementation((filter, changes, options) => {
      expulsionWriteAttempted.release();
      return update(filter, changes, options);
    });
    const expelled = expel().then((result) => { if (result.ok) order.push("expulsion"); return result; });
    try {
      // Old code completes expulsion while the activity still owns its snapshot.
      // Coordinated code attempts the Trip write and waits for that activity.
      await Promise.race([expelled, expulsionWriteAttempted.ready]);
    } finally { resumeActivity.release(); }
    const [changed, removed] = await Promise.all([mutation, expelled]);
    expect(changed.ok).toBe(true); expect(removed.ok).toBe(true);
    expect(order).toEqual(["activity", "expulsion"]);
    expect(await db.collection("tripMembers").countDocuments({ tripId: trip, userId: participant })).toBe(0);
    const url = `/trips/${trip}/activities${method === "POST" ? "" : `/${activity}`}`;
    expect((await handleApiRequest({ method, url, authenticatedUserId: id(participant), body: JSON.stringify({ ...fields(), title: "No" }) },
      { trips: api })).statusCode).toBe(404);
  }, 20_000);

  it.each(["POST", "PATCH", "DELETE"] as const)("rejects %s when expulsion acquires coordination first", async (method) => {
    const deletionStarted = gate(), resumeDeletion = gate(), activityWriteSettled = gate(), resumeActivity = gate();
    const before = await snapshot();
    const members = db.collection("tripMembers"), originalCollection = db.collection.bind(db), remove = members.deleteOne.bind(members);
    vi.spyOn(db, "collection").mockImplementation((name, options) => name === "tripMembers" ? members : originalCollection(name, options));
    vi.spyOn(members, "deleteOne").mockImplementation(async (filter, options) => {
      deletionStarted.release(); await resumeDeletion.ready;
      return remove(filter, options);
    });
    api = createTripApi(db);
    const expelled = expel();
    await deletionStarted.ready;
    const trips = db.collection("trips"), update = trips.updateOne.bind(trips), collection = db.collection.bind(db);
    vi.spyOn(db, "collection").mockImplementation((name, options) => name === "trips" ? trips : collection(name, options));
    vi.spyOn(trips, "updateOne").mockImplementation(async (filter, changes, options) => {
      try {
        const result = await update(filter, changes, options);
        // Without coordination, the activity acquires a stale snapshot here.
        activityWriteSettled.release(); await resumeActivity.ready;
        return result;
      } catch (error) {
        // A write conflict proves expulsion owns the Trip until it commits.
        activityWriteSettled.release(); throw error;
      }
    });
    const mutation = mutate(method, createMongoTripActivityRepository(db));
    try {
      await activityWriteSettled.ready;
      resumeDeletion.release();
      expect(await expelled).toEqual({ ok: true, value: undefined });
    } finally { resumeDeletion.release(); resumeActivity.release(); }
    expect(await mutation).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    expect(await snapshot()).toEqual(before);
  }, 20_000);
});
