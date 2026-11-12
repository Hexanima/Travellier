import type { AddressInfo } from "node:net";
import { runInNewContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

import { createApp, createHealthResponse, handleApiRequest } from "./app.js";

describe("api app", () => {
  it("serves a valid invitation as an HTML bridge to the native join screen", async () => {
    const resolveInvitation = vi.fn().mockResolvedValue({ ok: true, value: undefined });
    const response = await handleApiRequest(
      { method: "GET", url: "/invite/VIAJE-X7K2" },
      { trips: { resolveInvitation } } as never,
    );

    expect(resolveInvitation).toHaveBeenCalledWith({ code: "VIAJE-X7K2" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(response.body).toContain("com.travellier.app://invite/VIAJE-X7K2");
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
      setTimeout: (callback: () => void, delay: number) => { expect(delay).toBe(1500); timeout = callback; return 1; },
      clearTimeout: vi.fn(),
    });
    expect(assign).toHaveBeenCalledWith("com.travellier.app://invite/VIAJE-X7K2");
    expect(fallback.hidden).toBe(true);
    timeout?.();
    expect(fallback.hidden).toBe(false);
  });

  it("shows the invitation fallback only after 1500ms without a response from the app", async () => {
    const response = await handleApiRequest(
      { method: "GET", url: "/invite/VIAJE-X7K2" },
      { trips: { resolveInvitation: async () => ({ ok: true, value: undefined }) } } as never,
    );
    const script = response.body.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeDefined();

    vi.useFakeTimers();
    try {
      const fallback = { hidden: true };
      const assign = vi.fn();
      runInNewContext(script ?? "", {
        document: {
          getElementById: () => fallback,
          visibilityState: "visible",
          addEventListener: vi.fn(),
        },
        window: { location: { assign } },
        setTimeout,
        clearTimeout,
      });

      expect(assign).toHaveBeenCalledWith("com.travellier.app://invite/VIAJE-X7K2");
      vi.advanceTimersByTime(1499);
      expect(fallback.hidden).toBe(true);
      vi.advanceTimersByTime(1);
      expect(fallback.hidden).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the invitation fallback hidden when the app takes focus", async () => {
    const response = await handleApiRequest(
      { method: "GET", url: "/invite/VIAJE-X7K2" },
      { trips: { resolveInvitation: async () => ({ ok: true, value: undefined }) } } as never,
    );
    const script = response.body.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeDefined();

    vi.useFakeTimers();
    try {
      const fallback = { hidden: true };
      const document = {
        getElementById: () => fallback,
        visibilityState: "visible",
        addEventListener: vi.fn(),
      };
      runInNewContext(script ?? "", {
        document,
        window: { location: { assign: vi.fn() } },
        setTimeout,
        clearTimeout,
      });

      vi.advanceTimersByTime(1000);
      document.visibilityState = "hidden";
      const onVisibilityChange = document.addEventListener.mock.calls.find(([event]) => event === "visibilitychange")?.[1];
      expect(onVisibilityChange).toBeDefined();
      onVisibilityChange?.();
      vi.advanceTimersByTime(500);
      expect(fallback.hidden).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns a safe HTML error for unknown and unsafe invitation codes", async () => {
    const resolveInvitation = vi.fn().mockResolvedValue({ ok: false, error: { tag: "InvalidInviteCodeError" } });
    const dependencies = { trips: { resolveInvitation } } as never;
    const unknown = await handleApiRequest({ method: "GET", url: "/invite/MISSING" }, dependencies);
    const unsafe = await handleApiRequest({ method: "GET", url: "/invite/%3Cscript%3E" }, dependencies);

    expect(unknown.statusCode).toBe(404);
    expect(unknown.headers["content-type"]).toContain("text/html");
    expect(unknown.body).not.toContain("MISSING");
    expect(unknown.body).not.toContain("com.travellier.app://invite/");
    expect(unsafe.statusCode).toBe(400);
    expect(unsafe.body).not.toContain("script");
    expect(resolveInvitation).toHaveBeenCalledTimes(1);
  });
  it("confirms an invitation only for the authenticated user", async () => {
    const joinByCode = vi.fn().mockResolvedValue({ ok: true, value: { tripId: "507f191e810c19729de860ea", joined: true } });
    const request = { method: "POST", url: "/trips/join", body: JSON.stringify({ code: "VIAJE-X7K2" }) };
    const dependencies = { trips: { joinByCode } } as never;

    expect((await handleApiRequest(request, dependencies)).statusCode).toBe(401);
    const response = await handleApiRequest({ ...request, authenticatedUserId: "507f1f77bcf86cd799439011" as never }, dependencies);

    expect(joinByCode).toHaveBeenCalledWith({ authenticatedUserId: "507f1f77bcf86cd799439011", code: "VIAJE-X7K2" });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ tripId: "507f191e810c19729de860ea", joined: true });
  });

  it("reports an unknown invitation code without creating a membership", async () => {
    const response = await handleApiRequest({
      method: "POST", url: "/trips/join", body: { code: "missing" }, authenticatedUserId: "507f1f77bcf86cd799439011" as never,
    }, { trips: { joinByCode: vi.fn().mockResolvedValue({ ok: false, error: { tag: "InvalidInviteCodeError" } }) } } as never);

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("missing");
  });

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

  it("registers with only email and password and returns a null name", async () => {
    const register = vi.fn().mockResolvedValue({
      ok: true,
      value: { id: "507f1f77bcf86cd799439011", email: "nico@example.test", name: null },
    });
    const response = await handleApiRequest({
      method: "POST",
      url: "/auth/register",
      body: JSON.stringify({ email: "nico@example.test", password: "secret-pass" }),
    } as never, { auth: { register } } as never);

    expect(register).toHaveBeenCalledWith({ email: "nico@example.test", password: "secret-pass" });
    expect(response).toEqual({
      statusCode: 201,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        user: { id: "507f1f77bcf86cd799439011", email: "nico@example.test", name: null },
      }),
    });
    expect(response.body).not.toContain("passwordHash");
  });

  it("rejects a registration whose optional name is not a string", async () => {
    const register = vi.fn();
    const response = await handleApiRequest({
      method: "POST",
      url: "/auth/register",
      body: JSON.stringify({ email: "nico@example.test", name: 123, password: "secret-pass" }),
    } as never, { auth: { register } } as never);

    expect(response).toMatchObject({ statusCode: 400 });
    expect(JSON.parse(response.body)).toMatchObject({ error: { code: "InvalidRequest" } });
    expect(register).not.toHaveBeenCalled();
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

  describe("GET /trips/:tripId/photos", () => {
    const user = "507f1f77bcf86cd799439011", trip = "507f191e810c19729de860ea", activity = "507f191e810c19729de860eb", transport = "507f191e810c19729de860ec";
    const page = { photos: [{ id: "p1", postId: "post1", order: 1, url: "https://get.test/1", expiresAt: "2026-11-10T10:05:00.000Z" }], nextCursor: "abc" };
    const call = (url: string, trips: Record<string, unknown>, extra: Record<string, unknown> = { authenticatedUserId: user }, method = "GET") =>
      handleApiRequest({ method, url, ...extra } as never, { trips } as never);
    const lister = () => vi.fn().mockResolvedValue({ ok: true, value: page });

    it("answers 401 without a session and does not read anything", async () => {
      const listPhotos = lister();
      const response = await call(`/trips/${trip}/photos`, { listPhotos }, {});
      expect(response.statusCode).toBe(401);
      expect(listPhotos).not.toHaveBeenCalled();
    });

    it("passes the Trip, the user and the raw query values and answers the exact body", async () => {
      const listPhotos = lister();
      const response = await call(`/trips/${trip}/photos?limit=5&cursor=a%2Bb_c-d&activityId=${activity}`, { listPhotos });
      expect(response.statusCode).toBe(200);
      expect(response.headers).toMatchObject({ "content-type": "application/json" });
      expect(JSON.parse(response.body)).toEqual(page);
      expect(Object.keys(JSON.parse(response.body)).sort()).toEqual(["nextCursor", "photos"]);
      expect(listPhotos).toHaveBeenCalledWith({ tripId: trip, authenticatedUserId: user, limit: "5", cursor: "a+b_c-d", activityId: activity });
    });

    it("sends only what the request carried", async () => {
      const listPhotos = lister();
      expect((await call(`/trips/${trip}/photos`, { listPhotos })).statusCode).toBe(200);
      expect((await call(`/trips/${trip}/photos?`, { listPhotos })).statusCode).toBe(200);
      expect((await call(`/trips/${trip}/photos?transportId=${transport.toUpperCase()}`, { listPhotos })).statusCode).toBe(200);
      expect((await call(`/trips/${trip}/photos?limit=&cursor=`, { listPhotos })).statusCode).toBe(200);
      expect(listPhotos.mock.calls.map(([payload]) => payload)).toEqual([
        { tripId: trip, authenticatedUserId: user }, { tripId: trip, authenticatedUserId: user },
        { tripId: trip, authenticatedUserId: user, transportId: transport }, { tripId: trip, authenticatedUserId: user, limit: "", cursor: "" }]);
    });

    it("answers 400 for a malformed Trip, activity or transport id before reading", async () => {
      const listPhotos = lister();
      for (const url of ["/trips/not-an-id/photos", `/trips/${trip}/photos?activityId=zzz`, `/trips/${trip}/photos?transportId=`,
        `/trips/${trip}/photos?activityId=${activity}&transportId=12`, `/trips/${trip}/photos?activityId=zzz&unknown=1`]) {
        const response = await call(url, { listPhotos });
        expect(response.statusCode, url).toBe(400);
        expect(JSON.parse(response.body).error.code).toBe("InvalidRequest");
      }
      expect(listPhotos).not.toHaveBeenCalled();
    });

    it("answers 422 with fields for an unknown or repeated parameter without echoing it", async () => {
      const listPhotos = lister();
      const unknown = await call(`/trips/${trip}/photos?secretName=1`, { listPhotos });
      expect(unknown.statusCode).toBe(422);
      expect(JSON.parse(unknown.body).error).toMatchObject({ code: "ValidationError", fields: [{ field: "query", code: "unknown_parameter" }] });
      expect(unknown.body).not.toContain("secretName");
      for (const query of [`limit=1&limit=2`, `activityId=${activity}&activityId=${activity}`, `cursor=a&cursor=b`]) {
        const response = await call(`/trips/${trip}/photos?${query}`, { listPhotos });
        expect(response.statusCode, query).toBe(422);
        expect(JSON.parse(response.body).error.fields).toMatchObject([{ field: "query", code: "duplicate_parameter" }]);
      }
      expect(listPhotos).not.toHaveBeenCalled();
    });

    it("maps the use case failures to their status", async () => {
      const failing = (error: unknown) => ({ listPhotos: vi.fn().mockResolvedValue({ ok: false, error }) });
      const cases: Array<[unknown, number, string]> = [
        [{ tag: "TripNotFoundError" }, 404, "TripNotFoundError"], [{ tag: "ActivityNotFoundError" }, 404, "ActivityNotFoundError"],
        [{ tag: "TransportNotFoundError" }, 404, "TransportNotFoundError"], [{ tag: "UnknownError" }, 500, "InternalServerError"]];
      for (const [error, status] of cases) {
        const response = await call(`/trips/${trip}/photos`, failing(error));
        expect(response.statusCode, JSON.stringify(error)).toBe(status);
      }
      const { ValidationError } = await import("app-domain");
      const invalid = await call(`/trips/${trip}/photos`, failing(new ValidationError([{ field: "limit", code: "invalid", message: "Limit is not valid." }])));
      expect(invalid.statusCode).toBe(422);
      expect(JSON.parse(invalid.body).error.fields).toEqual([{ field: "limit", code: "invalid", message: "Limit is not valid." }]);
    });

    it("answers 503 when the listing is not wired", async () => {
      expect((await call(`/trips/${trip}/photos`, {})).statusCode).toBe(503);
    });

    it("does not capture the other photo routes nor other methods", async () => {
      const listPhotos = lister(), getPhoto = vi.fn().mockResolvedValue({ ok: true, value: { id: "x" } });
      const getPostPhotos = vi.fn().mockResolvedValue({ ok: true, value: [] });
      const trips = { listPhotos, getPhoto, getPostPhotos };
      expect((await call(`/trips/${trip}/photos/${activity}`, trips)).statusCode).toBe(200);
      expect(getPhoto).toHaveBeenCalledWith({ tripId: trip, authenticatedUserId: user, photoId: activity });
      expect((await call(`/trips/${trip}/posts/${activity}/photos`, trips)).statusCode).toBe(200);
      expect(getPostPhotos).toHaveBeenCalledTimes(1);
      expect((await call(`/trips/${trip}/photos`, trips, { authenticatedUserId: user, body: "{}" }, "POST")).statusCode).not.toBe(200);
      expect((await call(`/trips/${trip}/photos/`, trips)).statusCode).not.toBe(200);
      expect(listPhotos).not.toHaveBeenCalled();
    });
  });

  it("returns only the authenticated user's avatar URL", async () => {
    const getAvatarUrl = vi.fn().mockResolvedValue({ ok: true, value: { url: "https://s3.example.test/view" } });
    const response = await handleApiRequest({
      method: "GET", url: "/profile/avatar-url", authenticatedUserId: "507f1f77bcf86cd799439011",
    } as never, { auth: { getAvatarUrl } } as never);

    expect(getAvatarUrl).toHaveBeenCalledWith({ authenticatedUserId: "507f1f77bcf86cd799439011" });
    expect(response).toMatchObject({ statusCode: 200, body: JSON.stringify({ url: "https://s3.example.test/view" }) });
  });
  it("routes GET /trips/:tripId/balance to the balance use case", async () => {
    const trip = "507f1f77bcf86cd799439012", user = "507f1f77bcf86cd799439011";
    const balance = { tripId: trip, expenseMode: "balance", currencies: [], excludedExpenses: [], includedExpenseCount: 0 };
    const getBalance = vi.fn().mockResolvedValue({ ok: true, value: balance });
    const ok = await handleApiRequest({ method: "GET", url: `/trips/${trip}/balance`, authenticatedUserId: user } as never, { trips: { getBalance } } as never);
    expect(getBalance).toHaveBeenCalledWith({ tripId: trip, authenticatedUserId: user });
    expect(ok).toMatchObject({ statusCode: 200, body: JSON.stringify({ balance }) });
    expect((await handleApiRequest({ method: "GET", url: `/trips/${trip}/balance` } as never, { trips: { getBalance } } as never)).statusCode).toBe(401);
    expect((await handleApiRequest({ method: "GET", url: "/trips/x/balance", authenticatedUserId: user } as never, { trips: { getBalance } } as never)).statusCode).toBe(400);
    expect((await handleApiRequest({ method: "GET", url: `/trips/${trip}/balance`, authenticatedUserId: user } as never, { trips: {} } as never)).statusCode).toBe(503);
    const missing = vi.fn().mockResolvedValue({ ok: false, error: { tag: "TripNotFoundError" } });
    expect((await handleApiRequest({ method: "GET", url: `/trips/${trip}/balance`, authenticatedUserId: user } as never, { trips: { getBalance: missing } } as never)).statusCode).toBe(404);
    expect(getBalance).toHaveBeenCalledTimes(1);
  });
});

describe("query string handling (T91)", () => {
  const user = "507f1f77bcf86cd799439011", trip = "507f191e810c19729de860ea";

  it("routes without declared query parameters ignore the query string", async () => {
    const getBalance = vi.fn().mockResolvedValue({ ok: true, value: { balances: [] } });
    const response = await handleApiRequest({ method: "GET", url: `/trips/${trip}/balance?x=1`, authenticatedUserId: user } as never, { trips: { getBalance } } as never);
    expect(response.statusCode).toBe(200);
    expect(getBalance).toHaveBeenCalledTimes(1);
    const health = await handleApiRequest({ method: "GET", url: "/health?x=1" } as never, {} as never);
    expect(health.statusCode).toBe(200);
  });

  it("keeps reading the query in /notifications and /trips/:id/photos", async () => {
    const listNotifications = vi.fn().mockResolvedValue({ ok: true, value: { notifications: [], nextCursor: null } });
    const listPhotos = vi.fn().mockResolvedValue({ ok: true, value: { photos: [], nextCursor: null } });
    await handleApiRequest({ method: "GET", url: "/notifications?limit=1&cursor=abc", authenticatedUserId: user } as never, { trips: { listNotifications } } as never);
    expect(listNotifications).toHaveBeenCalledWith({ authenticatedUserId: user, limit: "1", cursor: "abc" });
    await handleApiRequest({ method: "GET", url: `/trips/${trip}/photos?limit=2`, authenticatedUserId: user } as never, { trips: { listPhotos } } as never);
    expect(listPhotos).toHaveBeenCalledWith({ tripId: trip, authenticatedUserId: user, limit: "2" });
  });
});

describe("post PATCH: removePhotos and expense null (T127)", () => {
  const user = "507f1f77bcf86cd799439011", trip = "507f191e810c19729de860ea", post = "507f191e810c19729de860eb";
  const photo = "507f191e810c19729de860ec";
  const stored = { id: post, tripId: trip, authorId: user, description: "Recuerdo", mapsUrl: null, activityId: null, parentPostId: null, transportId: null };
  const call = (method: string, body: unknown, trips: Record<string, unknown>, url = `/trips/${trip}/posts/${post}`) =>
    handleApiRequest({ method, url, authenticatedUserId: user, body: JSON.stringify(body) } as never, { trips } as never);
  const fields = (response: { body: string }) => (JSON.parse(response.body).error?.fields ?? []).map((issue: { field: string; code: string }) => `${issue.field}/${issue.code}`);

  it("forwards expense null to updatePost and answers the post without the expense key", async () => {
    const updatePost = vi.fn().mockResolvedValue({ ok: true, value: stored });
    const response = await call("PATCH", { expense: null }, { updatePost });
    expect(response.statusCode).toBe(200);
    expect(updatePost).toHaveBeenCalledWith({ tripId: trip, authenticatedUserId: user, postId: post, expense: null });
    expect(JSON.parse(response.body)).toEqual({ post: stored });
  });

  it.each([["a number", 10], ["a list", []], ["text", "10"]])("rejects an expense that is %s without calling the use case", async (_, expense) => {
    const updatePost = vi.fn();
    const response = await call("PATCH", { expense }, { updatePost });
    expect(response.statusCode).toBe(422);
    expect(fields(response)).toEqual(["expense/invalid"]);
    expect(updatePost).not.toHaveBeenCalled();
  });

  it("forwards a well formed removePhotos and answers the remaining photos, also when empty", async () => {
    const updatePost = vi.fn().mockResolvedValue({ ok: true, value: { ...stored, photos: [] } });
    const response = await call("PATCH", { removePhotos: [{ id: photo }] }, { updatePost });
    expect(response.statusCode).toBe(200);
    expect(updatePost).toHaveBeenCalledWith({ tripId: trip, authenticatedUserId: user, postId: post, removePhotos: [{ id: photo }] });
    expect(JSON.parse(response.body)).toEqual({ post: stored, photos: [] });
  });

  it("answers photos and omits the expense after removing both in one PATCH", async () => {
    const photos = [{ id: photo, order: 1 }];
    const updatePost = vi.fn().mockResolvedValue({ ok: true, value: { ...stored, photos } });
    const response = await call("PATCH", { removePhotos: [{ id: photo }], expense: null, description: "Nuevo" }, { updatePost });
    expect(JSON.parse(response.body)).toEqual({ post: stored, photos });
    expect(updatePost.mock.calls[0]![0]).toMatchObject({ removePhotos: [{ id: photo }], expense: null, description: "Nuevo" });
  });

  it.each([["null", null], ["an object", { id: photo }], ["text", "x"]])("rejects removePhotos that is %s", async (_, removePhotos) => {
    const updatePost = vi.fn();
    const response = await call("PATCH", { removePhotos }, { updatePost });
    expect(response.statusCode).toBe(422);
    expect(fields(response)).toEqual(["removePhotos/invalid"]);
    expect(updatePost).not.toHaveBeenCalled();
  });

  it("rejects removePhotos together with newActivity and on creation", async () => {
    const updatePost = vi.fn(), linkPostToNewActivity = vi.fn(), createPost = vi.fn();
    const trips = { updatePost, linkPostToNewActivity, createPost };
    const withActivity = await call("PATCH", { removePhotos: [{ id: photo }], newActivity: { title: "Cena", scheduledAt: "2026-09-25T12:00:00.000Z" } }, trips);
    expect(withActivity.statusCode).toBe(422);
    expect(fields(withActivity)).toEqual(["removePhotos/unsupported"]);
    const creation = await call("POST", { description: "Recuerdo", removePhotos: [{ id: photo }] }, trips, `/trips/${trip}/posts`);
    expect(creation.statusCode).toBe(422);
    expect(fields(creation)).toEqual(["removePhotos/unsupported"]);
    expect([updatePost, linkPostToNewActivity, createPost].every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });

  it("lets the domain reject expense null on creation", async () => {
    const createPost = vi.fn().mockResolvedValue({ ok: false, error: { tag: "ValidationError", issues: [], message: "" } });
    await call("POST", { description: "Recuerdo", expense: null }, { createPost }, `/trips/${trip}/posts`);
    expect(createPost.mock.calls[0]![0]).toMatchObject({ expense: null });
  });
});
