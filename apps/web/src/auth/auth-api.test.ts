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

  it("reads the authenticated profile", async () => {
    const get = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        profile: { name: "Nico", email: "nico@example.test", avatar: null },
      },
    });
    const auth = createAuthApi({ get } as never);

    expect(auth).toHaveProperty("getProfile");

    const result = await (auth as never as { getProfile: () => Promise<unknown> }).getProfile();

    expect(get).toHaveBeenCalledWith("/profile");
    expect(result).toEqual({
      ok: true,
      value: { name: "Nico", email: "nico@example.test", avatar: null },
    });
  });

  it("updates the authenticated profile and preserves validation feedback", async () => {
    const patch = vi.fn().mockResolvedValue({
      ok: false,
      error: {
        kind: "validation",
        fields: [{ field: "name", code: "required", message: "Ingresá tu nombre." }],
      },
    });
    const auth = createAuthApi({ patch } as never);

    expect(auth).toHaveProperty("updateProfile");

    const result = await (
      auth as never as {
        updateProfile: (payload: { name: string }) => Promise<unknown>;
      }
    ).updateProfile({ name: "" });

    expect(patch).toHaveBeenCalledWith("/profile", { name: "" });
    expect(result).toEqual({
      ok: false,
      error: {
        kind: "validation",
        fields: [{ field: "name", message: "Ingresá tu nombre." }],
      },
    });
  });

  it("uploads an avatar directly to the signed S3 URL before returning its key", async () => {
    const post = vi.fn().mockResolvedValue({ ok: true, value: {
      avatar: "avatars/user/id.jpg", uploadUrl: "https://s3.example.test/upload",
      headers: { "content-type": "image/jpeg" }, expiresAt: "2026-09-23T12:05:00Z",
    } });
    const upload = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const auth = createAuthApi({ post } as never, upload);
    const file = new File(["image"], "avatar.jpg", { type: "image/jpeg" });

    const result = await auth.uploadAvatar(file);

    expect(post).toHaveBeenCalledWith("/profile/avatar-upload", { contentType: "image/jpeg" });
    expect(upload).toHaveBeenCalledWith("https://s3.example.test/upload", {
      method: "PUT", headers: { "content-type": "image/jpeg" }, body: file,
    });
    expect(result).toEqual({ ok: true, value: { avatar: "avatars/user/id.jpg" } });
  });

  it("does not return an avatar key if the S3 upload fails", async () => {
    const post = vi.fn().mockResolvedValue({ ok: true, value: {
      avatar: "avatars/user/id.jpg", uploadUrl: "https://s3.example.test/upload",
      headers: { "content-type": "image/jpeg" }, expiresAt: "2026-09-23T12:05:00Z",
    } });
    const auth = createAuthApi({ post } as never, vi.fn().mockResolvedValue(new Response(null, { status: 403 })));

    expect(await auth.uploadAvatar(new File(["image"], "avatar.jpg", { type: "image/jpeg" }))).toEqual({
      ok: false, error: { kind: "server" },
    });
  });

  it("reads the temporary view URL for the stored avatar", async () => {
    const get = vi.fn().mockResolvedValue({ ok: true, value: { url: "https://s3.example.test/view" } });
    const auth = createAuthApi({ get } as never);

    expect(await auth.getAvatarUrl()).toEqual({ ok: true, value: { url: "https://s3.example.test/view" } });
    expect(get).toHaveBeenCalledWith("/profile/avatar-url");
  });
});
