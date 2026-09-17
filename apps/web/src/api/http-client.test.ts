import { describe, expect, it, vi } from "vitest";

import { createHttpClient } from "./http-client.js";

describe("createHttpClient", () => {
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
});
