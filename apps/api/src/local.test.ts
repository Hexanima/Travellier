import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient, ObjectId } from "mongodb";
import { createObjectId } from "app-domain";

import { createLocalApi } from "./local.js";
import { createAuthenticationTokenAdapter } from "./auth/authentication-token-adapter.js";

describe("local API entrypoint", () => {
  let mongo: MongoMemoryReplSet;

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  });

  afterAll(async () => {
    await mongo?.stop();
  });

  it("serves authentication endpoints with local MongoDB and JWT configuration", async () => {
    const localApi = await createLocalApi({
      MONGODB_URI: mongo.getUri(),
      MONGODB_DATABASE_NAME: "travellier_local_test",
      JWT_SECRET: "local-jwt-signing-secret",
    });
    await new Promise<void>((resolve) => localApi.app.listen(0, resolve));
    const { port } = localApi.app.address() as AddressInfo;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "local@example.test",
          name: "Local",
          password: "secret-pass",
        }),
      });

      expect(response.status).toBe(201);
      const registration = await response.json() as { user: { id: string; email: string; name: string } };
      expect(registration).toMatchObject({
        user: { email: "local@example.test", name: "Local" },
      });

      const tokens = createAuthenticationTokenAdapter({
        jwtSecret: "local-jwt-signing-secret",
        accessTokenLifetimeMs: 900_000,
      });
      const userId = createObjectId(registration.user.id);
      if (!userId.ok) throw new Error("Invalid registered user id");
      const token = await tokens.createEmailVerificationToken(
        userId.value,
        new Date(Date.now() + 60_000),
      );
      if (!token.ok) throw new Error("Unable to create verification test token");

      const verification = await fetch(`http://127.0.0.1:${port}/auth/verify/${token.value}`);
      expect(verification.status).toBe(200);
      expect(verification.headers.get("content-type")).toContain("text/html");
      expect(await verification.text()).toContain(`com.travellier.app://verify/${token.value}`);

      const invalidVerification = await fetch(`http://127.0.0.1:${port}/auth/verify/invalid-token`);
      expect(invalidVerification.status).toBe(400);
      expect(await invalidVerification.text()).not.toContain("invalid-token");

      const privateRequest = await fetch(`http://127.0.0.1:${port}/profile`, {
        headers: { authorization: `Bearer ${token.value}` },
      });
      expect(privateRequest.status).toBe(401);

      const login = await fetch(`http://127.0.0.1:${port}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "local@example.test",
          password: "secret-pass",
        }),
      });
      const session = await login.json() as { accessToken: string };

      const profile = await fetch(`http://127.0.0.1:${port}/profile`, {
        headers: { authorization: `Bearer ${session.accessToken}` },
      });

      expect(profile.status).toBe(200);
      await expect(profile.json()).resolves.toEqual({
        profile: { name: "Local", email: "local@example.test", avatar: null },
      });

      // No S3_BUCKET_NAME: the API still starts without AWS and photo endpoints report the missing storage.
      const photoUploads = await fetch(`http://127.0.0.1:${port}/trips/${new ObjectId()}/photo-uploads`, {
        method: "POST",
        headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ files: [{ contentType: "image/jpeg", sizeBytes: 1 }] }),
      });
      expect(photoUploads.status).toBe(500);
    } finally {
      await new Promise<void>((resolve, reject) =>
        localApi.app.close((error) =>
          error === undefined ? resolve() : reject(error),
        ),
      );
      await localApi.close();
    }
  });

  it("joins an invited trip through the authenticated local API", async () => {
    const databaseName = "travellier_join_test";
    const client = new MongoClient(mongo.getUri());
    await client.connect();
    const database = client.db(databaseName);
    const tripId = new ObjectId();
    await database.collection("trips").insertOne({ _id: tripId, inviteCode: "VIAJE-X7K2" });
    await database.collection("tripMembers").createIndex({ tripId: 1, userId: 1 }, { unique: true });
    const localApi = await createLocalApi({
      MONGODB_URI: mongo.getUri(), MONGODB_DATABASE_NAME: databaseName, JWT_SECRET: "local-jwt-signing-secret",
    });
    await new Promise<void>((resolve) => localApi.app.listen(0, resolve));
    const { port } = localApi.app.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const registration = await fetch(`${baseUrl}/auth/register`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "join@example.test", name: "Joiner", password: "secret-pass" }),
      });
      expect(registration.status).toBe(201);
      const { user } = await registration.json() as { user: { id: string } };
      const login = await fetch(`${baseUrl}/auth/login`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "join@example.test", password: "secret-pass" }),
      });
      const { accessToken } = await login.json() as { accessToken: string };
      const join = () => fetch(`${baseUrl}/trips/join`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ code: "VIAJE-X7K2" }),
      });

      const first = await join();
      expect(first.status).toBe(200);
      await expect(first.json()).resolves.toEqual({ tripId: tripId.toHexString(), joined: true });
      const second = await join();
      await expect(second.json()).resolves.toEqual({ tripId: tripId.toHexString(), joined: false });
      expect(await database.collection("tripMembers").countDocuments({ tripId, userId: new ObjectId(user.id) })).toBe(1);
    } finally {
      await new Promise<void>((resolve, reject) => localApi.app.close((error) => error === undefined ? resolve() : reject(error)));
      await localApi.close();
      await client.close();
    }
  });
  it("registers and revokes a push device through the authenticated local API (T89)", async () => {
    const databaseName = "travellier_push_local_test";
    const client = new MongoClient(mongo.getUri());
    await client.connect();
    const localApi = await createLocalApi({ MONGODB_URI: mongo.getUri(), MONGODB_DATABASE_NAME: databaseName, JWT_SECRET: "local-jwt-signing-secret" });
    await new Promise<void>((resolve) => localApi.app.listen(0, resolve));
    const { port } = localApi.app.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;
    const json = { "content-type": "application/json" };
    try {
      await fetch(`${baseUrl}/auth/register`, { method: "POST", headers: json, body: JSON.stringify({ email: "push@example.test", name: "Push", password: "secret-pass" }) });
      const login = await fetch(`${baseUrl}/auth/login`, { method: "POST", headers: json, body: JSON.stringify({ email: "push@example.test", password: "secret-pass" }) });
      const { accessToken } = await login.json() as { accessToken: string };
      const headers = { ...json, authorization: `Bearer ${accessToken}` };
      const body = JSON.stringify({ provider: "fcm", platform: "android", token: "local-token-0123456789-wxyz" });
      expect((await fetch(`${baseUrl}/push-devices`, { method: "PUT", headers: json, body })).status).toBe(401);
      const registered = await fetch(`${baseUrl}/push-devices`, { method: "PUT", headers, body });
      expect(registered.status).toBe(200);
      expect(await registered.json()).toMatchObject({ device: { provider: "fcm", platform: "android", tokenHint: "****wxyz" } });
      expect(await client.db(databaseName).collection("pushDevices").countDocuments()).toBe(1);
      const revoked = await fetch(`${baseUrl}/push-devices/revoke`, { method: "POST", headers, body: JSON.stringify({ provider: "fcm", token: "local-token-0123456789-wxyz" }) });
      expect(revoked.status).toBe(204);
      expect(await client.db(databaseName).collection("pushDevices").countDocuments()).toBe(0);
    } finally {
      await new Promise<void>((resolve, reject) => localApi.app.close((error) => error === undefined ? resolve() : reject(error)));
      await localApi.close();
      await client.close();
    }
  });
});
