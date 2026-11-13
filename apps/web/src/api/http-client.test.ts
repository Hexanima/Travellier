import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createHttpClient } from "./http-client.js";

describe("createHttpClient", () => {
  it("classifies a forbidden member action separately from a server failure", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "Forbidden" } }), { status: 403 }));
    const client = createHttpClient({
      baseUrl: "https://api.example.test",
      fetch,
      getAccessToken: vi.fn().mockResolvedValue("access-token"),
      onUnauthorized: vi.fn(),
    });

    const result = await client.delete("/trips/trip-1/members/user-1");
    expect(result).toMatchObject({ ok: false, error: { kind: "forbidden", status: 403 } });
  });
  it("adds the current access token to authenticated requests", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "trip-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const getAccessToken = vi.fn().mockResolvedValue("access-token");
    const client = createHttpClient({
      baseUrl: "https://api.example.test",
      fetch,
      getAccessToken,
      onUnauthorized: vi.fn(),
    });

    const result = await client.get<{ id: string }>("/trips/trip-1");

    expect(result).toEqual({ ok: true, value: { id: "trip-1" } });
    expect(getAccessToken).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith("https://api.example.test/trips/trip-1", {
      headers: { Authorization: "Bearer access-token" },
      method: "GET",
      signal: expect.any(AbortSignal),
    });
  });

  it("omits Authorization when there is no access token", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "ready" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = createHttpClient({
      baseUrl: "https://api.example.test/",
      fetch,
      getAccessToken: vi.fn().mockResolvedValue(null),
      onUnauthorized: vi.fn(),
    });

    await client.get("/health");

    expect(fetch).toHaveBeenCalledWith("https://api.example.test/health", {
      headers: {},
      method: "GET",
      signal: expect.any(AbortSignal),
    });
  });

  it("sends public requests without reading the access token", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ accessToken: "new-token" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const getAccessToken = vi.fn().mockRejectedValue(new Error("Storage must not be used"));
    const client = createHttpClient({
      baseUrl: "https://api.example.test",
      fetch,
      getAccessToken,
      onUnauthorized: vi.fn(),
    });

    const result = await client.post(
      "/auth/login",
      { email: "user@example.test", password: "secret" },
      { authenticated: false },
    );

    expect(result).toEqual({ ok: true, value: { accessToken: "new-token" } });
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith("https://api.example.test/auth/login", {
      body: JSON.stringify({ email: "user@example.test", password: "secret" }),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: expect.any(AbortSignal),
    });
  });

  it("supports the mutation verbs required by the API", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "trip-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = createHttpClient({
      baseUrl: "https://api.example.test",
      fetch,
      getAccessToken: vi.fn().mockResolvedValue("access-token"),
      onUnauthorized: vi.fn(),
    });

    await client.put("/trips/trip-1", { name: "Actualizado" });
    await client.patch("/trips/trip-1", { coverPhotoId: "photo-1" });
    await client.delete("/trips/trip-1");

    expect(fetch).toHaveBeenNthCalledWith(1, "https://api.example.test/trips/trip-1", {
      body: JSON.stringify({ name: "Actualizado" }),
      headers: {
        Authorization: "Bearer access-token",
        "content-type": "application/json",
      },
      method: "PUT",
      signal: expect.any(AbortSignal),
    });
    expect(fetch).toHaveBeenNthCalledWith(2, "https://api.example.test/trips/trip-1", {
      body: JSON.stringify({ coverPhotoId: "photo-1" }),
      headers: {
        Authorization: "Bearer access-token",
        "content-type": "application/json",
      },
      method: "PATCH",
      signal: expect.any(AbortSignal),
    });
    expect(fetch).toHaveBeenNthCalledWith(3, "https://api.example.test/trips/trip-1", {
      headers: { Authorization: "Bearer access-token" },
      method: "DELETE",
      signal: expect.any(AbortSignal),
    });
  });

  it("returns a UI-safe error when access-token retrieval fails", async () => {
    const fetch = vi.fn();
    const client = createHttpClient({
      baseUrl: "https://api.example.test",
      fetch,
      getAccessToken: vi.fn().mockRejectedValue(new Error("Preferences unavailable")),
      onUnauthorized: vi.fn(),
    });

    await expect(client.get("/trips")).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({
        tag: "ApiClientError",
        kind: "client",
        code: "AccessTokenError",
        message: "No pudimos preparar la solicitud. Intentá nuevamente.",
      }),
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("serializes API validation errors for UI feedback", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "ValidationFailed",
            message: "Revisá los campos marcados.",
            fields: [{ field: "email", code: "invalid", message: "Email inválido." }],
          },
        }),
        { status: 422, headers: { "content-type": "application/json" } },
      ),
    );
    const client = createHttpClient({
      baseUrl: "https://api.example.test",
      fetch,
      getAccessToken: vi.fn().mockResolvedValue("access-token"),
      onUnauthorized: vi.fn(),
    });

    const result = await client.post("/auth/login", {
      email: "invalid",
      password: "secret",
    });

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        tag: "ApiClientError",
        kind: "validation",
        status: 422,
        code: "ValidationFailed",
        message: "Revisá los campos marcados.",
        fields: [{ field: "email", code: "invalid", message: "Email inválido." }],
      }),
    });
    expect(fetch).toHaveBeenCalledWith("https://api.example.test/auth/login", {
      body: JSON.stringify({ email: "invalid", password: "secret" }),
      headers: {
        Authorization: "Bearer access-token",
        "content-type": "application/json",
      },
      method: "POST",
      signal: expect.any(AbortSignal),
    });
  });

  it("normalizes malformed and network failures into UI-safe errors", async () => {
    const malformedClient = createHttpClient({
      baseUrl: "https://api.example.test",
      fetch: vi.fn().mockResolvedValue(new Response("upstream failure", { status: 502 })),
      getAccessToken: vi.fn().mockResolvedValue("access-token"),
      onUnauthorized: vi.fn(),
    });
    const networkClient = createHttpClient({
      baseUrl: "https://api.example.test",
      fetch: vi.fn().mockRejectedValue(new TypeError("Network failure")),
      getAccessToken: vi.fn().mockResolvedValue("access-token"),
      onUnauthorized: vi.fn(),
    });

    await expect(malformedClient.get("/trips")).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({
        tag: "ApiClientError",
        kind: "server",
        status: 502,
        code: "HttpError",
        message: "No pudimos completar la solicitud. Intentá nuevamente.",
      }),
    });
    await expect(networkClient.get("/trips")).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({
        tag: "ApiClientError",
        kind: "network",
        code: "NetworkError",
        message: "No pudimos conectarnos. Verificá tu conexión e intentá nuevamente.",
      }),
    });
  });

  it("centralizes unauthorized responses", async () => {
    const onUnauthorized = vi.fn();
    const client = createHttpClient({
      baseUrl: "https://api.example.test",
      fetch: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      ),
      getAccessToken: vi.fn().mockResolvedValue("expired-token"),
      onUnauthorized,
    });

    const result = await client.get("/trips");

    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        tag: "ApiClientError",
        kind: "unauthorized",
        status: 401,
        code: "Unauthorized",
      }),
    });
  });

  it("tells the unauthorized handler which bearer the failed request used", async () => {
    const respond = () => vi.fn().mockImplementation(async () => new Response(JSON.stringify({ error: { code: "Unauthorized", message: "x" } }), { status: 401 }));
    const onUnauthorized = vi.fn();
    const client = createHttpClient({ baseUrl: "https://api.example.test", fetch: respond(), getAccessToken: vi.fn().mockResolvedValue("token-A"), onUnauthorized });
    await client.get("/trips");
    expect(onUnauthorized).toHaveBeenLastCalledWith("token-A");
    await client.post("/x", {}, { authenticated: false, headers: { Authorization: "Bearer token-OUT" } });
    expect(onUnauthorized).toHaveBeenLastCalledWith("token-OUT");
    await client.post("/auth/login", {}, { authenticated: false });
    expect(onUnauthorized).toHaveBeenLastCalledWith(null);
  });

  it("returns the unauthorized result when its central handler fails", async () => {
    const onUnauthorized = vi.fn().mockRejectedValue(new Error("Session cleanup failed"));
    const client = createHttpClient({
      baseUrl: "https://api.example.test",
      fetch: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      ),
      getAccessToken: vi.fn().mockResolvedValue("expired-token"),
      onUnauthorized,
    });

    await expect(client.get("/trips")).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({
        tag: "ApiClientError",
        kind: "unauthorized",
        code: "Unauthorized",
        status: 401,
      }),
    });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  describe("participation conflict details", () => {
    const conflicts = [{ activityId: "a".repeat(24), reason: "overlap", scheduledAt: "2026-09-25T12:00:00.000Z", durationMinutes: 60 }];
    const activity = { scheduledAt: "2026-09-25T12:30:00.000Z", durationMinutes: null };
    const run = async (status: number, error: Record<string, unknown>) => {
      const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error }), { status }));
      const client = createHttpClient({ baseUrl: "https://api.example.test", fetch, getAccessToken: async () => "t", onUnauthorized: vi.fn() });
      const result = await client.put("/x", { status: "going" });
      if (result.ok) throw new Error("expected failure");
      return result.error;
    };
    it("exposes conflicts and activity of a 409 ParticipationConflictError and keeps the server kind", async () => {
      const error = await run(409, { code: "ParticipationConflictError", message: "Conflicto", conflicts, activity });
      expect(error.kind).toBe("server");
      expect(error.details).toEqual({ conflicts, activity });
    });
    it("does not copy the server message nor unknown fields into details", async () => {
      const error = await run(409, { code: "ParticipationConflictError", message: "Secreto de otro usuario", conflicts, activity, other: 1 });
      expect(Object.keys(error.details ?? {}).sort()).toEqual(["activity", "conflicts"]);
      expect(JSON.stringify(error.details)).not.toContain("Secreto");
    });
    it("leaves details undefined for another 409 code", async () => {
      expect((await run(409, { code: "Conflict", conflicts, activity })).details).toBeUndefined();
    });
    it("leaves details undefined for a 500 even with conflicts in the body", async () => {
      expect((await run(500, { code: "ParticipationConflictError", conflicts, activity })).details).toBeUndefined();
    });
  });

  describe("post request conflict details", () => {
    const postId = "b".repeat(24);
    const run = async (status: number, error: Record<string, unknown>) => {
      const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error }), { status }));
      const client = createHttpClient({ baseUrl: "https://api.example.test", fetch, getAccessToken: async () => "t", onUnauthorized: vi.fn() });
      const result = await client.post("/x", {});
      if (result.ok) throw new Error("expected failure");
      return result.error;
    };
    it("exposes reason and postId of a 409 PostRequestConflictError and keeps the server kind", async () => {
      const error = await run(409, { code: "PostRequestConflictError", message: "Secreto", reason: "already_saved", postId });
      expect(error).toMatchObject({ kind: "server", code: "PostRequestConflictError", reason: "already_saved", postId });
      expect(error.details).toBeUndefined();
    });
    it("leaves reason and postId undefined for the generic 409", async () => {
      const error = await run(409, { code: "PostRequestConflictError", message: "x" });
      expect(error.reason).toBeUndefined(); expect(error.postId).toBeUndefined();
    });
    it("ignores a non string reason or postId and any other code or status", async () => {
      expect((await run(409, { code: "PostRequestConflictError", reason: 1, postId: 2 }))).toMatchObject({ reason: undefined, postId: undefined });
      expect((await run(409, { code: "Conflict", reason: "already_saved", postId })).reason).toBeUndefined();
      expect((await run(500, { code: "PostRequestConflictError", reason: "already_saved", postId })).reason).toBeUndefined();
    });
    it("keeps the participation conflict details untouched", async () => {
      const conflicts = [{ activityId: "a".repeat(24), reason: "overlap", scheduledAt: "2026-09-25T12:00:00.000Z", durationMinutes: 60 }];
      const error = await run(409, { code: "ParticipationConflictError", conflicts, activity: { scheduledAt: "2026-09-25T12:30:00.000Z", durationMinutes: null }, reason: "x", postId });
      expect(Object.keys(error.details ?? {}).sort()).toEqual(["activity", "conflicts"]);
      expect(error.reason).toBeUndefined(); expect(error.postId).toBeUndefined();
    });
  });
});

describe("timeout (T146)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const clientWith = (fetch: ReturnType<typeof vi.fn>) =>
    createHttpClient({
      baseUrl: "https://api.example.test",
      fetch,
      getAccessToken: vi.fn().mockResolvedValue("access-token"),
      onUnauthorized: vi.fn(),
    });
  const signalOf = (fetch: ReturnType<typeof vi.fn>) => (fetch.mock.calls[0]![1] as RequestInit).signal as AbortSignal;

  it("fails with a retryable network timeout after 30 s", async () => {
    const fetch = vi.fn().mockReturnValue(new Promise<Response>(() => {}));
    const pending = clientWith(fetch).get("/trips");
    await vi.advanceTimersByTimeAsync(30_000);

    expect(await pending).toMatchObject({
      ok: false,
      error: { kind: "network", code: "TimeoutError", message: expect.stringContaining("Intentá nuevamente") },
    });
  });

  it("does not abort before the 30 s are over", async () => {
    const fetch = vi.fn().mockReturnValue(new Promise<Response>(() => {}));
    const pending = clientWith(fetch).get("/trips");
    await vi.advanceTimersByTimeAsync(29_999);

    expect(signalOf(fetch).aborted).toBe(false);
    void pending.catch(() => undefined);
  });

  it("clears the timer when the response arrives in time", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "trip-1" }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const result = await clientWith(fetch).get<{ id: string }>("/trips/trip-1");
    await vi.advanceTimersByTimeAsync(60_000);

    expect(result).toEqual({ ok: true, value: { id: "trip-1" } });
    expect(signalOf(fetch).aborted).toBe(false);
  });

  it("times out a slow body instead of reporting an invalid response", async () => {
    const response = { status: 200, ok: true, json: () => new Promise(() => {}) } as unknown as Response;
    const fetch = vi.fn().mockResolvedValue(response);
    const pending = clientWith(fetch).get("/trips");
    await vi.advanceTimersByTimeAsync(30_000);

    expect(await pending).toMatchObject({ ok: false, error: { kind: "network", code: "TimeoutError" } });
  });

  it("keeps reporting other fetch failures as network errors", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("offline"));
    const result = await clientWith(fetch).get("/trips");

    expect(result).toMatchObject({ ok: false, error: { kind: "network", code: "NetworkError" } });
  });
});
