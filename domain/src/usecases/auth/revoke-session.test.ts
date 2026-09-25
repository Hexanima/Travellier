import { describe, expect, it, vi } from "vitest";

import * as domain from "../../index.js";

type AuthenticationDomain = typeof domain & {
  revokeSession: {
    execute: (
      dependencies: {
        sessions: {
          consume: (tokenHash: string) => Promise<unknown>;
        };
        tokens: { hashRefreshToken: (token: string) => Promise<unknown> };
      },
      payload: { refreshToken: string },
    ) => Promise<unknown>;
  };
};

const authDomain = domain as AuthenticationDomain;

describe("revokeSession", () => {
  it("invalidates the session selected by the refresh-token hash", async () => {
    const hashRefreshToken = vi
      .fn()
      .mockResolvedValue({ ok: true, value: "refresh-token-hash" });
    const consume = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        id: "507f1f77bcf86cd799439012",
        userId: "507f1f77bcf86cd799439011",
        tokenHash: "refresh-token-hash",
        expiresAt: new Date("2026-09-19T12:00:00.000Z"),
        createdAt: new Date("2026-09-18T10:00:00.000Z"),
      },
    });

    expect("revokeSession" in domain).toBe(true);

    const result = await authDomain.revokeSession.execute(
      {
        sessions: { consume },
        tokens: { hashRefreshToken },
      },
      { refreshToken: "refresh-token" },
    );

    expect(consume).toHaveBeenCalledWith("refresh-token-hash");
    expect(result).toEqual({ ok: true, value: undefined });
  });

  it("does not report a successful logout for an unknown or revoked session", async () => {
    const hashRefreshToken = vi
      .fn()
      .mockResolvedValue({ ok: true, value: "unknown-refresh-token-hash" });
    const consume = vi.fn().mockResolvedValue({ ok: true, value: undefined });

    const result = await authDomain.revokeSession.execute(
      {
        sessions: { consume },
        tokens: { hashRefreshToken },
      },
      { refreshToken: "unknown-refresh-token" },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { tag: "InvalidSessionError" },
    });
  });
});
