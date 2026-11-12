import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoClient, ObjectId } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";

import { createObjectId } from "app-domain";
import { migrateMongoSchema } from "../adapters/mongodb/migrations.js";
import { createAuthenticationTokenAdapter } from "../auth/authentication-token-adapter.js";
import { createLocalApi } from "../local.js";

describe("local Trip API", () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  }, 120_000);

  afterAll(async () => {
    await replSet?.stop();
  });

  it("creates, lists, reads and edits a Trip without exposing it to another user", async () => {
    const databaseName = "travellier_trip_api_test";
    const client = new MongoClient(replSet.getUri());
    await client.connect();
    const database = client.db(databaseName);
    await migrateMongoSchema(database);
    const localApi = await createLocalApi({ MONGODB_URI: replSet.getUri(), MONGODB_DATABASE_NAME: databaseName, JWT_SECRET: "trip-api-secret" });
    await new Promise<void>((resolve) => localApi.app.listen(0, resolve));
    const baseUrl = `http://127.0.0.1:${(localApi.app.address() as AddressInfo).port}`;
    const tokens = createAuthenticationTokenAdapter({ jwtSecret: "trip-api-secret", accessTokenLifetimeMs: 900_000 });
    const actor = createObjectId(new ObjectId().toHexString());
    const outsider = createObjectId(new ObjectId().toHexString());
    if (!actor.ok || !outsider.ok) throw new Error("Invalid test id");
    const actorToken = await tokens.createAccessToken(actor.value);
    const outsiderToken = await tokens.createAccessToken(outsider.value);
    if (!actorToken.ok || !outsiderToken.ok) throw new Error("Unable to create test JWT");
    const headers = { authorization: `Bearer ${actorToken.value}`, "content-type": "application/json" };
    const outsiderHeaders = { authorization: `Bearer ${outsiderToken.value}`, "content-type": "application/json" };

    try {
      const created = await fetch(`${baseUrl}/trips`, { method: "POST", headers, body: JSON.stringify({ name: "Patagonia", primaryDestination: "Bariloche" }) });
      expect(created.status).toBe(201);
      const response = await created.json() as { trip: { id: string; inviteCode: string; primaryDestination: { name: string }; visibility: string } };
      expect(response.trip).toMatchObject({ name: "Patagonia", primaryDestination: { name: "Bariloche" }, visibility: "private" });
      expect(response.trip.inviteCode).toMatch(/^VIAJE-[A-Z0-9]+$/);
      expect(await database.collection("tripMembers").findOne({ tripId: new ObjectId(response.trip.id), userId: new ObjectId(actor.value) })).toMatchObject({ role: "admin" });

      const listed = await fetch(`${baseUrl}/trips`, { headers });
      expect(listed.status).toBe(200);
      expect(await listed.json()).toMatchObject({ trips: [{ id: response.trip.id }] });
      expect((await fetch(`${baseUrl}/trips`, { headers: outsiderHeaders })).status).toBe(200);
      expect(await (await fetch(`${baseUrl}/trips`, { headers: outsiderHeaders })).json()).toEqual({ trips: [] });
      expect((await fetch(`${baseUrl}/trips/${response.trip.id}`, { headers: outsiderHeaders })).status).toBe(404);
      expect((await fetch(`${baseUrl}/trips/${response.trip.id}/config`, { method: "PATCH", headers: outsiderHeaders, body: JSON.stringify({ visibility: "public" }) })).status).toBe(404);

      const updated = await fetch(`${baseUrl}/trips/${response.trip.id}/config`, { method: "PATCH", headers, body: JSON.stringify({ visibility: "public", expenseMode: "balance" }) });
      expect(updated.status).toBe(200);
      expect(await updated.json()).toMatchObject({ trip: { visibility: "public", expenseMode: "balance" } });
      const fetched = await fetch(`${baseUrl}/trips/${response.trip.id}`, { headers });
      expect(await fetched.json()).toMatchObject({ trip: { visibility: "public", expenseMode: "balance" } });

      const publicResponse = await fetch(`${baseUrl}/trips/${response.trip.id}`, { headers: outsiderHeaders });
      expect(publicResponse.status).toBe(200);
      expect(await publicResponse.json()).toEqual({
        trip: {
          id: response.trip.id,
          name: "Patagonia",
          description: null,
          visibility: "public",
          primaryDestination: { name: "Bariloche" },
        },
      });

      const another = await fetch(`${baseUrl}/trips`, { method: "POST", headers, body: JSON.stringify({ name: "Privado", primaryDestination: "Ushuaia" }) });
      expect(another.status).toBe(201);
      const privateTrip = (await another.json() as { trip: { id: string } }).trip;
      expect((await fetch(`${baseUrl}/trips/public`)).status).toBe(401);
      const publicList = await fetch(`${baseUrl}/trips/public`, { headers: outsiderHeaders });
      expect(publicList.status).toBe(200);
      expect(await publicList.json()).toEqual({ trips: [{
        id: response.trip.id,
        name: "Patagonia",
        description: null,
        visibility: "public",
        primaryDestination: { name: "Bariloche" },
      }] });

      const joinUrl = `${baseUrl}/trips/${response.trip.id}/join`;
      expect((await fetch(joinUrl, { method: "POST" })).status).toBe(401);
      expect((await fetch(`${baseUrl}/trips/not-an-id/join`, { method: "POST", headers: outsiderHeaders })).status).toBe(400);
      expect((await fetch(`${baseUrl}/trips/${privateTrip.id}/join`, { method: "POST", headers: outsiderHeaders })).status).toBe(404);
      const joined = await fetch(joinUrl, { method: "POST", headers: outsiderHeaders });
      expect(joined.status).toBe(200);
      expect(await joined.json()).toEqual({ tripId: response.trip.id, joined: true });
      const duplicate = await fetch(joinUrl, { method: "POST", headers: outsiderHeaders });
      expect(await duplicate.json()).toEqual({ tripId: response.trip.id, joined: false });
      const joinedTripList = await fetch(`${baseUrl}/trips`, { headers: outsiderHeaders });
      expect(joinedTripList.status).toBe(200);
      expect(await joinedTripList.json()).toMatchObject({ trips: [{ id: response.trip.id, name: "Patagonia" }] });
      expect(await database.collection("tripMembers").findOne({ tripId: new ObjectId(response.trip.id), userId: new ObjectId(outsider.value) }))
        .toMatchObject({ role: "participant" });
      expect(await database.collection("tripMembers").countDocuments({ tripId: new ObjectId(response.trip.id), userId: new ObjectId(outsider.value) })).toBe(1);

      expect((await fetch(`${baseUrl}/trips/${response.trip.id}/config`, { method: "PATCH", headers, body: JSON.stringify({ visibility: "private" }) })).status).toBe(200);
      expect(await (await fetch(`${baseUrl}/trips/public`, { headers: outsiderHeaders })).json()).toEqual({ trips: [] });
      expect((await fetch(joinUrl, { method: "POST", headers: outsiderHeaders })).status).toBe(404);
    } finally {
      await new Promise<void>((resolve, reject) => localApi.app.close((error) => error === undefined ? resolve() : reject(error)));
      await localApi.close();
      await client.close();
    }
  }, 15_000);

  it("restricts expense mode changes to admins, keeps payments and shares, and hides the Trip from outsiders", async () => {
    const databaseName = "travellier_trip_expense_mode_test";
    const client = new MongoClient(replSet.getUri());
    await client.connect();
    const database = client.db(databaseName);
    await migrateMongoSchema(database);
    const localApi = await createLocalApi({ MONGODB_URI: replSet.getUri(), MONGODB_DATABASE_NAME: databaseName, JWT_SECRET: "trip-mode-secret" });
    await new Promise<void>((resolve) => localApi.app.listen(0, resolve));
    const baseUrl = `http://127.0.0.1:${(localApi.app.address() as AddressInfo).port}`;
    const tokens = createAuthenticationTokenAdapter({ jwtSecret: "trip-mode-secret", accessTokenLifetimeMs: 900_000 });
    const headersFor = async (user: ObjectId) => {
      const id = createObjectId(user.toHexString());
      if (!id.ok) throw new Error("Invalid test id");
      const token = await tokens.createAccessToken(id.value);
      if (!token.ok) throw new Error("Unable to create test JWT");
      return { authorization: `Bearer ${token.value}`, "content-type": "application/json" };
    };
    const [owner, admin, participant, outsider] = [new ObjectId(), new ObjectId(), new ObjectId(), new ObjectId()];
    const [ownerH, adminH, participantH, outsiderH] = [await headersFor(owner), await headersFor(admin), await headersFor(participant), await headersFor(outsider)];
    const patch = (tripId: string, headers: Record<string, string>, body: object) =>
      fetch(`${baseUrl}/trips/${tripId}/config`, { method: "PATCH", headers, body: JSON.stringify(body) });

    try {
      const created = await fetch(`${baseUrl}/trips`, { method: "POST", headers: ownerH, body: JSON.stringify({ name: "Patagonia", primaryDestination: "Bariloche" }) });
      const { trip } = await created.json() as { trip: { id: string } };
      const tripOid = new ObjectId(trip.id);
      await database.collection("tripMembers").insertMany([
        { tripId: tripOid, userId: admin, role: "admin", joinedAt: new Date() },
        { tripId: tripOid, userId: participant, role: "participant", joinedAt: new Date() },
      ]);
      const stored = () => database.collection("trips").findOne({ _id: tripOid }, { projection: { expenseMode: 1, visibility: 1 } });

      expect((await patch(trip.id, ownerH, { expenseMode: "balance" })).status).toBe(200);
      expect(await stored()).toMatchObject({ expenseMode: "balance" });
      expect((await patch(trip.id, adminH, { expenseMode: "register" })).status).toBe(200);
      expect(await stored()).toMatchObject({ expenseMode: "register" });

      const before = await stored();
      const forbidden = await patch(trip.id, participantH, { expenseMode: "balance" });
      expect(forbidden.status).toBe(403);
      expect(await stored()).toEqual(before);
      expect((await patch(trip.id, participantH, { visibility: "public", expenseMode: "balance" })).status).toBe(403);
      expect(await stored()).toEqual(before);
      expect((await patch(trip.id, participantH, { visibility: "public" })).status).toBe(200);
      expect(await stored()).toMatchObject({ expenseMode: "register", visibility: "public" });
      expect((await patch(trip.id, outsiderH, { expenseMode: "balance" })).status).toBe(404);
      expect(await stored()).toMatchObject({ expenseMode: "register" });

      const ana = new ObjectId(), beto = new ObjectId();
      await database.collection("postExpenses").insertOne({
        tripId: tripOid, postId: new ObjectId(), totalAmount: 1000, currency: "ARS", breakdown: null, createdAt: new Date(),
        payments: [{ userId: ana, unit: "amount", value: 400 }, { userId: beto, unit: "percent", value: 60 }],
        shares: [{ userId: ana, unit: "amount", value: 100 }, { userId: beto, unit: "remainder", value: null }],
      });
      const rows = () => database.collection("postExpenses").findOne({ tripId: tripOid }, { projection: { payments: 1, shares: 1 } });
      const snapshot = await rows();
      expect((await patch(trip.id, adminH, { expenseMode: "balance" })).status).toBe(200);
      expect(await rows()).toEqual(snapshot);
      expect((await patch(trip.id, ownerH, { expenseMode: "register" })).status).toBe(200);
      expect(await rows()).toEqual(snapshot);
    } finally {
      await new Promise<void>((resolve, reject) => localApi.app.close((error) => error === undefined ? resolve() : reject(error)));
      await localApi.close();
      await client.close();
    }
  });
});
