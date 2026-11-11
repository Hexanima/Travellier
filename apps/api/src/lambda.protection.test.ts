import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { ApiLogEntry, handleApiRequest } from "./app.js";
import { createLambdaHandler, type ApiGatewayHttpApiEvent } from "./lambda.js";
import type { AuthRateLimiter } from "./security/auth-rate-limit.js";
import { readSecurityConfig } from "./security/request-limits.js";

const jwtSecret = "jwt-signing-secret";
const userId = "507f1f77bcf86cd799439011";
const runtimeConfig = { environment: "dev", mongo: { uri: "mongodb://example", databaseName: "test" }, jwtSecret, photoBucketName: "test" } as const;

const accessToken = (): string => {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: 1_900_000_000, tokenType: "access" })).toString("base64url");
  return `${header}.${payload}.${createHmac("sha256", jwtSecret).update(`${header}.${payload}`).digest("base64url")}`;
};

const event = (over: Partial<ApiGatewayHttpApiEvent> & { method?: string; sourceIp?: string; requestId?: string } = {}): ApiGatewayHttpApiEvent => {
  const { method = "POST", sourceIp = "198.51.100.7", requestId = "apigw-request-1", ...rest } = over;
  return {
    rawPath: "/auth/login",
    headers: { "content-type": "application/json" },
    requestContext: { http: { method, sourceIp }, requestId },
    ...rest,
  };
};

const loginBody = JSON.stringify({ email: "user@example.test", password: "SENTINEL-PASSWORD" });

describe("Lambda API protection (T102)", () => {
  const build = (extra: Partial<Parameters<typeof createLambdaHandler>[0]> = {}) => {
    const handleRequest = vi.fn<typeof handleApiRequest>(async () => ({ statusCode: 200, headers: { "content-type": "application/json" }, body: "{}" }));
    const logs: ApiLogEntry[] = [];
    const handler = createLambdaHandler({
      loadRuntimeConfig: async () => runtimeConfig,
      createAuthenticationApi: async () => ({}) as never,
      createTripApi: async () => ({ joinByCode: vi.fn() }),
      createPushDeviceApi: async () => ({}) as never,
      handleRequest,
      logger: (entry) => logs.push(entry),
      ...extra,
    });
    return { handler, handleRequest, logs };
  };

  it("uses the API Gateway request id and returns it as x-request-id", async () => {
    const { handler, logs } = build();
    const response = await handler(event({ body: loginBody }));
    expect(response.headers["x-request-id"]).toBe("apigw-request-1");
    expect(logs.map((entry) => [entry.event, entry.requestId])).toEqual([["request", "apigw-request-1"], ["response", "apigw-request-1"]]);
    expect(logs[1]).toMatchObject({ method: "POST", path: "/auth/login", status: 200 });
    expect(typeof logs[1].durationMs).toBe("number");
  });

  it("generates a request id when the event carries none", async () => {
    const { handler } = build();
    const response = await handler({ ...event({ body: loginBody }), requestContext: { http: { method: "POST", sourceIp: "1.1.1.1" } } });
    expect(response.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("passes sourceIp and content-type to the request handler, ignoring X-Forwarded-For", async () => {
    const { handler, handleRequest } = build();
    await handler(event({ body: loginBody, headers: { "content-type": "application/json", "x-forwarded-for": "6.6.6.6" } }));
    expect(handleRequest.mock.calls[0][0]).toMatchObject({ clientIp: "198.51.100.7", contentType: "application/json" });
    expect(JSON.stringify(handleRequest.mock.calls[0][0])).not.toContain("6.6.6.6");
  });

  it("rejects an oversized body with 413 without calling the handler or parsing it", async () => {
    const { handler, handleRequest, logs } = build();
    const response = await handler(event({ body: JSON.stringify({ filler: "x".repeat(20_000) }) }));
    expect(response.statusCode).toBe(413);
    expect(JSON.parse(response.body).error.code).toBe("PayloadTooLarge");
    expect(response.headers["x-request-id"]).toBe("apigw-request-1");
    expect(handleRequest).not.toHaveBeenCalled();
    expect(logs.find((entry) => entry.event === "response")).toMatchObject({ status: 413, errorCode: "PayloadTooLarge" });
  });

  it("rejects a huge base64 body with 413 before decoding it", async () => {
    const decode = vi.spyOn(Buffer, "from");
    const { handler, handleRequest } = build();
    const body = "A".repeat(2 * 1024 * 1024);
    const response = await handler(event({ body, isBase64Encoded: true, rawPath: "/trips/507f1f77bcf86cd799439011/posts", headers: { authorization: `Bearer ${accessToken()}` } }));
    expect(response.statusCode).toBe(413);
    expect(handleRequest).not.toHaveBeenCalled();
    expect((decode.mock.calls as unknown[][]).some(([value, encoding]) => encoding === "base64" && typeof value === "string" && value.length > 1024 * 1024)).toBe(false);
    decode.mockRestore();
  });

  it("applies the larger default limit to content routes and the small one to auth routes", async () => {
    const { handler, handleRequest } = build();
    const filler = JSON.stringify({ filler: "x".repeat(20_000) });
    expect((await handler(event({ body: filler, rawPath: "/trips/507f1f77bcf86cd799439011/posts", headers: { authorization: `Bearer ${accessToken()}`, "content-type": "application/json" } }))).statusCode).toBe(200);
    expect(handleRequest).toHaveBeenCalledTimes(1);
  });

  it("measures the decoded size of a base64 body", async () => {
    const { handler, handleRequest } = build({ security: readSecurityConfig({ MAX_BODY_BYTES: "4000", MAX_BODY_BYTES_AUTH: "2000" }) });
    const small = Buffer.from(loginBody).toString("base64");
    expect((await handler(event({ body: small, isBase64Encoded: true }))).statusCode).toBe(200);
    expect(handleRequest.mock.calls[0][0].body).toBe(loginBody);
    const fits = Buffer.from("y".repeat(2500)).toString("base64");
    expect(fits.length).toBeGreaterThan(2000);
    expect((await handler(event({ body: fits, isBase64Encoded: true }))).statusCode).toBe(413);
  });

  it("answers 400 for an invalid base64 body without calling the handler", async () => {
    const { handler, handleRequest } = build();
    const response = await handler(event({ body: "not base64 !!!", isBase64Encoded: true }));
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error.code).toBe("InvalidRequest");
    expect(handleRequest).not.toHaveBeenCalled();
  });

  it("logs neither Authorization nor the body, also when the handler throws", async () => {
    const throwing = vi.fn(async () => { throw new Error("mongodb://user:SENTINEL-DB-PASSWORD@host"); });
    const { handler, logs } = build({ handleRequest: throwing });
    await expect(handler(event({ body: loginBody, rawPath: "/auth/verify/SENTINEL-VERIFY-TOKEN", method: "GET" }))).rejects.toThrow();
    const serialized = JSON.stringify(logs);
    for (const secret of ["SENTINEL", "Bearer", "user@example.test"]) expect(serialized).not.toContain(secret);
    expect(logs.map((entry) => entry.event)).toEqual(["request", "error"]);
    expect(logs[1].errorName).toBe("Error");
    expect(logs[0].path).toBe("/auth/verify/[REDACTED]");
  });

  it("gives the rate limiter to the authentication routes only when it is configured", async () => {
    const limiter: AuthRateLimiter = { check: vi.fn(async () => ({ allowed: true as const })), succeeded: vi.fn(async () => undefined) };
    const createRateLimiter = vi.fn(async () => limiter);
    const { handler, handleRequest } = build({ createRateLimiter });
    await handler(event({ body: loginBody }));
    expect(handleRequest.mock.calls[0][1]).toMatchObject({ rateLimiter: limiter });
    expect(createRateLimiter).toHaveBeenCalledTimes(1);

    const none = build({ createRateLimiter: async () => undefined });
    await none.handler(event({ body: loginBody }));
    expect(none.handleRequest.mock.calls[0][1]).not.toHaveProperty("rateLimiter");

    const other = build({ createRateLimiter });
    await other.handler(event({ method: "GET", rawPath: "/invite/CODE" }));
    expect(other.handleRequest.mock.calls[0][1]).not.toHaveProperty("rateLimiter");
  });

  it("a real limiter through handleApiRequest answers 429 with Retry-After", async () => {
    const limiter: AuthRateLimiter = { check: vi.fn(async () => ({ allowed: false as const, retryAfterSeconds: 77 })), succeeded: vi.fn() };
    const login = vi.fn();
    const handler = createLambdaHandler({
      loadRuntimeConfig: async () => runtimeConfig,
      createAuthenticationApi: async () => ({ login }) as never,
      createRateLimiter: async () => limiter,
    });
    const response = await handler(event({ body: loginBody }));
    expect(response.statusCode).toBe(429);
    expect(response.headers["retry-after"]).toBe("77");
    expect(login).not.toHaveBeenCalled();
    expect(limiter.check).toHaveBeenCalledWith("login", { ip: "198.51.100.7", email: "user@example.test" });
  });
});
