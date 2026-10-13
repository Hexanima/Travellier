import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { PostFixture } from "../../test/post-fixture.js";
import { migrateMongoSchema } from "../adapters/mongodb/migrations.js";

describe("T47 active contracts and historical data", () => {
  const f = new PostFixture();
  beforeAll(() => f.start("voting_retirement"), 120_000);
  afterAll(() => f.stop());
  beforeEach(async () => {
    await f.reset();
    await f.db.collection("trips").updateOne({ _id: f.trip }, { $set: {
      name: "Córdoba", description: null, createdBy: f.actor, createdAt: f.occurrence, votingEnabled: true,
    } });
  });
  const tripPath = () => `/trips/${f.trip}`;
  const activitiesPath = () => `${tripPath()}/activities`;
  const create = async (user = f.actor) => {
    const response = await f.request("POST", activitiesPath(), {
      dayId: f.day.toHexString(), title: "Paseo", scheduledAt: f.occurrence.toISOString(), status: "voting", votingEnabled: true,
    }, user);
    expect(response.statusCode, response.body).toBe(201);
    return JSON.parse(response.body).activity;
  };
  const seedLegacy = async (status = "voting") => {
    const activityId = new ObjectId();
    await f.db.collection("activities").insertOne({ _id: activityId, tripId: f.trip, dayId: f.day,
      title: "Legado", description: null, mapsUrl: null, scheduledAt: f.occurrence, status,
      createdBy: f.actor, createdAt: f.occurrence });
    await f.db.collection("activityVotes").insertOne({ tripId: f.trip, activityId, userId: f.actor, value: "up", createdAt: f.occurrence });
    return activityId;
  };
  const snapshot = () => Promise.all(["trips", "activities", "activityVotes", "activityParticipations"]
    .map((name) => f.db.collection(name).find().sort({ _id: 1 }).toArray()));

  it("creates Trips without persisting or returning a voting configuration", async () => {
    const response = await f.request("POST", "/trips", { name: "Nuevo", primaryDestination: "Mendoza", votingEnabled: true });
    expect(response.statusCode).toBe(201);
    const trip = JSON.parse(response.body).trip;
    expect(trip).not.toHaveProperty("votingEnabled");
    expect(await f.db.collection("trips").findOne({ _id: new ObjectId(trip.id) })).not.toHaveProperty("votingEnabled");
  });
  it("reads legacy Trips without exposing or rewriting their voting configuration", async () => {
    const before = await snapshot();
    const detail = JSON.parse((await f.request("GET", tripPath())).body).trip;
    expect(detail).not.toHaveProperty("votingEnabled");
    const listed = JSON.parse((await f.request("GET", "/trips")).body).trips;
    expect(listed).toHaveLength(1);
    expect(listed[0]).not.toHaveProperty("votingEnabled");
    expect(await snapshot()).toEqual(before);
  });
  it("updates supported configuration without changing the stored legacy flag or votes", async () => {
    await seedLegacy();
    const votes = await f.db.collection("activityVotes").find().toArray();
    const response = await f.request("PATCH", `${tripPath()}/config`, { visibility: "private", expenseMode: "balance", votingEnabled: false });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).trip).not.toHaveProperty("votingEnabled");
    expect(await f.db.collection("trips").findOne({ _id: f.trip })).toMatchObject({ votingEnabled: true, visibility: "private", expenseMode: "balance" });
    expect(await f.db.collection("activityVotes").find().toArray()).toEqual(votes);
  });
  it.each(["proposed", "voting", "confirmed"])("reads and edits a legacy %s activity without exposing or overwriting its status", async (status) => {
    const activityId = await seedLegacy(status);
    const path = `${activitiesPath()}/${activityId}`;
    const before = await snapshot();
    for (const [url, key] of [[path, "activity"], [activitiesPath(), "activities"], [`${tripPath()}/itinerary`, "itinerary"]]) {
      const response = await f.request("GET", url);
      expect(response.statusCode).toBe(200);
      const value = JSON.parse(response.body)[key];
      const activity = key === "itinerary" ? value.activities[0] : key === "activities" ? value[0] : value;
      expect(activity.id).toBe(activityId.toHexString());
      expect(activity).not.toHaveProperty("status");
      if (key === "itinerary") expect(value).not.toHaveProperty("votingEnabled");
    }
    expect(await snapshot()).toEqual(before);
    const votes = await f.db.collection("activityVotes").find().toArray();
    const edited = await f.request("PATCH", path, { title: "Editado", status: "confirmed" });
    expect(edited.statusCode).toBe(200);
    expect(JSON.parse(edited.body).activity).not.toHaveProperty("status");
    expect(await f.db.collection("activities").findOne({ _id: activityId })).toMatchObject({ title: "Editado", status, createdAt: f.occurrence });
    expect(await f.db.collection("activityVotes").find().toArray()).toEqual(votes);
  });
  it("creates planned and joint spontaneous activities without approval fields or new votes", async () => {
    await seedLegacy();
    const votes = await f.db.collection("activityVotes").find().toArray();
    const activity = await create();
    expect(activity).not.toHaveProperty("status");
    expect(await f.db.collection("activities").findOne({ _id: new ObjectId(activity.id) })).not.toHaveProperty("status");
    const response = await f.request("POST", f.path(), { dayId: f.day.toHexString(), description: "Recuerdo",
      newActivity: { title: "Cena", scheduledAt: f.occurrence.toISOString(), status: "proposed" } });
    expect(response.statusCode).toBe(201);
    const joint = JSON.parse(response.body);
    expect(joint.post.activityId).toBe(joint.activity.id);
    expect(joint.activity).not.toHaveProperty("status");
    expect(await f.db.collection("activities").findOne({ _id: new ObjectId(joint.activity.id) })).not.toHaveProperty("status");
    expect(await f.db.collection("activityVotes").find().toArray()).toEqual(votes);
  });
  it("keeps simultaneous plans and activities visible after the last participant stops attending", async () => {
    const other = new ObjectId();
    await f.db.collection("tripMembers").insertOne({ tripId: f.trip, userId: other, role: "participant" });
    const first = await create(), second = await create(other);
    for (const [activity, user] of [[first, f.actor], [second, other]] as const) {
      const path = `${activitiesPath()}/${activity.id}/participation`;
      expect((await f.request("PUT", path, { status: "going" }, user)).statusCode).toBe(200);
      expect((await f.request("PUT", path, { status: "not_going" }, user)).statusCode).toBe(200);
      expect((await f.request("GET", `${activitiesPath()}/${activity.id}`)).statusCode).toBe(200);
    }
    const list = JSON.parse((await f.request("GET", activitiesPath())).body).activities;
    const itinerary = JSON.parse((await f.request("GET", `${tripPath()}/itinerary`)).body).itinerary;
    expect(list.map((a: { id: string }) => a.id).sort()).toEqual([first.id, second.id].sort());
    expect(itinerary.activities.map((a: { id: string }) => a.id).sort()).toEqual([first.id, second.id].sort());
    expect(await f.db.collection("activityParticipations").countDocuments({ status: "going" })).toBe(0);
    expect(await f.db.collection("activityVotes").countDocuments()).toBe(0);
  });
  it.each(["activity", "trip"])("preserves historical votes during explicit %s deletion", async (resource) => {
    const activityId = await seedLegacy();
    await f.db.collection("tripMembers").updateOne({ tripId: f.trip, userId: f.actor }, { $set: { role: "admin" } });
    const votes = await f.db.collection("activityVotes").find().toArray();
    const response = await f.request("DELETE", resource === "trip" ? tripPath() : `${activitiesPath()}/${activityId}`);
    expect(response.statusCode).toBe(204);
    expect(await f.db.collection("activities").findOne({ _id: activityId })).toBeNull();
    expect(await f.db.collection("activityVotes").find().toArray()).toEqual(votes);
  });
  it("preserves legacy BSON records, indexes and migration timestamps when rerunning migrations", async () => {
    await seedLegacy();
    const before = await snapshot();
    const indexes = await f.db.collection("activityVotes").listIndexes().toArray();
    const versions = await f.db.collection("_migrations").find().toArray();
    await migrateMongoSchema(f.db);
    expect(await snapshot()).toEqual(before);
    expect(await f.db.collection("activityVotes").listIndexes().toArray()).toEqual(indexes);
    expect(await f.db.collection("_migrations").find().toArray()).toEqual(versions);
  });
});
