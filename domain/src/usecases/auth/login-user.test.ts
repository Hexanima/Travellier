import { describe, expect, it, vi } from "vitest";

import * as domain from "../../index.js";

type AuthenticationDomain = typeof domain & {
  loginUser: {
    execute: (
      dependencies: {
        users: { findByEmail: (email: string) => Promise<unknown> };
        passwordHasher: {
          verify: (password: string, passwordHash: string) => Promise<unknown>;
        };
        sessions: { create: (session: unknown) => Promise<unknown> };
        tokens: {
          createAccessToken: (userId: string) => Promise<unknown>;
          createRefreshToken: (expiresAt: Date) => Promise<unknown>;
          hashRefreshToken: (token: string) => Promise<unknown>;
        };
        now: () => Date;
        refreshTokenLifetimeMs: number;
      },
      payload: { email: string; password: string },
    ) => Promise<unknown>;
  };
};

const authDomain = domain as AuthenticationDomain;
const user = {
  id: "507f1f77bcf86cd799439011",
  email: "nico@example.test",
  name: "Nico",
  passwordHash: "bcrypt-hash",
  createdAt: new Date("2026-09-18T10:00:00.000Z"),
};

describe("loginUser", () => {
  it("creates a session with a hashed refresh token after verifying credentials", async () => {
    const findByEmail = vi.fn().mockResolvedValue({ ok: true, value: user });
    const verify = vi.fn().mockResolvedValue({ ok: true, value: true });
    const create = vi.fn().mockResolvedValue({ ok: true, value: undefined });
    const createAccessToken = vi
      .fn()
      .mockResolvedValue({ ok: true, value: "access-token" });
    const createRefreshToken = vi
      .fn()
      .mockResolvedValue({ ok: true, value: "refresh-token" });
    const hashRefreshToken = vi
      .fn()
      .mockResolvedValue({ ok: true, value: "refresh-token-hash" });

    expect("loginUser" in domain).toBe(true);

    const result = await authDomain.loginUser.execute(
      {
        users: { findByEmail },
        passwordHasher: { verify },
        sessions: { create },
        tokens: { createAccessToken, createRefreshToken, hashRefreshToken },
        now: () => new Date("2026-09-18T12:00:00.000Z"),
        refreshTokenLifetimeMs: 86_400_000,
      },
      { email: "nico@example.test", password: "secret-pass" },
    );

    expect(verify).toHaveBeenCalledWith("secret-pass", "bcrypt-hash");
    expect(createRefreshToken).toHaveBeenCalledWith(
      new Date("2026-09-19T12:00:00.000Z"),
    );
    expect(create).toHaveBeenCalledWith({
      userId: user.id,
      tokenHash: "refresh-token-hash",
      expiresAt: new Date("2026-09-19T12:00:00.000Z"),
    });
    expect(result).toEqual({
      ok: true,
      value: { accessToken: "access-token", refreshToken: "refresh-token" },
    });
  });

  it("returns invalid credentials when no user has the email", async () => {
    const findByEmail = vi.fn().mockResolvedValue({ ok: true, value: undefined });
    const verify = vi.fn();
    const create = vi.fn();
    const createAccessToken = vi.fn();
    const createRefreshToken = vi.fn();
    const hashRefreshToken = vi.fn();

    const result = await authDomain.loginUser.execute(
      {
        users: { findByEmail },
        passwordHasher: { verify },
        sessions: { create },
        tokens: { createAccessToken, createRefreshToken, hashRefreshToken },
        now: () => new Date("2026-09-18T12:00:00.000Z"),
        refreshTokenLifetimeMs: 86_400_000,
      },
      { email: "missing@example.test", password: "secret-pass" },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { tag: "InvalidCredentialsError" },
    });
    expect(verify).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("returns the same invalid-credentials error when the password does not match", async () => {
    const findByEmail = vi.fn().mockResolvedValue({ ok: true, value: user });
    const verify = vi.fn().mockResolvedValue({ ok: true, value: false });
    const create = vi.fn();
    const createAccessToken = vi.fn();
    const createRefreshToken = vi.fn();
    const hashRefreshToken = vi.fn();

    const result = await authDomain.loginUser.execute(
      {
        users: { findByEmail },
        passwordHasher: { verify },
        sessions: { create },
        tokens: { createAccessToken, createRefreshToken, hashRefreshToken },
        now: () => new Date("2026-09-18T12:00:00.000Z"),
        refreshTokenLifetimeMs: 86_400_000,
      },
      { email: user.email, password: "wrong-pass" },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { tag: "InvalidCredentialsError" },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects malformed login credentials before querying a user", async () => {
    const findByEmail = vi.fn();
    const verify = vi.fn();
    const create = vi.fn();
    const createAccessToken = vi.fn();
    const createRefreshToken = vi.fn();
    const hashRefreshToken = vi.fn();

    const result = await authDomain.loginUser.execute(
      {
        users: { findByEmail },
        passwordHasher: { verify },
        sessions: { create },
        tokens: { createAccessToken, createRefreshToken, hashRefreshToken },
        now: () => new Date("2026-09-18T12:00:00.000Z"),
        refreshTokenLifetimeMs: 86_400_000,
      },
      { email: "invalid-email", password: "" },
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        tag: "ValidationError",
        issues: expect.arrayContaining([
          expect.objectContaining({ field: "email" }),
          expect.objectContaining({ field: "password" }),
        ]),
      },
    });
    expect(findByEmail).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });
});
