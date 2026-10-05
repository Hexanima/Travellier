import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { SignJWT } from "jose";
import { createObjectId, type TripItinerary } from "app-domain";
import { handleApiRequest, type TripApi } from "../app.js";
import { createTripApi } from "./trip-api.js";
import { migrateMongoSchema } from "../adapters/mongodb/migrations.js";
import { createLambdaHandler } from "../lambda.js";

describe("activity HTTP API", () => {
  let server: MongoMemoryReplSet, client: MongoClient, db: Db, api: TripApi;
  let trip: ObjectId, actor: ObjectId, destination: ObjectId, day: ObjectId, path: string;
  const request = (method: string, url: string, body?: unknown, user: ObjectId | null = actor) => {
    const identity = user === null ? undefined : createObjectId(user.toHexString());
    if (identity !== undefined && !identity.ok) throw identity.error;
    return handleApiRequest({ method, url, ...(identity?.ok ? { authenticatedUserId: identity.value } : {}),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, { trips: api });
  };
  const input = () => ({ dayId: day.toHexString(), title: "Paseo", scheduledAt: "2026-09-25T12:00:00.456Z" });
  const create = async () => {
    const response = await request("POST", path, input());
    expect(response.statusCode).toBe(201);
    return JSON.parse(response.body).activity as { id: string; dayId: string; createdAt: string; createdBy: string; scheduledAt: string; status: string };
  };
  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    client = new MongoClient(server.getUri()); await client.connect();
    db = client.db("activity_http"); await migrateMongoSchema(db);
  }, 120_000);
  afterAll(async () => { await client?.close(); await server?.stop(); });
  beforeEach(async () => {
    for (const name of ["trips", "tripMembers", "destinations", "itineraryDays", "activities", "posts", "postExpenses", "activityVotes", "activityParticipations", "transports"]) {
      await db.collection(name).deleteMany({});
    }
    trip = new ObjectId(); actor = new ObjectId(); destination = new ObjectId(); day = new ObjectId();
    await db.collection("trips").insertOne({ _id: trip, inviteCode: trip.toHexString(), visibility: "public", votingEnabled: false, expenseMode: "register" });
    await db.collection("tripMembers").insertOne({ tripId: trip, userId: actor, role: "participant", joinedAt: new Date() });
    await db.collection("destinations").insertOne({ _id: destination, tripId: trip, name: "Córdoba", order: 1, createdAt: new Date() });
    await db.collection("itineraryDays").insertOne({ _id: day, tripId: trip, destinationId: destination, date: new Date("2026-09-25T00:00:00Z"),
      type: "activity", order: 1, startsAt: new Date("2026-09-25T10:00:00.123Z"), endsAt: new Date("2026-09-25T18:00:00.789Z") });
    api = createTripApi(db); path = `/trips/${trip.toHexString()}/activities`;
  });

  it.each(["admin", "participant"])("allows %s CRUD and ignores spoofed protected fields", async (role) => {
    await db.collection("tripMembers").updateOne({ tripId: trip }, { $set: { role } });
    const response = await request("POST", path, { ...input(), id: new ObjectId().toHexString(), tripId: new ObjectId().toHexString(),
      createdBy: new ObjectId().toHexString(), authenticatedUserId: new ObjectId().toHexString(), createdAt: "2000-01-01T00:00:00Z", status: "voting", votingEnabled: true });
    expect(response.statusCode).toBe(201);
    const activity = JSON.parse(response.body).activity;
    expect(activity).toMatchObject({ tripId: trip.toHexString(), createdBy: actor.toHexString(), status: "confirmed", scheduledAt: input().scheduledAt });
    const updated = await request("PATCH", `${path}/${activity.id}`, { title: "Museo", description: "Centro", mapsUrl: null,
      tripId: new ObjectId().toHexString(), status: "voting", createdBy: new ObjectId().toHexString(), createdAt: "2000-01-01T00:00:00Z" });
    expect(updated.statusCode).toBe(200);
    const result = JSON.parse(updated.body).activity;
    expect(result).toMatchObject({ title: "Museo", description: "Centro", scheduledAt: activity.scheduledAt, createdAt: activity.createdAt,
      createdBy: activity.createdBy, status: "confirmed" });
    expect(JSON.parse((await request("GET", `${path}/${activity.id}`)).body)).toEqual({ activity: result });
    expect(JSON.parse((await request("GET", path)).body)).toEqual({ activities: [result] });
    const removed = await request("DELETE", `${path}/${activity.id}`);
    expect(removed.statusCode).toBe(204); expect(removed.body).toBe("");
    expect((await request("GET", `${path}/${activity.id}`)).statusCode).toBe(404);
    expect(JSON.parse((await request("GET", path)).body)).toEqual({ activities: [] });
  });

  it.each(["GET", "POST", "PATCH", "DELETE"])("requires JWT identity for %s", async (method) => {
    const url = method === "PATCH" || method === "DELETE" ? `${path}/${new ObjectId()}` : path;
    expect((await request(method, url, input(), null)).statusCode).toBe(401);
  });

  it("enforces access JWTs for activity routes through the Lambda entry point", async () => {
    const jwtSecret = "activity-test-signing-secret";
    const handler = createLambdaHandler({ loadRuntimeConfig: async () => ({ environment: "dev", mongo: { uri: server.getUri(), databaseName: db.databaseName },
      jwtSecret, photoBucketName: "unused" }), createTripApi: async () => api });
    const key = new TextEncoder().encode(jwtSecret);
    const token = (expires: number, tokenType = "access") => new SignJWT({ tokenType }).setSubject(actor.toHexString())
      .setProtectedHeader({ alg: "HS256" }).setExpirationTime(expires).sign(key);
    const now = Math.floor(Date.now() / 1000);
    for (const jwt of [undefined, "invalid", await token(now - 60), await token(now + 60, "refresh")]) {
      for (const [method, url] of [["GET", path], ["POST", path], ["GET", `${path}/${new ObjectId()}`],
        ["PATCH", `${path}/${new ObjectId()}`], ["DELETE", `${path}/${new ObjectId()}`]]) {
        expect((await handler({ rawPath: url!, headers: jwt ? { authorization: `Bearer ${jwt}` } : {}, body: JSON.stringify(input()),
          requestContext: { http: { method: method! } } })).statusCode).toBe(401);
      }
    }
    const response = await handler({ rawPath: path, headers: { authorization: `Bearer ${await token(now + 60)}` }, body: JSON.stringify(input()),
      requestContext: { http: { method: "POST" } } });
    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body).activity.createdBy).toBe(actor.toHexString());
  });

  it("hides public content from outsiders and revoked members for all five operations", async () => {
    const activity = await create();
    for (const user of [new ObjectId(), actor]) {
      if (user === actor) await db.collection("tripMembers").deleteMany({ tripId: trip });
      for (const [method, url, body] of [["POST", path, input()], ["GET", path], ["GET", `${path}/${activity.id}`],
        ["PATCH", `${path}/${activity.id}`, { title: "No" }], ["DELETE", `${path}/${activity.id}`]] as const) {
        expect((await request(method, url, body, user)).statusCode).toBe(404);
      }
    }
    expect(await db.collection("activities").countDocuments()).toBe(1);
  });

  it("returns 400 for malformed IDs, JSON and empty/unknown-only PATCH", async () => {
    expect((await request("GET", "/trips/invalid/activities")).statusCode).toBe(400);
    expect((await request("GET", `${path}/invalid`)).statusCode).toBe(400);
    const activity = await create();
    for (const payload of [{}, { status: "confirmed" }, [], "bad JSON"]) {
      expect((await request("PATCH", `${path}/${activity.id}`, payload)).statusCode).toBe(400);
    }
    const identity = createObjectId(actor.toHexString()); if (!identity.ok) throw identity.error;
    expect((await handleApiRequest({ method: "POST", url: path, body: "{", authenticatedUserId: identity.value }, { trips: api })).statusCode).toBe(400);
  });

  it.each([undefined, null, "", "2026-09-25", "2026-09-25T12:00:00", "2026-02-30T12:00:00Z", "2026-09-25T24:00:00Z",
    "2026-09-25T12:60:00Z", "2026-09-25T12:00:60Z", "2026-09-25T12:00:00.4567Z", "invalid", 0,
    "2026-09-25T10:00:00.122Z", "2026-09-25T18:00:00.790Z"])("rejects invalid or missing occurrence time: %s", async (scheduledAt) => {
    const before = await db.collection("trips").findOne({ _id: trip });
    const response = await request("POST", path, { ...input(), scheduledAt });
    expect(response.statusCode).toBe(422);
    expect(JSON.parse(response.body)).toMatchObject({ error: { code: "ValidationError", fields: [{ field: "scheduledAt" }] } });
    expect(await db.collection("activities").countDocuments()).toBe(0);
    expect(await db.collection("trips").findOne({ _id: trip })).toEqual(before);
  });

  it.each(["2026-09-25T09:00:00.456-03:00", "2026-09-25T14:00:00.456+02:00", "2026-09-25T12:00:00.456Z"])(
    "round-trips %s as UTC through POST/PATCH/GET and itinerary", async (scheduledAt) => {
      const response = await request("POST", path, { ...input(), scheduledAt });
      expect(response.statusCode).toBe(201);
      const activity = JSON.parse(response.body).activity;
      expect(activity.scheduledAt).toBe(input().scheduledAt);
      const edited = await request("PATCH", `${path}/${activity.id}`, { scheduledAt });
      expect(edited.statusCode).toBe(200); expect(JSON.parse(edited.body).activity.scheduledAt).toBe(input().scheduledAt);
      const itinerary = JSON.parse((await request("GET", `/trips/${trip}/itinerary`)).body).itinerary;
      expect(itinerary.activities).toMatchObject([{ id: activity.id, scheduledAt: input().scheduledAt }]);
      expect(itinerary.days[0].items).toMatchObject([{ kind: "activity", id: activity.id, at: input().scheduledAt }]);
    });

  it("rejects null dates and invalid day changes on PATCH without modifying activity", async () => {
    const activity = await create(), before = await db.collection("activities").find().toArray();
    for (const patch of [{ scheduledAt: null }, { scheduledAt: "2026-09-25T09:00:00Z" }, { dayId: new ObjectId().toHexString() }, { dayId: null }, { title: " " }]) {
      expect((await request("PATCH", `${path}/${activity.id}`, patch)).statusCode).toBe(422);
      expect(await db.collection("activities").find().toArray()).toEqual(before);
    }
  });

  it("rejects foreign days, transit slices and cross-Trip activity IDs", async () => {
    const foreignDay = new ObjectId();
    await db.collection("itineraryDays").insertOne({ _id: foreignDay, tripId: new ObjectId() });
    expect((await request("POST", path, { ...input(), dayId: foreignDay.toHexString() })).statusCode).toBe(422);
    await db.collection("itineraryDays").updateOne({ _id: day }, { $set: { type: "transit_out" } });
    expect((await request("POST", path, input())).statusCode).toBe(422);
    const foreignActivity = new ObjectId();
    await db.collection("activities").insertOne({ _id: foreignActivity, tripId: new ObjectId() });
    for (const method of ["GET", "PATCH", "DELETE"]) expect((await request(method, `${path}/${foreignActivity}`, { title: "No" })).statusCode).toBe(404);
  });

  it("includes a newly created activity in the aggregate itinerary immediately", async () => {
    const activity = await create();
    const response = await request("GET", `/trips/${trip}/itinerary`);
    expect(response.statusCode).toBe(200);
    const itinerary = JSON.parse(response.body).itinerary;
    expect(itinerary.activities).toMatchObject([{ ...activity, postIds: [] }]);
    expect(itinerary.days[0].items).toEqual([{ kind: "activity", id: activity.id, at: activity.scheduledAt }]);
  });

  it("updates itinerary placement and detaches posts on deletion without moving their own day", async () => {
    const activity = await create(), secondDay = new ObjectId(), postId = new ObjectId();
    const baseDay = await db.collection("itineraryDays").findOne({ _id: day });
    await db.collection("itineraryDays").insertOne({ ...baseDay!, _id: secondDay, order: 2, date: new Date("2026-09-26T00:00:00Z"),
      startsAt: new Date("2026-09-26T10:00:00Z"), endsAt: new Date("2026-09-26T18:00:00Z") });
    await db.collection("posts").insertOne({ _id: postId, tripId: trip, dayId: day, authorId: actor, activityId: new ObjectId(activity.id),
      parentPostId: null, transportId: null, description: "Recuerdo", mapsUrl: null, createdAt: new Date("2026-10-04T12:00:00Z") });
    expect((await request("PATCH", `${path}/${activity.id}`, { dayId: secondDay.toHexString(), scheduledAt: "2026-09-26T12:00:00.123Z" })).statusCode).toBe(200);
    const query = async () => JSON.parse((await request("GET", `/trips/${trip}/itinerary`)).body).itinerary as TripItinerary;
    const moved = await query();
    expect(moved.days[0]!.items).toEqual([]);
    expect(moved.days[1]!.items).toMatchObject([{ kind: "activity", id: activity.id }]);
    expect(moved.activities[0]!.postIds).toEqual([postId.toHexString()]);
    expect((await request("DELETE", `${path}/${activity.id}`)).statusCode).toBe(204);
    const removed = await query();
    expect(removed.activities).toEqual([]); expect(removed.days[1]!.items).toEqual([]);
    expect(removed.days[0]!.items).toMatchObject([{ kind: "post", id: postId.toHexString() }]);
    expect(removed.posts[0]).toMatchObject({ dayId: day.toHexString(), activityId: null });
  });
});
