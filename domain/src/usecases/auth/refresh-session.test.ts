import { describe, expect, it, vi } from "vitest";

import * as domain from "../../index.js";

type AuthenticationDomain = typeof domain & {
  refreshSession: {
    execute: (
      dependencies: {
        sessions: {
          consume: (tokenHash: string) => Promise<unknown>;
          create: (session: unknown) => Promise<unknown>;
        };
        tokens: {
          hashRefreshToken: (token: string) => Promise<unknown>;
          readRefreshTokenExpiration: (token: string) => Promise<unknown>;
          createRefreshToken: (expiresAt: Date) => Promise<unknown>;
          createAccessToken: (userId: string) => Promise<unknown>;
        };
        now: () => Date;
        refreshTokenLifetimeMs: number;
      },
      payload: { refreshToken: string },
    ) => Promise<unknown>;
  };
};

const authDomain = domain as AuthenticationDomain;
const session = {
  id: "507f1f77bcf86cd799439012",
  userId: "507f1f77bcf86cd799439011",
  tokenHash: "old-refresh-token-hash",
  expiresAt: new Date("2026-09-19T12:00:00.000Z"),
  createdAt: new Date("2026-09-18T10:00:00.000Z"),
};

describe("refreshSession", () => {
  it("rotates a valid session and persists only the replacement token hash", async () => {
    const consume = vi.fn().mockResolvedValue({ ok: true, value: session });
    const create = vi.fn().mockResolvedValue({ ok: true, value: undefined });
    const hashRefreshToken = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: "old-refresh-token-hash" })
      .mockResolvedValueOnce({ ok: true, value: "new-refresh-token-hash" });
    const readRefreshTokenExpiration = vi
      .fn()
      .mockResolvedValue({ ok: true, value: new Date("2026-09-19T12:00:00.000Z") });
    const createRefreshToken = vi
      .fn()
      .mockResolvedValue({ ok: true, value: "new-refresh-token" });
    const createAccessToken = vi
      .fn()
      .mockResolvedValue({ ok: true, value: "new-access-token" });

    expect("refreshSession" in domain).toBe(true);

    const result = await authDomain.refreshSession.execute(
      {
        sessions: { consume, create },
        tokens: {
          hashRefreshToken,
          readRefreshTokenExpiration,
          createRefreshToken,
          createAccessToken,
        },
        now: () => new Date("2026-09-18T12:00:00.000Z"),
        refreshTokenLifetimeMs: 86_400_000,
      },
      { refreshToken: "old-refresh-token" },
    );

    expect(consume).toHaveBeenCalledWith("old-refresh-token-hash");
    expect(createRefreshToken).toHaveBeenCalledWith(
      new Date("2026-09-19T12:00:00.000Z"),
    );
    expect(create).toHaveBeenCalledWith({
      userId: session.userId,
      tokenHash: "new-refresh-token-hash",
      expiresAt: new Date("2026-09-19T12:00:00.000Z"),
    });
    expect(result).toEqual({
      ok: true,
      value: { accessToken: "new-access-token", refreshToken: "new-refresh-token" },
    });
  });

  it("rejects a refresh token that has no active session", async () => {
    const consume = vi.fn().mockResolvedValue({ ok: true, value: undefined });
    const create = vi.fn();
    const hashRefreshToken = vi
      .fn()
      .mockResolvedValue({ ok: true, value: "unknown-refresh-token-hash" });
    const readRefreshTokenExpiration = vi
      .fn()
      .mockResolvedValue({ ok: true, value: new Date("2026-09-19T12:00:00.000Z") });
    const createRefreshToken = vi.fn();
    const createAccessToken = vi.fn();

    const result = await authDomain.refreshSession.execute(
      {
        sessions: { consume, create },
        tokens: {
          hashRefreshToken,
          readRefreshTokenExpiration,
          createRefreshToken,
          createAccessToken,
        },
        now: () => new Date("2026-09-18T12:00:00.000Z"),
        refreshTokenLifetimeMs: 86_400_000,
      },
      { refreshToken: "unknown-refresh-token" },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { tag: "InvalidSessionError" },
    });
    expect(create).not.toHaveBeenCalled();
    expect(createAccessToken).not.toHaveBeenCalled();
  });

  it("rejects a refresh token whose expiration cannot be verified", async () => {
    const consume = vi.fn();
    const create = vi.fn();
    const hashRefreshToken = vi.fn();
    const readRefreshTokenExpiration = vi
      .fn()
      .mockResolvedValue({ ok: true, value: undefined });
    const createRefreshToken = vi.fn();
    const createAccessToken = vi.fn();

    const result = await authDomain.refreshSession.execute(
      {
        sessions: { consume, create },
        tokens: {
          hashRefreshToken,
          readRefreshTokenExpiration,
          createRefreshToken,
          createAccessToken,
        },
        now: () => new Date("2026-09-18T12:00:00.000Z"),
        refreshTokenLifetimeMs: 86_400_000,
      },
      { refreshToken: "malformed-refresh-token" },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { tag: "InvalidSessionError" },
    });
    expect(hashRefreshToken).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
  });

  it("returns a session-expired error instead of invalid credentials for an expired session", async () => {
    const expiredSession = {
      ...session,
      expiresAt: new Date("2026-09-18T11:59:59.999Z"),
    };
    const consume = vi
      .fn()
      .mockResolvedValue({ ok: true, value: expiredSession });
    const create = vi.fn();
    const hashRefreshToken = vi
      .fn()
      .mockResolvedValue({ ok: true, value: "expired-refresh-token-hash" });
    const readRefreshTokenExpiration = vi
      .fn()
      .mockResolvedValue({ ok: true, value: new Date("2026-09-19T12:00:00.000Z") });
    const createRefreshToken = vi.fn();
    const createAccessToken = vi.fn();

    const result = await authDomain.refreshSession.execute(
      {
        sessions: { consume, create },
        tokens: {
          hashRefreshToken,
          readRefreshTokenExpiration,
          createRefreshToken,
          createAccessToken,
        },
        now: () => new Date("2026-09-18T12:00:00.000Z"),
        refreshTokenLifetimeMs: 86_400_000,
      },
      { refreshToken: "expired-refresh-token" },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { tag: "SessionExpiredError" },
    });
    expect(consume).toHaveBeenCalledWith("expired-refresh-token-hash");
    expect(create).not.toHaveBeenCalled();
    expect(createAccessToken).not.toHaveBeenCalled();
  });

  it("allows only one concurrent refresh to consume and rotate a session", async () => {
    const consume = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: session })
      .mockResolvedValueOnce({ ok: true, value: undefined });
    const create = vi.fn().mockResolvedValue({ ok: true, value: undefined });
    const hashRefreshToken = vi.fn().mockImplementation((token: string) =>
      Promise.resolve({
        ok: true,
        value:
          token === "old-refresh-token"
            ? "old-refresh-token-hash"
            : "new-refresh-token-hash",
      }),
    );
    const createRefreshToken = vi
      .fn()
      .mockResolvedValue({ ok: true, value: "new-refresh-token" });
    const createAccessToken = vi
      .fn()
      .mockResolvedValue({ ok: true, value: "new-access-token" });
    const readRefreshTokenExpiration = vi
      .fn()
      .mockResolvedValue({ ok: true, value: new Date("2026-09-19T12:00:00.000Z") });
    const dependencies = {
      sessions: { consume, create },
      tokens: {
        hashRefreshToken,
        readRefreshTokenExpiration,
        createRefreshToken,
        createAccessToken,
      },
      now: () => new Date("2026-09-18T12:00:00.000Z"),
      refreshTokenLifetimeMs: 86_400_000,
    };

    const results = await Promise.all([
      authDomain.refreshSession.execute(dependencies, {
        refreshToken: "old-refresh-token",
      }),
      authDomain.refreshSession.execute(dependencies, {
        refreshToken: "old-refresh-token",
      }),
    ]);

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ok: true }),
        expect.objectContaining({
          ok: false,
          error: expect.objectContaining({ tag: "InvalidSessionError" }),
        }),
      ]),
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(createAccessToken).toHaveBeenCalledTimes(1);
  });

  it("returns session expired when MongoDB TTL already removed the session", async () => {
    const consume = vi.fn().mockResolvedValue({ ok: true, value: undefined });
    const create = vi.fn();
    const hashRefreshToken = vi.fn();
    const readRefreshTokenExpiration = vi
      .fn()
      .mockResolvedValue({ ok: true, value: new Date("2026-09-18T11:59:59.999Z") });
    const createRefreshToken = vi.fn();
    const createAccessToken = vi.fn();

    const result = await authDomain.refreshSession.execute(
      {
        sessions: { consume, create },
        tokens: {
          hashRefreshToken,
          readRefreshTokenExpiration,
          createRefreshToken,
          createAccessToken,
        },
        now: () => new Date("2026-09-18T12:00:00.000Z"),
        refreshTokenLifetimeMs: 86_400_000,
      },
      { refreshToken: "expired-and-deleted-refresh-token" },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { tag: "SessionExpiredError" },
    });
    expect(readRefreshTokenExpiration).toHaveBeenCalledWith(
      "expired-and-deleted-refresh-token",
    );
    expect(consume).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(createAccessToken).not.toHaveBeenCalled();
  });
});
