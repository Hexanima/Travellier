import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { createApp, type ApiLogEntry } from "./app.js";

const servers: Server[] = [];
const frontendOrigin = "https://txz7v77k-5173.brs.devtunnels.ms";

const start = async (server: Server) => {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe("Node HTTP CORS", () => {
  it("answers preflight before authentication and logs its 204 status", async () => {
    const logs: ApiLogEntry[] = [];
    const baseUrl = await start(createApp({}, async () => {
      throw new Error("Preflight must not authenticate");
    }, (entry) => logs.push(entry), [frontendOrigin]));
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: "OPTIONS",
      headers: {
        origin: frontendOrigin,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type,authorization",
      },
    });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.get("access-control-allow-origin")).toBe(frontendOrigin);
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
    expect(response.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("authorization");
    expect(response.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("content-type");
    expect(logs[1]).toMatchObject({ event: "response", method: "OPTIONS", status: 204 });
  });

  it.each(["http://localhost:5173", "capacitor://localhost", "http://localhost"])(
    "allows the default development/native origin %s on real responses", async (origin) => {
      const baseUrl = await start(createApp());
      const response = await fetch(`${baseUrl}/health`, { headers: { origin } });

      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe(origin);
      expect(response.headers.get("vary")).toContain("Origin");
    },
  );

  it.each(["/auth/register", "/missing"])("keeps CORS headers on error responses for %s", async (path) => {
    const baseUrl = await start(createApp({}, undefined, undefined, [frontendOrigin]));
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { origin: frontendOrigin, "content-type": "application/json" },
      body: "{}",
    });

    expect(response.status).toBe(path === "/auth/register" ? 400 : 404);
    expect(response.headers.get("access-control-allow-origin")).toBe(frontendOrigin);
  });

  it("keeps CORS headers on unexpected 500 errors", async () => {
    const baseUrl = await start(createApp({}, async () => {
      throw new Error("Unexpected authentication failure");
    }, undefined, [frontendOrigin]));
    const response = await fetch(`${baseUrl}/profile`, { headers: { origin: frontendOrigin } });

    expect(response.status).toBe(500);
    expect(response.headers.get("access-control-allow-origin")).toBe(frontendOrigin);
  });

  it("does not grant browser access to an unlisted origin", async () => {
    const baseUrl = await start(createApp({}, undefined, undefined, [frontendOrigin]));
    const response = await fetch(`${baseUrl}/health`, { headers: { origin: "https://untrusted.example" } });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("preserves clients without an Origin header", async () => {
    const baseUrl = await start(createApp());
    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
});
