import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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

  it("validates a signed email token only while its user exists", async () => {
    const auth = createAuthenticationApi({ database, jwtSecret }) as ReturnType<typeof createAuthenticationApi> & {
      verifyEmailToken?: (payload: { token: string }) => Promise<unknown>;
    };
    const registered = await auth.register({
      email: "verify@example.test",
      name: "Verify",
      password: "secret-pass",
    });
    if (!registered.ok) throw new Error("Unable to create verification test user");

    const tokens = createAuthenticationTokenAdapter({
      jwtSecret,
      accessTokenLifetimeMs: 900_000,
    });
    const token = await tokens.createEmailVerificationToken(
      registered.value.id,
      new Date(Date.now() + 60_000),
    );
    if (!token.ok) throw new Error("Unable to create verification test token");

    expect(await auth.verifyEmailToken?.({ token: token.value })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await auth.verifyEmailToken?.({ token: "invalid-token" })).toMatchObject({
      ok: false,
      error: { tag: "InvalidEmailVerificationTokenError" },
    });
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

  it("reads and updates the authenticated user's public profile", async () => {
    const auth = createAuthenticationApi({ database, jwtSecret });
    const registered = await auth.register({
      email: "profile@example.test",
      name: "Profile",
      password: "secret-pass",
    });

    if (!registered.ok) {
      throw new Error("Unable to create profile test user");
    }

    await expect(
      auth.getProfile({ authenticatedUserId: registered.value.id }),
    ).resolves.toEqual({
      ok: true,
      value: { name: "Profile", email: "profile@example.test", avatar: null },
    });

    await expect(
      auth.updateProfile({
        authenticatedUserId: registered.value.id,
        name: "Updated profile",
        avatar: `avatars/${registered.value.id}/profile.jpg`,
      }),
    ).resolves.toEqual({
      ok: true,
      value: {
        name: "Updated profile",
        email: "profile@example.test",
        avatar: `avatars/${registered.value.id}/profile.jpg`,
      },
    });
  });

  it("signs an avatar upload and its read URL for the authenticated profile", async () => {
    const storage = {
      createUploadTarget: vi.fn().mockResolvedValue({ ok: true, value: {
        uploadUrl: "https://s3.example.test/upload", headers: { "content-type": "image/jpeg" }, expiresAt: new Date(),
      } }),
      createDownloadTarget: vi.fn().mockResolvedValue({ ok: true, value: { downloadUrl: "https://s3.example.test/view" } }),
    };
    const auth = createAuthenticationApi({ database, jwtSecret, storage });
    const registered = await auth.register({ email: "avatar@example.test", name: "Avatar", password: "secret-pass" });
    if (!registered.ok) throw new Error("Unable to register avatar test user");

    const target = await auth.createAvatarUpload({ authenticatedUserId: registered.value.id, contentType: "image/jpeg" });
    expect(target).toMatchObject({ ok: true, value: { uploadUrl: "https://s3.example.test/upload" } });
    if (!target.ok) return;
    expect(target.value.avatar).toMatch(new RegExp(`^avatars/${registered.value.id}/.+\\.jpg$`));
    await auth.updateProfile({ authenticatedUserId: registered.value.id, avatar: target.value.avatar });
    const view = await auth.getAvatarUrl({ authenticatedUserId: registered.value.id });

    expect(storage.createDownloadTarget).toHaveBeenCalledWith({ objectKey: target.value.avatar, expiresInSeconds: 300 });
    expect(view).toEqual({ ok: true, value: { url: "https://s3.example.test/view" } });
  });
});
