import { jwtVerify } from "jose";
import { describe, expect, it } from "vitest";

import { createObjectId } from "app-domain";

import { createAuthenticationTokenAdapter } from "./authentication-token-adapter.js";

const jwtSecret = "test-jwt-signing-secret";
const now = new Date("2026-09-18T12:00:00.000Z");
const secret = new TextEncoder().encode(jwtSecret);

describe("authentication token adapter", () => {
  it("creates a signed expiring access token for its user", async () => {
    const userId = createObjectId("507f1f77bcf86cd799439011");

    if (!userId.ok) {
      throw new Error("Invalid test user id");
    }

    const tokens = createAuthenticationTokenAdapter({
      jwtSecret,
      accessTokenLifetimeMs: 900_000,
      now: () => now,
    });
    const accessToken = await tokens.createAccessToken(userId.value);

    expect(accessToken.ok).toBe(true);
    if (!accessToken.ok) {
      return;
    }

    const verified = await jwtVerify(accessToken.value, secret, {
      algorithms: ["HS256"],
      currentDate: now,
    });

    expect(verified.payload).toMatchObject({
      sub: userId.value,
      tokenType: "access",
      exp: 1_789_733_700,
    });
  });

  it("reads the expiration of a signed refresh token and stores only its hash", async () => {
    const tokens = createAuthenticationTokenAdapter({
      jwtSecret,
      accessTokenLifetimeMs: 900_000,
      now: () => now,
    });
    const expiresAt = new Date("2026-10-18T12:00:00.000Z");
    const refreshToken = await tokens.createRefreshToken(expiresAt);

    expect(refreshToken.ok).toBe(true);
    if (!refreshToken.ok) {
      return;
    }

    expect(await tokens.readRefreshTokenExpiration(refreshToken.value)).toEqual({
      ok: true,
      value: expiresAt,
    });
    const tokenHash = await tokens.hashRefreshToken(refreshToken.value);

    expect(tokenHash).toMatchObject({ ok: true });
    if (tokenHash.ok) {
      expect(tokenHash.value).not.toBe(refreshToken.value);
      expect(await tokens.hashRefreshToken(refreshToken.value)).toEqual(tokenHash);
    }
  });

  it("does not accept an access token as a refresh token", async () => {
    const userId = createObjectId("507f1f77bcf86cd799439011");

    if (!userId.ok) {
      throw new Error("Invalid test user id");
    }

    const tokens = createAuthenticationTokenAdapter({
      jwtSecret,
      accessTokenLifetimeMs: 900_000,
      now: () => now,
    });
    const accessToken = await tokens.createAccessToken(userId.value);

    if (!accessToken.ok) {
      throw new Error("Unable to create access token");
    }

    expect(await tokens.readRefreshTokenExpiration(accessToken.value)).toEqual({
      ok: true,
      value: undefined,
    });
  });
});
