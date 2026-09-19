import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";

import { createMongoAuthenticationRepositories } from "./authentication-repositories.js";

describe("Mongo authentication repositories", () => {
  let server: MongoMemoryServer;
  let client: MongoClient;
  let database: Db;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    client = new MongoClient(server.getUri());
    await client.connect();
    database = client.db("travellier_auth_test");
  });

  afterAll(async () => {
    await client?.close();
    await server?.stop();
  });

  it("persists a password hash and consumes a refresh-token hash only once", async () => {
    const { users, sessions } = createMongoAuthenticationRepositories(database);
    const createdUser = await users.create({
      email: "nico@example.test",
      name: "Nico",
      passwordHash: "bcrypt-hash",
    });

    expect(createdUser).toMatchObject({ ok: true });
    if (!createdUser.ok) {
      return;
    }

    expect(await database.collection("users").findOne({ email: createdUser.value.email }))
      .toMatchObject({ passwordHash: "bcrypt-hash", avatarS3Key: null });
    await sessions.create({
      userId: createdUser.value.id,
      tokenHash: "refresh-token-hash",
      expiresAt: new Date("2026-10-18T12:00:00.000Z"),
    });

    const consumed = await sessions.consume("refresh-token-hash");

    expect(consumed).toMatchObject({
      ok: true,
      value: { userId: createdUser.value.id, tokenHash: "refresh-token-hash" },
    });
    expect(await sessions.consume("refresh-token-hash")).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it("returns an already-registered error for Mongo duplicate keys", async () => {
    await database.collection("users").createIndex({ email: 1 }, { unique: true });
    const { users } = createMongoAuthenticationRepositories(database);
    const firstUser = await users.create({
      email: "duplicate@example.test",
      name: "Nico",
      passwordHash: "bcrypt-hash",
    });

    expect(firstUser.ok).toBe(true);
    expect(
      await users.create({
        email: "duplicate@example.test",
        name: "Other",
        passwordHash: "bcrypt-hash",
      }),
    ).toMatchObject({
      ok: false,
      error: { tag: "EmailAlreadyRegisteredError" },
    });
  });
});
