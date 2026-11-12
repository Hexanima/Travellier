import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";

import { createObjectId } from "app-domain";
import { migrateMongoSchema } from "../adapters/mongodb/migrations.js";
import { createAuthenticationTokenAdapter } from "../auth/authentication-token-adapter.js";
import { createLocalApi } from "../local.js";

type Person = "A" | "B" | "C" | "E" | "X";

describe("Hiding the Trip from non-members (T137)", () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  let database: Db;
  let localApi: Awaited<ReturnType<typeof createLocalApi>>;
  let baseUrl: string;
  const users = Object.fromEntries((["A", "B", "C", "E", "X"] as const).map((name) => [name, new ObjectId()])) as Record<Person, ObjectId>;
  const headers = {} as Record<Person, Record<string, string>>;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    client = new MongoClient(replSet.getUri());
    await client.connect();
    database = client.db("travellier_trip_hiding_test");
    await migrateMongoSchema(database);
    await database.collection("users").insertMany(Object.entries(users).map(([name, _id]) =>
      ({ _id, name, email: `${name.toLowerCase()}@example.com`, passwordHash: "secret" })));
    localApi = await createLocalApi({ MONGODB_URI: replSet.getUri(), MONGODB_DATABASE_NAME: "travellier_trip_hiding_test", JWT_SECRET: "hiding-secret" });
    await new Promise<void>((resolve) => localApi.app.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(localApi.app.address() as AddressInfo).port}`;
    const tokens = createAuthenticationTokenAdapter({ jwtSecret: "hiding-secret", accessTokenLifetimeMs: 900_000 });
    for (const person of Object.keys(users) as Person[]) {
      const id = createObjectId(users[person].toHexString());
      if (!id.ok) throw id.error;
      const token = await tokens.createAccessToken(id.value);
      if (!token.ok) throw token.error;
      headers[person] = { authorization: `Bearer ${token.value}`, "content-type": "application/json" };
    }
  }, 120_000);

  afterAll(async () => {
    if (localApi !== undefined) {
      await new Promise<void>((resolve, reject) => localApi.app.close((error) => error === undefined ? resolve() : reject(error)));
      await localApi.close();
    }
    await client?.close();
    await replSet?.stop();
  });

  const send = async (person: Person, method: string, path: string, body?: unknown) => {
    const response = await fetch(`${baseUrl}${path}`, { method, headers: headers[person], ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, text: await response.text() };
  };

  /** A creates the Trip (owner); B is admin, C participant, E was a member and was expelled; X never belonged. */
  const newTrip = async (visibility: "private" | "public" = "private") => {
    const created = await send("A", "POST", "/trips", { name: "Patagonia", primaryDestination: "Bariloche" });
    expect(created.status, created.text).toBe(201);
    const tripId = (JSON.parse(created.text) as { trip: { id: string } }).trip.id;
    await database.collection("trips").updateOne({ _id: new ObjectId(tripId) }, { $set: { visibility } });
    await database.collection("tripMembers").insertMany((["B", "C", "E"] as const).map((person) =>
      ({ _id: new ObjectId(), tripId: new ObjectId(tripId), userId: users[person], role: person === "B" ? "admin" : "participant", joinedAt: new Date() })));
    expect((await send("A", "DELETE", `/trips/${tripId}/members/${users.E.toHexString()}`)).status).toBe(204);
    return tripId;
  };
  const snapshot = async (tripId: string) => {
    const id = new ObjectId(tripId);
    return {
      trip: await database.collection("trips").findOne({ _id: id }),
      members: await database.collection("tripMembers").find({ tripId: id }).sort({ _id: 1 }).toArray(),
      events: await database.collection("outboxEvents").find({ tripId: id }).sort({ _id: 1 }).toArray(),
      participations: await database.collection("activityParticipations").find({ tripId: id }).sort({ _id: 1 }).toArray(),
    };
  };

  const some = () => new ObjectId().toHexString();
  /**
   * Every route of the Trip served by app.ts (itinerary, balance, posts, comments, likes, activities, participation, destinations,
   * transports, members, ownership, leave, detail, config, join, delete), with a body that passes validation where it has one.
   * Not here: the photo routes (the local API has no storage; photo-http.integration.test.ts covers them), and the routes that are
   * not scoped to one Trip (POST /trips, GET /trips, GET /trips/public, POST /trips/join, invitations).
   * GET /trips/:id and POST /trips/:id/join are listed, but only for a private Trip: a public Trip keeps its preview and join (see below).
   */
  const routes: Array<[string, string, (tripId: string) => string, unknown?]> = [
    ["GET", "itinerary", (t) => `/trips/${t}/itinerary`],
    ["GET", "balance", (t) => `/trips/${t}/balance`],
    ["GET", "posts", (t) => `/trips/${t}/posts`],
    ["POST", "posts", (t) => `/trips/${t}/posts`, { text: "hola" }],
    ["GET", "post", (t) => `/trips/${t}/posts/${some()}`],
    ["PATCH", "post", (t) => `/trips/${t}/posts/${some()}`, { description: "hola" }],
    ["DELETE", "post", (t) => `/trips/${t}/posts/${some()}`],
    ["GET", "comments", (t) => `/trips/${t}/posts/${some()}/comments`],
    ["POST", "comments", (t) => `/trips/${t}/posts/${some()}/comments`, { text: "hola" }],
    ["PATCH", "comment", (t) => `/trips/${t}/posts/${some()}/comments/${some()}`, { text: "hola" }],
    ["DELETE", "comment", (t) => `/trips/${t}/posts/${some()}/comments/${some()}`],
    ["PUT", "post like", (t) => `/trips/${t}/posts/${some()}/like`],
    ["DELETE", "post like", (t) => `/trips/${t}/posts/${some()}/like`],
    ["GET", "post likes", (t) => `/trips/${t}/posts/${some()}/likes`],
    ["PUT", "comment like", (t) => `/trips/${t}/posts/${some()}/comments/${some()}/like`],
    ["DELETE", "comment like", (t) => `/trips/${t}/posts/${some()}/comments/${some()}/like`],
    ["GET", "activities", (t) => `/trips/${t}/activities`],
    ["POST", "activities", (t) => `/trips/${t}/activities`, { dayId: some(), title: "Cena", scheduledAt: "2026-12-01T20:00:00.000Z" }],
    ["GET", "activity", (t) => `/trips/${t}/activities/${some()}`],
    ["PATCH", "activity", (t) => `/trips/${t}/activities/${some()}`, { title: "Otra" }],
    ["DELETE", "activity", (t) => `/trips/${t}/activities/${some()}`],
    ["GET", "participation", (t) => `/trips/${t}/activities/${some()}/participation`],
    ["PUT", "participation", (t) => `/trips/${t}/activities/${some()}/participation`, { status: "going" }],
    ["GET", "destinations", (t) => `/trips/${t}/destinations`],
    ["POST", "destinations", (t) => `/trips/${t}/destinations`, { name: "Ushuaia" }],
    ["PATCH", "destination", (t) => `/trips/${t}/destinations/${some()}`, { name: "Otro" }],
    ["DELETE", "destination", (t) => `/trips/${t}/destinations/${some()}`],
    ["GET", "transports", (t) => `/trips/${t}/destinations/${some()}/transports`],
    ["POST", "transports", (t) => `/trips/${t}/destinations/${some()}/transports`, { direction: "outbound", type: "car", departurePlace: "Origen", departureAt: "2026-09-24T08:00:00.000Z", arrivalPlace: "Destino", arrivalAt: "2026-09-24T09:00:00.000Z", costPerPerson: null, details: {} }],
    ["PATCH", "transport", (t) => `/trips/${t}/destinations/${some()}/transports/${some()}`, { departurePlace: "Otro" }],
    ["DELETE", "transport", (t) => `/trips/${t}/destinations/${some()}/transports/${some()}`],
    ["GET", "members", (t) => `/trips/${t}/members`],
    ["PUT", "member role", (t) => `/trips/${t}/members/${users.C.toHexString()}/role`, { role: "admin" }],
    ["POST", "transfer ownership", (t) => `/trips/${t}/transfer-ownership`, { userId: users.C.toHexString() }],
    ["DELETE", "expel", (t) => `/trips/${t}/members/${users.C.toHexString()}`],
    ["POST", "leave", (t) => `/trips/${t}/leave`],
    ["GET", "detail", (t) => `/trips/${t}`],
    ["PATCH", "config", (t) => `/trips/${t}/config`, { visibility: "public" }],
    ["POST", "join", (t) => `/trips/${t}/join`],
    ["DELETE", "trip", (t) => `/trips/${t}`],
  ];

  it.each(routes)("%s %s: a stranger and a former member get the same 404 as a missing Trip, without writes", async (method, _label, path, body) => {
    const tripId = await newTrip();
    const missing = await send("A", method, path(new ObjectId().toHexString()), body);
    expect(missing.status, missing.text).toBe(404);
    const before = await snapshot(tripId);
    for (const person of ["X", "E"] as const) {
      const response = await send(person, method, path(tripId), body);
      expect(response.status, `${person}: ${response.text}`).toBe(404);
      expect(response.text, person).toBe(missing.text);
    }
    expect(await snapshot(tripId)).toEqual(before);
  }, 30_000);

  it("uses one identical body for a missing Trip, a stranger and a former member on the expulsion route", async () => {
    const tripId = await newTrip();
    const bodies = new Set<string>();
    for (const [person, trip, target] of [["A", some(), users.C.toHexString()], ["X", tripId, users.C.toHexString()], ["E", tripId, users.C.toHexString()]] as const) {
      const response = await send(person, "DELETE", `/trips/${trip}/members/${target}`);
      expect(response.status).toBe(404);
      bodies.add(response.text);
    }
    expect([...bodies]).toHaveLength(1);
    expect([...bodies][0]).toContain("Trip not found.");
  }, 30_000);

  it("keeps 403 for a participant member on the administration routes, without writes", async () => {
    const tripId = await newTrip();
    const before = await snapshot(tripId);
    expect((await send("C", "PUT", `/trips/${tripId}/members/${users.B.toHexString()}/role`, { role: "participant" })).status).toBe(403);
    expect((await send("C", "POST", `/trips/${tripId}/transfer-ownership`, { userId: users.B.toHexString() })).status).toBe(403);
    expect((await send("C", "DELETE", `/trips/${tripId}/members/${users.B.toHexString()}`)).status).toBe(403);
    expect((await send("C", "PATCH", `/trips/${tripId}/config`, { expenseMode: "balance" })).status).toBe(403);
    expect((await send("C", "DELETE", `/trips/${tripId}`)).status).toBe(403);
    expect(await snapshot(tripId)).toEqual(before);
  }, 30_000);

  it("lets members through on the administration routes (listing, role, leave, delete)", async () => {
    const tripId = await newTrip();
    expect((await send("C", "GET", `/trips/${tripId}/members`)).status).toBe(200);
    expect((await send("A", "PUT", `/trips/${tripId}/members/${users.C.toHexString()}/role`, { role: "admin" })).status).toBe(204);
    expect((await send("C", "POST", `/trips/${tripId}/leave`)).status).toBe(204);
    expect((await send("A", "DELETE", `/trips/${tripId}`)).status).toBe(204);
  }, 30_000);

  it("exposes the real ownerId in the detail and the listing, ignoring createdBy", async () => {
    const tripId = await newTrip();
    await database.collection("trips").updateOne({ _id: new ObjectId(tripId) }, { $set: { createdBy: users.X } });
    const detail = JSON.parse((await send("A", "GET", `/trips/${tripId}`)).text) as { trip: { ownerId: string } };
    expect(detail.trip.ownerId).toBe(users.A.toHexString());
    const list = JSON.parse((await send("A", "GET", "/trips")).text) as { trips: Array<{ id: string; ownerId: string }> };
    expect(list.trips.find((trip) => trip.id === tripId)?.ownerId).toBe(users.A.toHexString());
  }, 30_000);

  it("gives a former member the same public preview as a stranger on a public Trip", async () => {
    const tripId = await newTrip("public");
    const stranger = await send("X", "GET", `/trips/${tripId}`);
    const former = await send("E", "GET", `/trips/${tripId}`);
    expect(former.status, former.text).toBe(200);
    expect(former.text).toBe(stranger.text);
    const trip = (JSON.parse(former.text) as { trip: object }).trip;
    expect(trip).not.toHaveProperty("ownerId");
    expect(trip).not.toHaveProperty("members");
    expect(former.text).not.toContain(users.A.toHexString());
  }, 30_000);

  it("keeps the public preview of a public Trip for outsiders, while a private one is hidden like a missing Trip", async () => {
    const publicId = await newTrip("public");
    const preview = await send("X", "GET", `/trips/${publicId}`);
    expect(preview.status).toBe(200);
    expect((JSON.parse(preview.text) as { trip: object }).trip).not.toHaveProperty("ownerId");
    const privateId = await newTrip();
    const hidden = await send("X", "GET", `/trips/${privateId}`);
    const missing = await send("X", "GET", `/trips/${some()}`);
    expect(missing.status).toBe(404);
    expect([hidden.status, hidden.text]).toEqual([404, missing.text]);
  }, 30_000);
});
