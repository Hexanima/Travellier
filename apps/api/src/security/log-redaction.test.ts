import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./redact.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./redact.js")>();
  return { ...actual, redactForLog: vi.fn(actual.redactForLog) };
});

import { createApp } from "../app.js";
import { createLambdaHandler } from "../lambda.js";
import { redactForLog } from "./redact.js";

const spy = vi.mocked(redactForLog);

afterEach(() => spy.mockClear());

describe("loggers pass every event through redactForLog (defense in depth)", () => {
  it("local server: request and response events", async () => {
    const logs: unknown[] = [];
    const server = createApp({}, undefined, (entry) => logs.push(entry));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/nothing`);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    expect(logs).toHaveLength(2);
    expect(spy.mock.calls.map(([entry]) => (entry as { event: string }).event)).toEqual(["request", "response"]);
  });

  it("Lambda: request and response events", async () => {
    const logs: unknown[] = [];
    const handler = createLambdaHandler({
      loadRuntimeConfig: async () => ({ environment: "dev", mongo: { uri: "mongodb://example", databaseName: "t" }, jwtSecret: "s", photoBucketName: "b" }) as never,
      createAuthenticationApi: async () => ({}) as never,
      createTripApi: async () => ({}) as never,
      createPushDeviceApi: async () => ({}) as never,
      handleRequest: async () => ({ statusCode: 200, headers: {}, body: "{}" }),
      logger: (entry) => logs.push(entry),
    });
    await handler({ rawPath: "/x", headers: {}, requestContext: { http: { method: "GET", sourceIp: "1.1.1.1" }, requestId: "r1" } } as never);
    expect(logs).toHaveLength(2);
    expect(spy.mock.calls.map(([entry]) => (entry as { event: string }).event)).toEqual(["request", "response"]);
  });
});
