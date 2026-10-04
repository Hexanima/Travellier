import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "./app.js";

const servers: Server[] = [];
const logs: Record<string, unknown>[] = [];

const start = async (server: Server) => {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

const logger = (entry: Record<string, unknown>) => logs.push(entry);

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
  logs.splice(0);
});

describe("local HTTP request logging", () => {
  it("logs the incoming request and its completed status with a shared request ID", async () => {
    const baseUrl = await start(createApp({}, undefined, logger));
    const response = await fetch(`${baseUrl}/health`);
    await response.text();

    expect(response.status).toBe(200);
    expect(logs).toEqual([
      { event: "request", requestId: expect.any(String), method: "GET", path: "/health" },
      { event: "response", requestId: expect.any(String), method: "GET", path: "/health", status: 200, durationMs: expect.any(Number) },
    ]);
    expect(logs[0].requestId).toBe(logs[1].requestId);
  });

  it("makes unmatched routes visible as 404 without logging request credentials", async () => {
    const baseUrl = await start(createApp({}, undefined, logger));
    const response = await fetch(`${baseUrl}/api/auth/register?token=query-secret`, {
      method: "POST",
      headers: { authorization: "Bearer access-secret", "content-type": "application/json", cookie: "session=cookie-secret" },
      body: JSON.stringify({ email: "private@example.test", password: "password-secret" }),
    });
    await response.text();

    expect(response.status).toBe(404);
    expect(logs[1]).toMatchObject({ event: "response", method: "POST", path: "/api/auth/register", status: 404, errorCode: "NotFound" });
    expect(JSON.stringify(logs)).not.toMatch(/query-secret|access-secret|cookie-secret|password-secret|private@example/);
  });

  it("redacts verification tokens and invitation codes embedded in paths", async () => {
    const baseUrl = await start(createApp({}, undefined, logger));
    await (await fetch(`${baseUrl}/auth/verify/email-secret`)).text();
    await (await fetch(`${baseUrl}/invite/private-code`)).text();

    expect(logs[0]).toMatchObject({ path: "/auth/verify/[REDACTED]" });
    expect(logs[2]).toMatchObject({ path: "/invite/[REDACTED]" });
    expect(JSON.stringify(logs)).not.toMatch(/email-secret|private-code/);
  });

  it("logs unexpected errors and returns a generic 500 instead of leaving the request open", async () => {
    const baseUrl = await start(createApp({}, async () => {
      throw new Error("mongodb://user:password-secret@host/ query-secret");
    }, logger));
    const response = await fetch(`${baseUrl}/profile`, { signal: AbortSignal.timeout(1000) });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: { code: "InternalServerError", message: "Unable to complete the request." } });
    expect(logs[1]).toMatchObject({ event: "error", errorName: "Error", method: "GET", path: "/profile" });
    expect(logs[2]).toMatchObject({ event: "response", status: 500, errorCode: "InternalServerError" });
    expect(JSON.stringify(logs)).not.toMatch(/password-secret|query-secret/);
  });
});
