import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";

import { createAuthenticationApi } from "./authentication-api.js";
import { createAuthenticationTokenAdapter } from "./authentication-token-adapter.js";
import { createMongoAuthenticationRepositories } from "../adapters/mongodb/authentication-repositories.js";

const jwtSecret = "test-jwt-signing-secret";

describe("authentication API", () => {
  let server: MongoMemoryServer;
  let client: MongoClient;
  let database: Db;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    client = new MongoClient(server.getUri());
    await client.connect();
    database = client.db("travellier_auth_api_test");
    await database.collection("users").createIndex({ email: 1 }, { unique: true });
  });

  afterAll(async () => {
    await client?.close();
    await server?.stop();
  });

  it("registers, rotates, and revokes a session without persisting a raw refresh token", async () => {
    const auth = createAuthenticationApi({ database, jwtSecret });
    const registered = await auth.register({
      email: "nico@example.test",
      name: "Nico",
      password: "secret-pass",
    });

    expect(registered).toEqual({
      ok: true,
      value: {
        id: expect.any(String),
        email: "nico@example.test",
        name: "Nico",
      },
    });
    expect(JSON.stringify(registered)).not.toContain("passwordHash");

    const login = await auth.login({
      email: "nico@example.test",
      password: "secret-pass",
    });

    expect(login).toMatchObject({
      ok: true,
      value: { accessToken: expect.any(String), refreshToken: expect.any(String) },
    });
    if (!login.ok) {
      return;
    }

    expect(await database.collection("refreshTokens").findOne({})).toMatchObject({
      token: expect.not.stringContaining(login.value.refreshToken),
    });

    const refreshed = await auth.refresh({ refreshToken: login.value.refreshToken });

    expect(refreshed).toMatchObject({
      ok: true,
      value: { accessToken: expect.any(String), refreshToken: expect.any(String) },
    });
    expect(await auth.refresh({ refreshToken: login.value.refreshToken })).toMatchObject({
      ok: false,
      error: { tag: "InvalidSessionError" },
    });
    if (!refreshed.ok) {
      return;
    }

    expect(await auth.logout({ refreshToken: refreshed.value.refreshToken })).toEqual({
      ok: true,
      value: undefined,
    });
    const revoked = await auth.refresh({ refreshToken: refreshed.value.refreshToken });

    expect(revoked).toMatchObject({
      ok: false,
      error: { tag: "InvalidSessionError" },
    });
    expect(JSON.stringify(revoked)).not.toContain("accessToken");
  });

  it("does not issue an access token for an expired refresh token", async () => {
    const auth = createAuthenticationApi({ database, jwtSecret });
    const registered = await auth.register({
      email: "expired@example.test",
      name: "Expired",
      password: "secret-pass",
    });

    if (!registered.ok) {
      throw new Error("Unable to create test user");
    }

    const tokens = createAuthenticationTokenAdapter({
      jwtSecret,
      accessTokenLifetimeMs: 900_000,
    });
    const refreshToken = await tokens.createRefreshToken(
      new Date("2020-01-01T00:00:00.000Z"),
    );

    if (!refreshToken.ok) {
      throw new Error("Unable to create expired refresh token");
    }

    const tokenHash = await tokens.hashRefreshToken(refreshToken.value);

    if (!tokenHash.ok) {
      throw new Error("Unable to hash expired refresh token");
    }

    const { sessions } = createMongoAuthenticationRepositories(database);
    await sessions.create({
      userId: registered.value.id,
      tokenHash: tokenHash.value,
      expiresAt: new Date("2020-01-01T00:00:00.000Z"),
    });
    const result = await auth.refresh({ refreshToken: refreshToken.value });

    expect(result).toMatchObject({
      ok: false,
      error: { tag: "SessionExpiredError" },
    });
    expect(JSON.stringify(result)).not.toContain("accessToken");
  });
});
