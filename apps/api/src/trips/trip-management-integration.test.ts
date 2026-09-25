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
  });

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

      const updated = await fetch(`${baseUrl}/trips/${response.trip.id}/config`, { method: "PATCH", headers, body: JSON.stringify({ visibility: "public", votingEnabled: true, expenseMode: "balance" }) });
      expect(updated.status).toBe(200);
      expect(await updated.json()).toMatchObject({ trip: { visibility: "public", votingEnabled: true, expenseMode: "balance" } });
      const fetched = await fetch(`${baseUrl}/trips/${response.trip.id}`, { headers });
      expect(await fetched.json()).toMatchObject({ trip: { visibility: "public", votingEnabled: true, expenseMode: "balance" } });
    } finally {
      await new Promise<void>((resolve, reject) => localApi.app.close((error) => error === undefined ? resolve() : reject(error)));
      await localApi.close();
      await client.close();
    }
  }, 15_000);
});
