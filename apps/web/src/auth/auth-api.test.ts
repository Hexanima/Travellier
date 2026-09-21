import { describe, expect, it, vi } from "vitest";

import { createAuthApi } from "./auth-api.js";

describe("createAuthApi", () => {
  it("posts registration details to the public registration endpoint", async () => {
    const post = vi.fn().mockResolvedValue({
      ok: true,
      value: { user: { id: "507f1f77bcf86cd799439011" } },
    });
    const auth = createAuthApi({ post } as never);

    const result = await auth.register({
      email: "nico@example.test",
      name: "Nico",
      password: "secret-pass",
    });

    expect(post).toHaveBeenCalledWith(
      "/auth/register",
      { email: "nico@example.test", name: "Nico", password: "secret-pass" },
      { authenticated: false },
    );
    expect(result).toEqual({ ok: true, value: { id: "507f1f77bcf86cd799439011" } });
  });

  it("posts login credentials publicly and preserves the returned session", async () => {
    const post = vi.fn().mockResolvedValue({
      ok: true,
      value: { accessToken: "access-token", refreshToken: "refresh-token" },
    });
    const auth = createAuthApi({ post } as never);

    const result = await auth.login({ email: "nico@example.test", password: "secret-pass" });

    expect(post).toHaveBeenCalledWith(
      "/auth/login",
      { email: "nico@example.test", password: "secret-pass" },
      { authenticated: false },
    );
    expect(result).toEqual({
      ok: true,
      value: { accessToken: "access-token", refreshToken: "refresh-token" },
    });
  });

  it("refreshes a persisted session without reading an access token", async () => {
    const post = vi.fn().mockResolvedValue({
      ok: true,
      value: { accessToken: "renewed-access-token", refreshToken: "renewed-refresh-token" },
    });
    const auth = createAuthApi({ post } as never);

    const result = await auth.refresh({ refreshToken: "persisted-refresh-token" });

    expect(post).toHaveBeenCalledWith(
      "/auth/refresh",
      { refreshToken: "persisted-refresh-token" },
      { authenticated: false },
    );
    expect(result).toEqual({
      ok: true,
      value: { accessToken: "renewed-access-token", refreshToken: "renewed-refresh-token" },
    });
  });

  it("preserves the refresh failure kind for session restoration", async () => {
    const post = vi.fn().mockResolvedValue({
      ok: false,
      error: { kind: "network", fields: undefined },
    });
    const auth = createAuthApi({ post } as never);

    const result = await auth.refresh({ refreshToken: "persisted-refresh-token" });

    expect(result).toEqual({ ok: false, error: { kind: "network" } });
  });

  it("passes structured validation errors through to the form", async () => {
    const post = vi.fn().mockResolvedValue({
      ok: false,
      error: {
        kind: "validation",
        fields: [{ field: "email", code: "invalid", message: "Email inválido." }],
      },
    });
    const auth = createAuthApi({ post } as never);

    const result = await auth.login({ email: "invalid", password: "secret-pass" });

    expect(result).toEqual({
      ok: false,
      error: { kind: "validation", fields: [{ field: "email", message: "Email inválido." }] },
    });
  });
});
