import { describe, expect, it, vi } from "vitest";

import * as domain from "../../index.js";

type AuthenticationDomain = typeof domain & {
  refreshSession: {
    execute: (
      dependencies: {
        sessions: {
          findByTokenHash: (tokenHash: string) => Promise<unknown>;
          delete: (id: string) => Promise<unknown>;
          create: (session: unknown) => Promise<unknown>;
        };
        tokens: {
          hashRefreshToken: (token: string) => Promise<unknown>;
          createRefreshToken: () => Promise<unknown>;
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
    const findByTokenHash = vi.fn().mockResolvedValue({ ok: true, value: session });
    const deleteSession = vi.fn().mockResolvedValue({ ok: true, value: undefined });
    const create = vi.fn().mockResolvedValue({ ok: true, value: undefined });
    const hashRefreshToken = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: "old-refresh-token-hash" })
      .mockResolvedValueOnce({ ok: true, value: "new-refresh-token-hash" });
    const createRefreshToken = vi
      .fn()
      .mockResolvedValue({ ok: true, value: "new-refresh-token" });
    const createAccessToken = vi
      .fn()
      .mockResolvedValue({ ok: true, value: "new-access-token" });

    expect("refreshSession" in domain).toBe(true);

    const result = await authDomain.refreshSession.execute(
      {
        sessions: { findByTokenHash, delete: deleteSession, create },
        tokens: { hashRefreshToken, createRefreshToken, createAccessToken },
        now: () => new Date("2026-09-18T12:00:00.000Z"),
        refreshTokenLifetimeMs: 86_400_000,
      },
      { refreshToken: "old-refresh-token" },
    );

    expect(deleteSession).toHaveBeenCalledWith(session.id);
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
    const findByTokenHash = vi.fn().mockResolvedValue({ ok: true, value: undefined });
    const deleteSession = vi.fn();
    const create = vi.fn();
    const hashRefreshToken = vi
      .fn()
      .mockResolvedValue({ ok: true, value: "unknown-refresh-token-hash" });
    const createRefreshToken = vi.fn();
    const createAccessToken = vi.fn();

    const result = await authDomain.refreshSession.execute(
      {
        sessions: { findByTokenHash, delete: deleteSession, create },
        tokens: { hashRefreshToken, createRefreshToken, createAccessToken },
        now: () => new Date("2026-09-18T12:00:00.000Z"),
        refreshTokenLifetimeMs: 86_400_000,
      },
      { refreshToken: "unknown-refresh-token" },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { tag: "InvalidSessionError" },
    });
    expect(deleteSession).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(createAccessToken).not.toHaveBeenCalled();
  });

  it("returns a session-expired error instead of invalid credentials for an expired session", async () => {
    const expiredSession = {
      ...session,
      expiresAt: new Date("2026-09-18T11:59:59.999Z"),
    };
    const findByTokenHash = vi
      .fn()
      .mockResolvedValue({ ok: true, value: expiredSession });
    const deleteSession = vi.fn().mockResolvedValue({ ok: true, value: undefined });
    const create = vi.fn();
    const hashRefreshToken = vi
      .fn()
      .mockResolvedValue({ ok: true, value: "expired-refresh-token-hash" });
    const createRefreshToken = vi.fn();
    const createAccessToken = vi.fn();

    const result = await authDomain.refreshSession.execute(
      {
        sessions: { findByTokenHash, delete: deleteSession, create },
        tokens: { hashRefreshToken, createRefreshToken, createAccessToken },
        now: () => new Date("2026-09-18T12:00:00.000Z"),
        refreshTokenLifetimeMs: 86_400_000,
      },
      { refreshToken: "expired-refresh-token" },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { tag: "SessionExpiredError" },
    });
    expect(deleteSession).toHaveBeenCalledWith(expiredSession.id);
    expect(create).not.toHaveBeenCalled();
    expect(createAccessToken).not.toHaveBeenCalled();
  });
});
