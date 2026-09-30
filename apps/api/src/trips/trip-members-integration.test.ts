import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoClient, ObjectId } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";

import { createObjectId } from "app-domain";
import { migrateMongoSchema } from "../adapters/mongodb/migrations.js";
import { createAuthenticationTokenAdapter } from "../auth/authentication-token-adapter.js";
import { createLocalApi } from "../local.js";

describe("local Trip member API", () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  }, 120_000);

  afterAll(async () => {
    await replSet?.stop();
  });

  it("lists only members, joins once and lets only an admin expel a participant", async () => {
    const databaseName = "travellier_member_api_test";
    const client = new MongoClient(replSet.getUri());
    await client.connect();
    const database = client.db(databaseName);
    await migrateMongoSchema(database);
    const adminId = new ObjectId();
    const participantId = new ObjectId();
    const outsiderId = new ObjectId();
    await database.collection("users").insertMany([
      { _id: adminId, name: "Admin", email: "admin@example.com", passwordHash: "secret" },
      { _id: participantId, name: "Participante", email: "participant@example.com", passwordHash: "secret" },
      { _id: outsiderId, name: "Ajeno", email: "outsider@example.com", passwordHash: "secret" },
    ]);
    const localApi = await createLocalApi({ MONGODB_URI: replSet.getUri(), MONGODB_DATABASE_NAME: databaseName, JWT_SECRET: "member-api-secret" });
    await new Promise<void>((resolve) => localApi.app.listen(0, resolve));
    const baseUrl = `http://127.0.0.1:${(localApi.app.address() as AddressInfo).port}`;
    const tokens = createAuthenticationTokenAdapter({ jwtSecret: "member-api-secret", accessTokenLifetimeMs: 900_000 });
    const tokenFor = async (value: ObjectId) => {
      const id = createObjectId(value.toHexString());
      if (!id.ok) throw id.error;
      const token = await tokens.createAccessToken(id.value);
      if (!token.ok) throw token.error;
      return { authorization: `Bearer ${token.value}`, "content-type": "application/json" };
    };
    const adminHeaders = await tokenFor(adminId);
    const participantHeaders = await tokenFor(participantId);
    const outsiderHeaders = await tokenFor(outsiderId);

    try {
      const created = await fetch(`${baseUrl}/trips`, {
        method: "POST", headers: adminHeaders,
        body: JSON.stringify({ name: "Patagonia", primaryDestination: "Bariloche" }),
      });
      expect(created.status).toBe(201);
      const { trip } = await created.json() as { trip: { id: string; inviteCode: string } };
      const memberUrl = `${baseUrl}/trips/${trip.id}/members`;

      expect((await fetch(memberUrl)).status).toBe(401);
      expect((await fetch(memberUrl, { headers: outsiderHeaders })).status).toBe(404);
      const publicTrip = await fetch(`${baseUrl}/trips/${trip.id}/config`, {
        method: "PATCH", headers: adminHeaders, body: JSON.stringify({ visibility: "public" }),
      });
      expect(publicTrip.status).toBe(200);
      expect((await fetch(memberUrl, { headers: outsiderHeaders })).status).toBe(404);
      const joined = await fetch(`${baseUrl}/trips/join`, {
        method: "POST", headers: participantHeaders, body: JSON.stringify({ code: trip.inviteCode }),
      });
      expect(await joined.json()).toEqual({ tripId: trip.id, joined: true });
      const duplicate = await fetch(`${baseUrl}/trips/join`, {
        method: "POST", headers: participantHeaders, body: JSON.stringify({ code: trip.inviteCode }),
      });
      expect(await duplicate.json()).toEqual({ tripId: trip.id, joined: false });
      expect(await database.collection("tripMembers").countDocuments({ tripId: new ObjectId(trip.id), userId: participantId })).toBe(1);

      const listed = await fetch(memberUrl, { headers: participantHeaders });
      expect(listed.status).toBe(200);
      const listedBody = await listed.json() as { members: Array<Record<string, unknown>> };
      expect(listedBody.members).toHaveLength(2);
      expect(listedBody.members).toEqual(expect.arrayContaining([
        expect.objectContaining({ userId: adminId.toHexString(), name: "Admin", role: "admin" }),
        expect.objectContaining({ userId: participantId.toHexString(), name: "Participante", role: "participant" }),
      ]));
      expect(Object.keys(listedBody.members[0] ?? {}).sort()).toEqual(["id", "joinedAt", "name", "role", "userId"]);

      const expelUrl = `${memberUrl}/${participantId.toHexString()}`;
      expect((await fetch(expelUrl, { method: "DELETE", headers: participantHeaders })).status).toBe(403);
      expect((await fetch(expelUrl, { method: "DELETE", headers: outsiderHeaders })).status).toBe(403);
      expect((await fetch(`${memberUrl}/${adminId.toHexString()}`, { method: "DELETE", headers: adminHeaders })).status).toBe(403);
      expect((await fetch(expelUrl, { method: "DELETE", headers: adminHeaders })).status).toBe(204);
      expect((await fetch(expelUrl, { method: "DELETE", headers: adminHeaders })).status).toBe(404);
      expect((await fetch(memberUrl, { headers: participantHeaders })).status).toBe(404);
      expect(await database.collection("tripMembers").countDocuments({ tripId: new ObjectId(trip.id), userId: participantId })).toBe(0);
    } finally {
      await new Promise<void>((resolve, reject) => localApi.app.close((error) => error === undefined ? resolve() : reject(error)));
      await localApi.close();
      await client.close();
    }
  }, 20_000);
});
