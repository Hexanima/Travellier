import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createObjectId } from "app-domain";
import { migrateMongoSchema } from "../adapters/mongodb/migrations.js";
import { createAuthenticationTokenAdapter } from "../auth/authentication-token-adapter.js";
import { createLocalApi } from "../local.js";

describe("aggregate itinerary HTTP API", () => {
  let server: MongoMemoryReplSet, client: MongoClient, db: Db;
  let local: Awaited<ReturnType<typeof createLocalApi>>, base: string, headers: Record<string, string>;
  const actor = new ObjectId();
  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    client = new MongoClient(server.getUri()); await client.connect(); db = client.db("itinerary_http");
    await migrateMongoSchema(db);
    local = await createLocalApi({ MONGODB_URI: server.getUri(), MONGODB_DATABASE_NAME: "itinerary_http", JWT_SECRET: "itinerary-test-secret" });
    await new Promise<void>((resolve) => local.app.listen(0, resolve));
    base = `http://127.0.0.1:${(local.app.address() as AddressInfo).port}`;
    const actorId = createObjectId(actor.toHexString()); if (!actorId.ok) throw actorId.error;
    const token = await createAuthenticationTokenAdapter({ jwtSecret: "itinerary-test-secret", accessTokenLifetimeMs: 900_000 }).createAccessToken(actorId.value);
    if (!token.ok) throw token.error;
    headers = { authorization: `Bearer ${token.value}`, "content-type": "application/json" };
  }, 120_000);
  afterAll(async () => {
    if (local) { await new Promise<void>((resolve, reject) => local.app.close((error) => error ? reject(error) : resolve())); await local.close(); }
    await client?.close(); await server?.stop();
  });
  const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  const createTrip = async () => {
    const response = await post("/trips", { name: "Viaje", primaryDestination: "Córdoba" });
    expect(response.status).toBe(201);
    return (await response.json() as { trip: { id: string; primaryDestination: { id: string } } }).trip;
  };

  it("returns configured days, chronological activity/post contexts and daily expenses in one GET", async () => {
    const trip = await createTrip(), tripId = new ObjectId(trip.id);
    const transportsPath = `/trips/${trip.id}/destinations/${trip.primaryDestination.id}/transports`;
    const transportInput = { type: "car", departurePlace: "Origen", arrivalPlace: "Destino", costPerPerson: 999, details: {} };
    const outboundResponse = await post(transportsPath, { ...transportInput, direction: "outbound", departureAt: "2026-09-25T08:00:00.123Z", arrivalAt: "2026-09-25T10:00:00.456Z" });
    expect(outboundResponse.status).toBe(201);
    const outbound = (await outboundResponse.json() as { transport: { id: string } }).transport;
    expect((await post(transportsPath, { ...transportInput, direction: "return", departureAt: "2026-09-26T18:00:00.789Z", arrivalAt: "2026-09-26T20:00:00.123Z" })).status).toBe(201);
    const days = await db.collection("itineraryDays").find({ tripId }).sort({ order: 1 }).toArray();
    const activity = new ObjectId(), secondActivity = new ObjectId(), spontaneous = new ObjectId(), combined = new ObjectId(), transitPost = new ObjectId();
    const activityBase = { tripId, dayId: days[1]!._id, title: "Paseo", description: null, mapsUrl: null, status: "confirmed", createdBy: actor, createdAt: new Date("2026-09-26T23:00:00Z") };
    await db.collection("activities").insertMany([
      { ...activityBase, _id: secondActivity, scheduledAt: new Date("2026-09-25T14:00:00Z") },
      { ...activityBase, _id: activity, scheduledAt: new Date("2026-09-25T12:00:00Z") },
    ]);
    const postBase = { tripId, dayId: days[1]!._id, authorId: actor, description: null, mapsUrl: null, activityId: null, transportId: null, parentPostId: null };
    await db.collection("posts").insertMany([
      { ...postBase, _id: combined, activityId: activity, transportId: new ObjectId(outbound.id), parentPostId: spontaneous, createdAt: new Date("2026-10-03T12:00:00.789Z") },
      { ...postBase, _id: spontaneous, createdAt: new Date("2026-09-25T13:00:00Z") },
      { ...postBase, _id: transitPost, dayId: days[0]!._id, transportId: new ObjectId(outbound.id), createdAt: new Date("2026-09-25T09:00:00Z") },
    ]);
    await db.collection("postExpenses").insertMany([
      { tripId, postId: combined, totalAmount: 10.5, breakdown: null, paidBy: null, createdAt: new Date() },
      { tripId, postId: spontaneous, totalAmount: 20, breakdown: "Agua", paidBy: null, createdAt: new Date() },
      { tripId, postId: transitPost, totalAmount: 5, breakdown: null, paidBy: null, createdAt: new Date() },
    ]);
    const response = await fetch(`${base}/trips/${trip.id}/itinerary`, { headers });
    expect(response.status).toBe(200);
    const { itinerary } = await response.json() as { itinerary: {
      days: { id: string; order: number; startsAt: string; items: { kind: string; id: string }[]; expenseSummary: { totalAmount: number; expenseCount: number } }[];
      activities: { id: string; postIds: string[] }[]; transports: { id: string; postIds: string[] }[];
      posts: { id: string; dayId: string; activityId: string | null; transportId: string | null; parentPostId: string | null; createdAt: string }[];
    } };
    expect(itinerary.days.map((day) => day.order)).toEqual([1, 2, 3, 4]);
    expect(itinerary.days[1]!.startsAt).toBe("2026-09-25T10:00:00.456Z");
    expect(itinerary.days[1]!.items).toMatchObject([{ kind: "activity", id: activity.toHexString() }, { kind: "post", id: spontaneous.toHexString() }, { kind: "activity", id: secondActivity.toHexString() }]);
    expect(itinerary.activities[0]!.postIds).toEqual([combined.toHexString()]);
    expect(itinerary.transports.find((t) => t.id === outbound.id)!.postIds).toEqual([transitPost.toHexString(), combined.toHexString()]);
    expect(itinerary.posts).toHaveLength(3);
    expect(itinerary.posts.find((p) => p.id === combined.toHexString())).toMatchObject({ dayId: days[1]!._id.toHexString(), activityId: activity.toHexString(),
      transportId: outbound.id, parentPostId: spontaneous.toHexString(), createdAt: "2026-10-03T12:00:00.789Z" });
    expect(itinerary.days.map((day) => day.expenseSummary)).toEqual([
      { totalAmount: 5, expenseCount: 1 }, { totalAmount: 30.5, expenseCount: 2 }, { totalAmount: 0, expenseCount: 0 }, { totalAmount: 0, expenseCount: 0 },
    ]);
  });

  it("supports an empty Trip and enforces authentication and membership", async () => {
    const trip = await createTrip(), url = `${base}/trips/${trip.id}/itinerary`;
    const response = await fetch(url, { headers });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ itinerary: { days: [], transports: [], activities: [], posts: [], expenseMode: "register" } });
    expect((await fetch(url)).status).toBe(401);
    expect((await fetch(url, { headers: { authorization: "Bearer invalid" } })).status).toBe(401);
    await db.collection("tripMembers").deleteOne({ tripId: new ObjectId(trip.id), userId: actor });
    expect((await fetch(url, { headers })).status).toBe(404);
  });
});
