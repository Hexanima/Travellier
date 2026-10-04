import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createObjectId, type Activity, type ObjectId as DomainId } from "app-domain";
import { createTripApi } from "./trip-api.js";
import type { TripApi } from "../app.js";
import { migrateMongoSchema } from "../adapters/mongodb/migrations.js";

const id = (v: ObjectId): DomainId => {
  const result = createObjectId(v.toHexString());
  if (!result.ok) throw result.error;
  return result.value;
};
describe("activity persistence and transactions", () => {
  let server: MongoMemoryReplSet, client: MongoClient, db: Db, api: TripApi;
  let trip: ObjectId, actor: ObjectId, destination: ObjectId, day: ObjectId;
  const occurrence = new Date("2026-09-25T12:00:00.456Z");
  const context = () => ({ tripId: id(trip), authenticatedUserId: id(actor) });
  const input = () => ({ ...context(), dayId: id(day), title: "Paseo", scheduledAt: occurrence });
  const create = async (): Promise<Activity> => {
    expect(api.createActivity).toBeTypeOf("function");
    const result = await api.createActivity!(input());
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) throw result.error;
    return result.value;
  };
  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    client = new MongoClient(server.getUri()); await client.connect();
    db = client.db("activity_persistence"); await migrateMongoSchema(db);
  }, 120_000);
  afterAll(async () => { await client?.close(); await server?.stop(); });
  beforeEach(async () => {
    vi.restoreAllMocks();
    for (const name of ["trips", "tripMembers", "destinations", "itineraryDays", "activities", "activityVotes", "activityParticipations",
      "posts", "postExpenses", "postPhotos", "comments", "postLikes", "commentLikes", "transports"]) await db.collection(name).deleteMany({});
    trip = new ObjectId(); actor = new ObjectId(); destination = new ObjectId(); day = new ObjectId();
    await db.collection("trips").insertOne({ _id: trip, inviteCode: trip.toHexString(), votingEnabled: false, expenseMode: "register", visibility: "public" });
    await db.collection("tripMembers").insertOne({ tripId: trip, userId: actor, role: "participant", joinedAt: new Date() });
    await db.collection("destinations").insertOne({ _id: destination, tripId: trip, name: "Córdoba", order: 1, createdAt: new Date() });
    await db.collection("itineraryDays").insertOne({ _id: day, tripId: trip, destinationId: destination, type: "activity", order: 1,
      date: new Date("2026-09-25T00:00:00Z"), startsAt: new Date("2026-09-25T10:00:00.123Z"), endsAt: new Date("2026-09-25T18:00:00.789Z") });
    api = createTripApi(db);
  });

  it.each(["admin", "participant"])("persists BSON values and allows CRUD by %s, including another author's activity", async (role) => {
    await db.collection("tripMembers").updateOne({ tripId: trip }, { $set: { role } });
    const activity = await create();
    expect(activity).toMatchObject({ tripId: id(trip), createdBy: id(actor), scheduledAt: occurrence, status: "confirmed", description: null, mapsUrl: null });
    const stored = await db.collection("activities").findOne({ _id: new ObjectId(activity.id) });
    expect(stored).toMatchObject({ tripId: trip, dayId: day, createdBy: actor, scheduledAt: occurrence });
    expect(stored!.createdAt).toBeInstanceOf(Date);
    await db.collection("activities").updateOne({ _id: stored!._id }, { $set: { createdBy: new ObjectId(), status: "voting" } });
    const result = await api.updateActivity!({ ...context(), activityId: activity.id, title: "Museo", description: "Centro" });
    expect(result).toMatchObject({ ok: true, value: { title: "Museo", description: "Centro", status: "voting", createdAt: activity.createdAt } });
    expect(await api.getActivity!({ ...context(), activityId: activity.id })).toEqual(result);
    expect(await api.listActivities!(context())).toMatchObject({ ok: true, value: [{ title: "Museo" }] });
    expect(await api.deleteActivity!({ ...context(), activityId: activity.id })).toMatchObject({ ok: true });
    expect(await db.collection("activities").countDocuments({ tripId: trip })).toBe(0);
  });

  it("reads current voting configuration and preserves UTC milliseconds", async () => {
    await db.collection("trips").updateOne({ _id: trip }, { $set: { votingEnabled: true } });
    const activity = await create();
    expect(activity.status).toBe("proposed");
    expect(activity.scheduledAt.toISOString()).toBe("2026-09-25T12:00:00.456Z");
  });

  it("hides public Trip activities from external and expelled users on every operation", async () => {
    const activity = await create();
    const before = await db.collection("activities").find().toArray();
    await db.collection("tripMembers").deleteMany({ tripId: trip });
    for (const result of [await api.createActivity!(input()), await api.listActivities!(context()),
      await api.getActivity!({ ...context(), activityId: activity.id }),
      await api.updateActivity!({ ...context(), activityId: activity.id, title: "No" }),
      await api.deleteActivity!({ ...context(), activityId: activity.id })]) {
      expect(result).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    }
    expect(await db.collection("activities").find().toArray()).toEqual(before);
  });

  it("scopes activity IDs to the requested Trip and lists only its records", async () => {
    const activity = await create();
    const foreignTrip = new ObjectId(), foreignActivity = new ObjectId();
    const stored = await db.collection("activities").findOne({ _id: new ObjectId(activity.id) });
    await db.collection("activities").insertOne({ ...stored!, _id: foreignActivity, tripId: foreignTrip });
    for (const result of [await api.getActivity!({ ...context(), activityId: id(foreignActivity) }),
      await api.updateActivity!({ ...context(), activityId: id(foreignActivity), title: "No" }),
      await api.deleteActivity!({ ...context(), activityId: id(foreignActivity) })]) {
      expect(result).toMatchObject({ ok: false, error: { tag: "ActivityNotFoundError" } });
    }
    expect(await api.listActivities!(context())).toEqual({ ok: true, value: [activity] });
    expect(await db.collection("activities").countDocuments()).toBe(2);
  });

  it("deletes votes and participations, detaches posts and preserves all other content", async () => {
    const activity = await create(); const activityId = new ObjectId(activity.id), otherActivity = new ObjectId();
    const postId = new ObjectId(), parentPostId = new ObjectId(), transportId = new ObjectId();
    await db.collection("posts").insertOne({ _id: postId, tripId: trip, dayId: day, authorId: actor, activityId, parentPostId, transportId,
      description: "Recuerdo", mapsUrl: null, createdAt: occurrence });
    for (const name of ["activityVotes", "activityParticipations"]) {
      await db.collection(name).insertMany([{ activityId, tripId: trip, userId: actor }, { activityId: otherActivity, tripId: trip, userId: actor },
        { activityId, tripId: new ObjectId(), userId: new ObjectId() }]);
    }
    const preserved: Record<string, unknown[]> = {};
    for (const name of ["postExpenses", "postPhotos", "comments", "postLikes", "commentLikes"]) {
      await db.collection(name).insertOne({ postId, tripId: trip, value: "preserved" });
      preserved[name] = await db.collection(name).find().toArray();
    }
    expect(await api.deleteActivity!({ ...context(), activityId: activity.id })).toEqual({ ok: true, value: undefined });
    expect(await db.collection("posts").findOne({ _id: postId })).toMatchObject({ activityId: null, tripId: trip, dayId: day, parentPostId, transportId,
      description: "Recuerdo", createdAt: occurrence });
    for (const name of ["activityVotes", "activityParticipations"]) {
      expect(await db.collection(name).countDocuments({ tripId: trip, activityId })).toBe(0);
      expect(await db.collection(name).countDocuments()).toBe(2);
    }
    for (const [name, before] of Object.entries(preserved)) expect(await db.collection(name).find().toArray()).toEqual(before);
    expect(await api.deleteActivity!({ ...context(), activityId: activity.id })).toMatchObject({ ok: false, error: { tag: "ActivityNotFoundError" } });
  });

  it("rolls back detached posts and deleted votes when deleting participations fails", async () => {
    const activity = await create(), activityId = new ObjectId(activity.id);
    await db.collection("posts").insertOne({ tripId: trip, activityId });
    await db.collection("activityVotes").insertOne({ tripId: trip, activityId, userId: actor });
    const before = await Promise.all(["trips", "activities", "posts", "activityVotes"].map((name) => db.collection(name).find().toArray()));
    const collection = db.collection("activityParticipations");
    vi.spyOn(collection, "deleteMany").mockRejectedValueOnce(new Error("forced failure"));
    const original = db.collection.bind(db);
    vi.spyOn(db, "collection").mockImplementation((name, options) => name === "activityParticipations" ? collection : original(name, options));
    expect(await api.deleteActivity!({ ...context(), activityId: activity.id })).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
    expect(await Promise.all(["trips", "activities", "posts", "activityVotes"].map((name) => db.collection(name).find().toArray()))).toEqual(before);
  });

  it("rejects invalid edits without changing data or the Trip coordination revision", async () => {
    const activity = await create();
    const before = await Promise.all(["trips", "activities"].map((name) => db.collection(name).find().toArray()));
    expect(await api.updateActivity!({ ...context(), activityId: activity.id, scheduledAt: new Date("2026-09-25T09:00:00Z") }))
      .toMatchObject({ ok: false, error: { tag: "ValidationError" } });
    expect(await Promise.all(["trips", "activities"].map((name) => db.collection(name).find().toArray()))).toEqual(before);
  });

  it("GET operations preserve the Trip coordination revision", async () => {
    const activity = await create(); const before = await db.collection("trips").findOne({ _id: trip });
    await api.listActivities!(context()); await api.getActivity!({ ...context(), activityId: activity.id });
    expect(await db.collection("trips").findOne({ _id: trip })).toEqual(before);
  });

  it("serializes creation with Trip deletion without orphaning content", async () => {
    expect(api.createActivity).toBeTypeOf("function");
    await db.collection("tripMembers").updateOne({ tripId: trip }, { $set: { role: "admin" } });
    const [created, deleted] = await Promise.all([api.createActivity!(input()), api.delete!(context())]);
    expect(deleted.ok).toBe(true);
    expect(created.ok || (!created.ok && created.error.tag === "TripNotFoundError")).toBe(true);
    expect(await db.collection("activities").countDocuments({ tripId: trip })).toBe(0);
    expect(await db.collection("trips").countDocuments({ _id: trip })).toBe(0);
  });

  const configureTransports = async () => {
    const base = { ...context(), destinationId: id(destination), type: "car" as const, departurePlace: "Origen", arrivalPlace: "Destino",
      costPerPerson: null, details: {} };
    const outbound = await api.createTransport!({ ...base, direction: "outbound", departureAt: new Date("2026-09-25T08:00:00Z"),
      arrivalAt: new Date("2026-09-25T10:00:00.123Z") });
    const returning = await api.createTransport!({ ...base, direction: "return", departureAt: new Date("2026-09-25T18:00:00.789Z"),
      arrivalAt: new Date("2026-09-25T20:00:00Z") });
    expect(outbound.ok).toBe(true); expect(returning.ok).toBe(true);
    if (!outbound.ok) throw outbound.error;
    // Completing both transports creates the canonical activity slice.
    const canonical = await db.collection("itineraryDays").findOne({ tripId: trip, type: "activity" });
    expect(canonical).not.toBeNull();
    day = canonical!._id;
    return outbound.value;
  };

  it("protects activities created by T36 from incompatible transport edits until they are deleted", async () => {
    const outbound = await configureTransports();
    const activity = await create();
    const patch = { ...context(), destinationId: id(destination), transportId: outbound.id, arrivalAt: new Date("2026-09-25T13:00:00Z") };
    expect(await api.updateTransport!(patch)).toMatchObject({ ok: false, error: { tag: "ItineraryConflictError" } });
    expect(await api.getActivity!({ ...context(), activityId: activity.id })).toEqual({ ok: true, value: activity });
    expect(await api.deleteActivity!({ ...context(), activityId: activity.id })).toMatchObject({ ok: true });
    expect(await api.updateTransport!(patch)).toMatchObject({ ok: true });
  });

  it("serializes simultaneous activity creation and an incompatible transport change", async () => {
    const outbound = await configureTransports();
    const [created, changed] = await Promise.all([api.createActivity!(input()), api.updateTransport!({ ...context(), destinationId: id(destination),
      transportId: outbound.id, arrivalAt: new Date("2026-09-25T13:00:00Z") })]);
    expect(created.ok && changed.ok).toBe(false);
    expect(created.ok || changed.ok).toBe(true);
    if (!created.ok) expect(created.error.tag).toBe("ValidationError");
    if (!changed.ok) expect(changed.error.tag).toBe("ItineraryConflictError");
    const stored = await db.collection("activities").find({ tripId: trip }).toArray();
    const persistedDay = await db.collection("itineraryDays").findOne({ _id: day });
    for (const activity of stored) {
      expect(activity.dayId).toEqual(day);
      expect(activity.scheduledAt.getTime()).toBeGreaterThanOrEqual(persistedDay!.startsAt.getTime());
      expect(activity.scheduledAt.getTime()).toBeLessThanOrEqual(persistedDay!.endsAt.getTime());
    }
  });
});
