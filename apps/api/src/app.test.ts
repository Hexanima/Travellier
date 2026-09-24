import type { AddressInfo } from "node:net";
import { runInNewContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

import { createApp, createHealthResponse, handleApiRequest } from "./app.js";

describe("api app", () => {
  it("serves a verified email link as an HTML bridge to the native app", async () => {
    const verifyEmailToken = vi.fn().mockResolvedValue({ ok: true, value: undefined });
    const response = await handleApiRequest(
      { method: "GET", url: "/auth/verify/signed.token.value" },
      { auth: { verifyEmailToken } } as never,
    );

    expect(verifyEmailToken).toHaveBeenCalledWith({ token: "signed.token.value" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(response.headers["content-security-policy"]).not.toContain("unsafe-inline");
    expect(response.body).toContain("com.travellier.app://verify/signed.token.value");
    expect(response.body).toContain("setTimeout");
    expect(response.body).toContain("1500");

    const nonce = response.body.match(/<script nonce="([^"]+)">/)?.[1];
    const script = response.body.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
    expect(nonce).toBeDefined();
    expect(response.headers["content-security-policy"]).toContain(`'nonce-${nonce}'`);
    expect(script).toBeDefined();
    const assign = vi.fn();
    const fallback = { hidden: true };
    let timeout: (() => void) | undefined;
    runInNewContext(script ?? "", {
      document: {
        getElementById: () => fallback,
        visibilityState: "visible",
        addEventListener: vi.fn(),
      },
      window: { location: { assign } },
      setTimeout: (callback: () => void) => { timeout = callback; return 1; },
      clearTimeout: vi.fn(),
    });
    expect(assign).toHaveBeenCalledWith("com.travellier.app://verify/signed.token.value");
    expect(fallback.hidden).toBe(true);
    timeout?.();
    expect(fallback.hidden).toBe(false);
  });

  it("shows a safe HTML error without reflecting an invalid token", async () => {
    const verifyEmailToken = vi.fn().mockResolvedValue({
      ok: false,
      error: { tag: "InvalidEmailVerificationTokenError" },
    });
    const response = await handleApiRequest(
      { method: "GET", url: "/auth/verify/bad-token" },
      { auth: { verifyEmailToken } } as never,
    );

    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("inválido o vencido");
    expect(response.body).not.toContain("bad-token");
    expect(response.body).not.toContain("com.travellier.app://verify/");
  });

  it("rejects unsafe verification paths with the same safe HTML error", async () => {
    const verifyEmailToken = vi.fn();
    const response = await handleApiRequest(
      { method: "GET", url: "/auth/verify/%3Cscript%3E" },
      { auth: { verifyEmailToken } } as never,
    );

    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain("script");
    expect(verifyEmailToken).not.toHaveBeenCalled();
  });

  it("builds the Travellier health response", async () => {
    const response = await createHealthResponse();

    expect(response).toEqual({
      app: "travellier",
      status: "ready",
    });
  });

  it("uses injected authentication dependencies in the Node HTTP server", async () => {
    const server = createApp({
      auth: {
        login: async () => ({
          ok: true as const,
          value: { accessToken: "access-token", refreshToken: "refresh-token" },
        }),
      },
    } as never);

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "nico@example.test",
          password: "secret-pass",
        }),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        accessToken: "access-token",
        refreshToken: "refresh-token",
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error === undefined ? resolve() : reject(error))),
      );
    }
  });

  it("registers a user without exposing the password hash", async () => {
    const auth = {
      register: async () => ({
        ok: true as const,
        value: {
          id: "507f1f77bcf86cd799439011",
          email: "nico@example.test",
          name: "Nico",
        },
      }),
    };
    const response = await handleApiRequest({
      method: "POST",
      url: "/auth/register",
      body: JSON.stringify({
        email: "nico@example.test",
        name: "Nico",
        password: "secret-pass",
      }),
    } as never, { auth } as never);

    expect(response).toEqual({
      statusCode: 201,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        user: {
          id: "507f1f77bcf86cd799439011",
          email: "nico@example.test",
          name: "Nico",
        },
      }),
    });
  });

  it("does not expose whether an email is already registered", async () => {
    const response = await handleApiRequest(
      {
        method: "POST",
        url: "/auth/register",
        body: JSON.stringify({
          email: "nico@example.test",
          name: "Nico",
          password: "secret-pass",
        }),
      } as never,
      {
        auth: {
          register: async () => ({
            ok: false as const,
            error: { tag: "EmailAlreadyRegisteredError" },
          }),
        },
      } as never,
    );

    expect(response).toEqual({
      statusCode: 422,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        error: {
          code: "RegistrationFailed",
          message: "Unable to register with the provided details.",
        },
      }),
    });
  });

  it("returns an access and refresh token after login", async () => {
    const login = vi.fn().mockResolvedValue({
      ok: true,
      value: { accessToken: "access-token", refreshToken: "refresh-token" },
    });
    const response = await handleApiRequest(
      {
        method: "POST",
        url: "/auth/login",
        body: JSON.stringify({
          email: "nico@example.test",
          password: "secret-pass",
        }),
      } as never,
      { auth: { login } } as never,
    );

    expect(login).toHaveBeenCalledWith({
      email: "nico@example.test",
      password: "secret-pass",
    });
    expect(response).toEqual({
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accessToken: "access-token",
        refreshToken: "refresh-token",
      }),
    });
  });

  it("does not return an access token for an invalid refresh token", async () => {
    const refresh = vi.fn().mockResolvedValue({
      ok: false,
      error: { tag: "InvalidSessionError" },
    });
    const response = await handleApiRequest(
      {
        method: "POST",
        url: "/auth/refresh",
        body: JSON.stringify({ refreshToken: "revoked-token" }),
      } as never,
      { auth: { refresh } } as never,
    );

    expect(refresh).toHaveBeenCalledWith({ refreshToken: "revoked-token" });
    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain("accessToken");
  });

  it("revokes the refresh session on logout", async () => {
    const logout = vi.fn().mockResolvedValue({ ok: true, value: undefined });
    const response = await handleApiRequest(
      {
        method: "POST",
        url: "/auth/logout",
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      } as never,
      { auth: { logout } } as never,
    );

    expect(logout).toHaveBeenCalledWith({ refreshToken: "refresh-token" });
    expect(response).toEqual({ statusCode: 204, headers: {}, body: "" });
  });

  it("rejects an invalid authentication request body", async () => {
    const response = await handleApiRequest({
      method: "POST",
      url: "/auth/login",
      body: "not-json",
    } as never);

    expect(response.statusCode).toBe(400);
  });

  it("returns the authenticated user's profile without sensitive fields", async () => {
    const getProfile = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        name: "Nico",
        email: "nico@example.test",
        avatar: "avatars/nico.jpg",
      },
    });

    const response = await handleApiRequest(
      {
        method: "GET",
        url: "/profile",
        authenticatedUserId: "507f1f77bcf86cd799439011",
      } as never,
      { auth: { getProfile } } as never,
    );

    expect(getProfile).toHaveBeenCalledWith({
      authenticatedUserId: "507f1f77bcf86cd799439011",
    });
    expect(response).toEqual({
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profile: {
          name: "Nico",
          email: "nico@example.test",
          avatar: "avatars/nico.jpg",
        },
      }),
    });
    expect(response.body).not.toContain("passwordHash");
  });

  it("updates the profile identified by the JWT subject instead of a body user ID", async () => {
    const updateProfile = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        name: "Nicolás",
        email: "nico@example.test",
        avatar: "avatars/nicolas.jpg",
      },
    });

    const response = await handleApiRequest(
      {
        method: "PATCH",
        url: "/profile",
        authenticatedUserId: "507f1f77bcf86cd799439011",
        body: JSON.stringify({
          name: "Nicolás",
          avatar: "avatars/nicolas.jpg",
          userId: "507f191e810c19729de860ea",
        }),
      } as never,
      { auth: { updateProfile } } as never,
    );

    expect(updateProfile).toHaveBeenCalledWith({
      authenticatedUserId: "507f1f77bcf86cd799439011",
      name: "Nicolás",
      avatar: "avatars/nicolas.jpg",
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(
      JSON.stringify({
        profile: {
          name: "Nicolás",
          email: "nico@example.test",
          avatar: "avatars/nicolas.jpg",
        },
      }),
    );
  });

  it("requests a signed avatar upload for the authenticated user", async () => {
    const createAvatarUpload = vi.fn().mockResolvedValue({ ok: true, value: {
      avatar: "avatars/507f1f77bcf86cd799439011/id.jpg",
      uploadUrl: "https://s3.example.test/upload",
      headers: { "content-type": "image/jpeg" },
      expiresAt: new Date("2026-09-23T12:05:00Z"),
    } });
    const response = await handleApiRequest({
      method: "POST", url: "/profile/avatar-upload",
      authenticatedUserId: "507f1f77bcf86cd799439011",
      body: JSON.stringify({ contentType: "image/jpeg", userId: "507f191e810c19729de860ea" }),
    } as never, { auth: { createAvatarUpload } } as never);

    expect(createAvatarUpload).toHaveBeenCalledWith({
      authenticatedUserId: "507f1f77bcf86cd799439011", contentType: "image/jpeg",
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ avatar: "avatars/507f1f77bcf86cd799439011/id.jpg" });
  });

  it("returns only the authenticated user's avatar URL", async () => {
    const getAvatarUrl = vi.fn().mockResolvedValue({ ok: true, value: { url: "https://s3.example.test/view" } });
    const response = await handleApiRequest({
      method: "GET", url: "/profile/avatar-url", authenticatedUserId: "507f1f77bcf86cd799439011",
    } as never, { auth: { getAvatarUrl } } as never);

    expect(getAvatarUrl).toHaveBeenCalledWith({ authenticatedUserId: "507f1f77bcf86cd799439011" });
    expect(response).toMatchObject({ statusCode: 200, body: JSON.stringify({ url: "https://s3.example.test/view" }) });
  });
});
