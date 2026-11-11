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
    const transportInput = { type: "car", departurePlace: "Origen", arrivalPlace: "Destino", costPerPerson: 999, costCurrency: "ARS", details: {} };
    const outboundResponse = await post(transportsPath, { ...transportInput, direction: "outbound", departureAt: "2026-09-25T08:00:00.123Z", arrivalAt: "2026-09-25T10:00:00.456Z" });
    expect(outboundResponse.status).toBe(201);
    const outbound = (await outboundResponse.json() as { transport: { id: string } }).transport;
    expect((await post(transportsPath, { ...transportInput, direction: "return", departureAt: "2026-09-26T18:00:00.789Z", arrivalAt: "2026-09-26T20:00:00.123Z" })).status).toBe(201);
    const days = await db.collection("itineraryDays").find({ tripId }).sort({ order: 1 }).toArray();
    const activity = new ObjectId(), secondActivity = new ObjectId(), spontaneous = new ObjectId(), combined = new ObjectId(), transitPost = new ObjectId();
    const activityBase = { tripId, dayId: days[1]!._id, title: "Paseo", description: null, mapsUrl: null, status: "confirmed", createdBy: actor, createdAt: new Date("2026-09-26T23:00:00Z") };
    await db.collection("activities").insertMany([
      { ...activityBase, _id: secondActivity, scheduledAt: new Date("2026-09-25T14:00:00Z"), durationMinutes: 90 },
      { ...activityBase, _id: activity, scheduledAt: new Date("2026-09-25T12:00:00Z") },
    ]);
    const postBase = { tripId, dayId: days[1]!._id, authorId: actor, description: null, mapsUrl: null, activityId: null, transportId: null, parentPostId: null };
    await db.collection("posts").insertMany([
      { ...postBase, _id: combined, activityId: activity, transportId: new ObjectId(outbound.id), parentPostId: spontaneous, createdAt: new Date("2026-10-03T12:00:00.789Z") },
      { ...postBase, _id: spontaneous, createdAt: new Date("2026-09-25T13:00:00Z") },
      { ...postBase, _id: transitPost, dayId: days[0]!._id, transportId: new ObjectId(outbound.id), createdAt: new Date("2026-09-25T09:00:00Z") },
    ]);
    await db.collection("postExpenses").insertMany([
      { tripId, postId: combined, totalAmount: 10.5, currency: "ARS", breakdown: null, paidBy: null, createdAt: new Date() },
      { tripId, postId: spontaneous, totalAmount: 20, currency: "ARS", breakdown: "Agua", paidBy: null, createdAt: new Date() },
      { tripId, postId: transitPost, totalAmount: 5, currency: "ARS", breakdown: null, paidBy: null, createdAt: new Date() },
    ]);
    const response = await fetch(`${base}/trips/${trip.id}/itinerary`, { headers });
    expect(response.status).toBe(200);
    const { itinerary } = await response.json() as { itinerary: {
      days: { id: string; order: number; startsAt: string; items: { kind: string; id: string }[]; expenseSummary: { byCurrency: { currency: string; totalCents: number; expenseCount: number }[]; expenseCount: number } }[];
      activities: { id: string; postIds: string[]; durationMinutes: number | null }[]; transports: { id: string; postIds: string[] }[];
      posts: { id: string; dayId: string; activityId: string | null; transportId: string | null; parentPostId: string | null; createdAt: string }[];
    } };
    expect(itinerary.days.map((day) => day.order)).toEqual([1, 2, 3, 4]);
    expect(itinerary.days[1]!.startsAt).toBe("2026-09-25T10:00:00.456Z");
    expect(itinerary.days[1]!.items).toMatchObject([{ kind: "activity", id: activity.toHexString() }, { kind: "post", id: spontaneous.toHexString() }, { kind: "activity", id: secondActivity.toHexString() }]);
    expect(itinerary.activities[0]!.postIds).toEqual([combined.toHexString()]);
    expect(itinerary.activities.map((value) => ({ id: value.id, durationMinutes: value.durationMinutes }))).toEqual([
      { id: activity.toHexString(), durationMinutes: null }, { id: secondActivity.toHexString(), durationMinutes: 90 }]);
    expect(itinerary.transports.find((t) => t.id === outbound.id)!.postIds).toEqual([transitPost.toHexString(), combined.toHexString()]);
    expect(itinerary.posts).toHaveLength(3);
    expect(itinerary.posts.find((p) => p.id === combined.toHexString())).toMatchObject({ dayId: days[1]!._id.toHexString(), activityId: activity.toHexString(),
      transportId: outbound.id, parentPostId: spontaneous.toHexString(), createdAt: "2026-10-03T12:00:00.789Z" });
    expect(itinerary.days.map((day) => [day.expenseSummary.byCurrency, day.expenseSummary.expenseCount])).toEqual([
      [[{ currency: "ARS", totalCents: 500, expenseCount: 1 }], 1], [[{ currency: "ARS", totalCents: 3050, expenseCount: 2 }], 2], [[], 0], [[], 0],
    ]);
  });

  it("totals transport costs per currency across destinations, apart from post expenses", async () => {
    const trip = await createTrip(), tripId = new ObjectId(trip.id);
    const second = await post(`/trips/${trip.id}/destinations`, { name: "Mendoza" });
    expect(second.status).toBe(201);
    const secondId = (await second.json() as { destination: { id: string } }).destination.id;
    const path = (destinationId: string) => `/trips/${trip.id}/destinations/${destinationId}/transports`;
    const base_ = { type: "car", departurePlace: "Origen", arrivalPlace: "Destino", details: {} };
    const slot = (direction: string, from: string, to: string) => ({ direction, departureAt: from, arrivalAt: to });
    const created = [
      await post(path(trip.primaryDestination.id), { ...base_, ...slot("outbound", "2026-09-25T08:00:00Z", "2026-09-25T10:00:00Z"), costPerPerson: 100.1, costCurrency: "ARS" }),
      await post(path(trip.primaryDestination.id), { ...base_, ...slot("return", "2026-09-26T18:00:00Z", "2026-09-26T20:00:00Z"), costPerPerson: 20, costCurrency: "USD" }),
      await post(path(secondId), { ...base_, ...slot("outbound", "2026-09-27T08:00:00Z", "2026-09-27T10:00:00Z"), costPerPerson: 0.2, costCurrency: "ARS" }),
      await post(path(secondId), { ...base_, ...slot("return", "2026-09-28T18:00:00Z", "2026-09-28T20:00:00Z"), costPerPerson: null }),
    ];
    expect(created.map((response) => response.status)).toEqual([201, 201, 201, 201]);
    type Totals = { byCurrency: { currency: string; totalCents: number; transportCount: number }[]; withoutCurrency: { transportCount: number } };
    type Itinerary = { transportCostTotals: Totals; transports: { costPerPerson: number | null; costCurrency: string | null }[];
      expenseSummary: { byCurrency: unknown[]; expenseCount: number } };
    const get = async () => (await (await fetch(`${base}/trips/${trip.id}/itinerary`, { headers })).json() as { itinerary: Itinerary }).itinerary;
    const days = await db.collection("itineraryDays").find({ tripId }).sort({ order: 1 }).toArray();
    const postId = new ObjectId();
    await db.collection("posts").insertOne({ _id: postId, tripId, dayId: days[0]!._id, authorId: actor, description: null, mapsUrl: null,
      activityId: null, transportId: null, parentPostId: null, createdAt: new Date("2026-09-25T09:00:00Z") });
    await db.collection("postExpenses").insertOne({ tripId, postId, totalAmount: 5, currency: "EUR", breakdown: null, paidBy: null, createdAt: new Date() });
    const mixed = await get();
    expect(mixed.transportCostTotals).toEqual({
      byCurrency: [{ currency: "ARS", totalCents: 10030, transportCount: 2 }, { currency: "USD", totalCents: 2000, transportCount: 1 }],
      withoutCurrency: { transportCount: 0 },
    });
    expect(mixed.expenseSummary).toMatchObject({ expenseCount: 1, byCurrency: [{ currency: "EUR", totalCents: 500, expenseCount: 1 }] });

    // A previous record: cost stored directly without currency.
    await db.collection("transports").updateOne({ tripId, destinationId: new ObjectId(secondId), direction: "return" }, { $set: { costPerPerson: 40 } });
    const previous = await get();
    expect(previous.transportCostTotals).toEqual({ ...mixed.transportCostTotals, withoutCurrency: { transportCount: 1 } });
    expect(previous.transports.filter((t) => t.costPerPerson !== null && t.costCurrency === null)).toHaveLength(1);
    expect(previous.expenseSummary).toEqual(mixed.expenseSummary);
  });

  it("projects posts without a day by context and returns unplaced posts with ISO milliseconds", async () => {
    const trip = await createTrip();
    const transportsPath = `/trips/${trip.id}/destinations/${trip.primaryDestination.id}/transports`;
    const input = { type: "car", departurePlace: "Origen", arrivalPlace: "Destino", costPerPerson: 999, costCurrency: "ARS", details: {} };
    expect((await post(transportsPath, { ...input, direction: "outbound", departureAt: "2026-09-25T08:00:00.123Z", arrivalAt: "2026-09-25T10:00:00.456Z" })).status).toBe(201);
    expect((await post(transportsPath, { ...input, direction: "return", departureAt: "2026-09-26T18:00:00.789Z", arrivalAt: "2026-09-26T20:00:00.123Z" })).status).toBe(201);
    const tripId = new ObjectId(trip.id);
    const days = await db.collection("itineraryDays").find({ tripId }).sort({ order: 1 }).toArray();
    const activity = new ObjectId(), root = new ObjectId(), child = new ObjectId(), free = new ObjectId(), late = new ObjectId();
    await db.collection("activities").insertOne({ _id: activity, tripId, dayId: days[1]!._id, title: "Paseo", description: null, mapsUrl: null, status: "confirmed",
      createdBy: actor, createdAt: new Date("2026-09-25T11:00:00Z"), scheduledAt: new Date("2026-09-25T12:00:00Z") });
    const base_ = { tripId, authorId: actor, description: null, mapsUrl: null, activityId: null, transportId: null, parentPostId: null };
    await db.collection("posts").insertMany([
      { ...base_, _id: root, activityId: activity, createdAt: new Date("2026-09-25T13:00:00.000Z") },
      { ...base_, _id: child, parentPostId: root, createdAt: new Date("2026-12-01T13:00:00.123Z") },
      { ...base_, _id: free, createdAt: new Date("2026-09-25T15:00:00.789Z") },
      { ...base_, _id: late, createdAt: new Date("2027-01-01T00:00:00.001Z") },
    ]);
    const response = await fetch(`${base}/trips/${trip.id}/itinerary`, { headers });
    expect(response.status).toBe(200);
    const { itinerary } = await response.json() as { itinerary: { posts: { id: string; dayId: string; context: { placement: string; rootActivityId: string | null } }[];
      unplacedPosts: { id: string; dayId: null; createdAt: string; context: { placement: string } }[]; activities: { postIds: string[] }[]; days: { items: { id: string }[] }[] } };
    expect(itinerary.activities[0]!.postIds).toEqual([root.toHexString(), child.toHexString()]);
    expect(itinerary.posts.map((p) => [p.id, p.dayId, p.context.placement])).toEqual([[root.toHexString(), days[1]!._id.toHexString(), "activity"],
      [free.toHexString(), days[1]!._id.toHexString(), "independent"], [child.toHexString(), days[1]!._id.toHexString(), "activity"]]);
    expect(itinerary.unplacedPosts).toMatchObject([{ id: late.toHexString(), dayId: null, createdAt: "2027-01-01T00:00:00.001Z", context: { placement: "independent" } }]);
    expect(itinerary.days[1]!.items.map((i) => i.id)).toContain(free.toHexString());
  });

  it("recomputes the expense projection after reschedule, relink and delete through the real endpoints without touching persisted amounts", async () => {
    const trip = await createTrip(), tripId = new ObjectId(trip.id);
    const transportsPath = `/trips/${trip.id}/destinations/${trip.primaryDestination.id}/transports`;
    const input = { type: "car", departurePlace: "Origen", arrivalPlace: "Destino", costPerPerson: 999, costCurrency: "ARS", details: {} };
    expect((await post(transportsPath, { ...input, direction: "outbound", departureAt: "2026-09-25T08:00:00.123Z", arrivalAt: "2026-09-25T10:00:00.456Z" })).status).toBe(201);
    expect((await post(transportsPath, { ...input, direction: "return", departureAt: "2026-09-26T18:00:00.789Z", arrivalAt: "2026-09-26T20:00:00.123Z" })).status).toBe(201);
    type Itinerary = { days: { id: string; startsAt: string; expenseSummary: { byCurrency: { currency: string; totalCents: number; expenseCount: number }[]; expenseCount: number } }[];
      expenseSummary: { expenseCount: number; byCurrency: { currency: string; totalCents: number }[]; outsideItinerary: { expenseCount: number } };
      expenses: { postId: string; rootPostId: string; source: string; rootActivityId: string | null; occurredAt: string; publishedAt: string; dayId: string | null; amountCents: number }[] };
    const get = async () => (await (await fetch(`${base}/trips/${trip.id}/itinerary`, { headers })).json() as { itinerary: Itinerary }).itinerary;
    const days = (await get()).days;
    const activityPath = `/trips/${trip.id}/activities`;
    const created = async (body: unknown) => { const r = await post(activityPath, body); expect(r.status).toBe(201); return (await r.json() as { activity: { id: string } }).activity.id; };
    const first = await created({ dayId: days[1]!.id, title: "A", scheduledAt: "2026-09-25T12:00:00.456Z" });
    const second = await created({ dayId: days[1]!.id, title: "B", scheduledAt: "2026-09-25T15:00:00.789Z" });
    const memory = async (fields: unknown) => { const r = await post(`/trips/${trip.id}/posts`, { description: "Recuerdo", ...(fields as object) }); expect(r.status).toBe(201); return (await r.json() as { post: { id: string; createdAt: string } }).post; };
    const root = await memory({ activityId: first }), child = await memory({ parentPostId: root.id });
    await db.collection("postExpenses").insertMany([
      { tripId, postId: new ObjectId(root.id), totalAmount: 10.5, currency: "ARS", breakdown: null, payments: [], shares: [], createdAt: new Date() },
      { tripId, postId: new ObjectId(child.id), totalAmount: 5, currency: "USD", breakdown: null, payments: [], shares: [], createdAt: new Date() },
    ]);
    const persisted = async () => ({ expenses: await db.collection("postExpenses").find({ tripId }, { projection: { _id: 1, postId: 1, totalAmount: 1, currency: 1, createdAt: 1 } }).sort({ _id: 1 }).toArray(),
      posts: (await db.collection("posts").find({ tripId }, { projection: { createdAt: 1 } }).sort({ _id: 1 }).toArray()).map((p) => [p._id.toHexString(), p.createdAt.toISOString()]) });
    const baseline = await persisted();
    const ars = (cents: number) => ({ currency: "ARS", totalCents: cents, expenseCount: 1 }), usd = (cents: number) => ({ currency: "USD", totalCents: cents, expenseCount: 1 });

    let value = await get();
    expect(value.days[1]!.expenseSummary).toMatchObject({ byCurrency: [ars(1050), usd(500)], expenseCount: 2 });
    expect(value.expenses.map((e) => [e.postId, e.rootPostId, e.rootActivityId, e.occurredAt, e.dayId])).toEqual([
      [root.id, root.id, first, "2026-09-25T12:00:00.456Z", days[1]!.id], [child.id, root.id, first, "2026-09-25T12:00:00.456Z", days[1]!.id]]);
    expect(value.expenses[1]!.publishedAt).toBe(child.createdAt);

    // Reschedule the root activity to the next day: both expenses follow it, with the same amounts and publication instants.
    expect((await fetch(`${base}${activityPath}/${first}`, { method: "PATCH", headers, body: JSON.stringify({ dayId: days[2]!.id, scheduledAt: days[2]!.startsAt }) })).status).toBe(200);
    value = await get();
    expect(value.days[1]!.expenseSummary.expenseCount).toBe(0);
    expect(value.days[2]!.expenseSummary).toMatchObject({ byCurrency: [ars(1050), usd(500)], expenseCount: 2 });
    expect(value.expenses.map((e) => [e.occurredAt, e.dayId, e.amountCents])).toEqual([[days[2]!.startsAt, days[2]!.id, 1050], [days[2]!.startsAt, days[2]!.id, 500]]);
    expect(value.expenses.map((e) => e.publishedAt)).toEqual([root.createdAt, child.createdAt]);

    // Relink the root memory: its descendant follows it.
    expect((await fetch(`${base}/trips/${trip.id}/posts/${root.id}`, { method: "PATCH", headers, body: JSON.stringify({ activityId: second }) })).status).toBe(200);
    value = await get();
    expect(value.days[1]!.expenseSummary).toMatchObject({ byCurrency: [ars(1050), usd(500)], expenseCount: 2 });
    expect(value.days[2]!.expenseSummary.expenseCount).toBe(0);
    expect(value.expenses.map((e) => e.rootActivityId)).toEqual([second, second]);

    // Delete the activity: each expense falls back to its own publication (outside the itinerary), amounts untouched.
    expect((await fetch(`${base}${activityPath}/${second}`, { method: "DELETE", headers })).status).toBe(204);
    value = await get();
    expect(value.days.map((day) => day.expenseSummary.expenseCount)).toEqual([0, 0, 0, 0]);
    expect(value.expenses.map((e) => [e.source, e.rootActivityId, e.dayId, e.amountCents])).toEqual([["publication", null, null, 1050], ["publication", null, null, 500]]);
    expect(value.expenseSummary).toMatchObject({ expenseCount: 2, byCurrency: [{ currency: "ARS", totalCents: 1050 }, { currency: "USD", totalCents: 500 }], outsideItinerary: { expenseCount: 2 } });
    expect(await persisted()).toEqual(baseline);
  });

  it("supports an empty Trip and enforces authentication and membership", async () => {
    const trip = await createTrip(), url = `${base}/trips/${trip.id}/itinerary`;
    const response = await fetch(url, { headers });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ itinerary: { days: [], transports: [], activities: [], posts: [], unplacedPosts: [], expenseMode: "register" } });
    expect((await fetch(url)).status).toBe(401);
    expect((await fetch(url, { headers: { authorization: "Bearer invalid" } })).status).toBe(401);
    await db.collection("tripMembers").deleteOne({ tripId: new ObjectId(trip.id), userId: actor });
    expect((await fetch(url, { headers })).status).toBe(404);
  });
});
