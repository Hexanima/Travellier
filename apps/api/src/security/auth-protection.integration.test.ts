import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { AddressInfo } from "node:net";
import { err, InvalidCredentialsError, ok } from "app-domain";

import { createApp, handleApiRequest, type ApiDependencies, type ApiLogEntry, type AuthenticationApi, type TripApi } from "../app.js";
import { createMongoRateLimitRepository } from "../adapters/mongodb/rate-limit-repository.js";
import { migrateMongoSchema } from "../adapters/mongodb/migrations.js";
import { createAuthRateLimiter, defaultAuthRateLimitConfig } from "./auth-rate-limit.js";

const OBJECT_ID = "507f1f77bcf86cd799439011";
const PASSWORD = "SENTINEL-PASSWORD-1f2e3d4c";
const REFRESH = "SENTINEL-REFRESH-9a8b7c6d";
const EMAIL = "victim.sentinel@example.test";
const JSON_HEADERS = { "content-type": "application/json" };
const MINUTE = 60_000;

describe("API protection over a real HTTP server", () => {
  let mongo: MongoMemoryServer, client: MongoClient, database: Db, clock: number;
  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    client = new MongoClient(mongo.getUri());
    await client.connect();
    database = client.db("auth_protection");
    await migrateMongoSchema(database);
  }, 120_000);
  afterAll(async () => { await client?.close(); await mongo?.stop(); });
  beforeEach(async () => { clock = Date.UTC(2026, 10, 10, 12, 0, 0); await database.collection("rateLimits").deleteMany({}); });

  const spies = () => ({
    login: vi.fn(async ({ email, password }: { email: string; password: string }) =>
      email === "good@example.test" && password === "right" ? ok({ accessToken: "a", refreshToken: "r" } as never) : err(new InvalidCredentialsError())),
    register: vi.fn(async () => err(new InvalidCredentialsError())),
    refresh: vi.fn(async () => err(new InvalidCredentialsError())),
    logout: vi.fn(async () => ok(undefined)),
    registerDevice: vi.fn(async () => ok({} as never)),
    setParticipation: vi.fn(async () => ok({} as never)),
    createPost: vi.fn(async () => ok({} as never)),
    listNotifications: vi.fn(async () => ok({} as never)),
  });
  const limiter = () => createAuthRateLimiter({
    port: createMongoRateLimitRepository(database), secret: "integration-secret", config: defaultAuthRateLimitConfig, now: () => new Date(clock),
  });
  const dependencies = (s: ReturnType<typeof spies>): ApiDependencies => ({
    auth: { login: s.login, register: s.register, refresh: s.refresh, logout: s.logout } as unknown as AuthenticationApi,
    trips: { setActivityParticipation: s.setParticipation, createPost: s.createPost, listNotifications: s.listNotifications } as unknown as TripApi,
    pushDevices: { register: s.registerDevice, revoke: vi.fn(), revokeByToken: vi.fn() },
    rateLimiter: limiter(),
  });

  let close: (() => Promise<void>) | undefined;
  let base: string;
  let logs: ApiLogEntry[];
  const serve = async (s: ReturnType<typeof spies>) => {
    logs = [];
    const app = createApp(dependencies(s), async () => ({ authenticatedUserId: OBJECT_ID as never }), (entry) => logs.push(entry));
    await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
    close = () => new Promise<void>((resolve) => app.close(() => resolve()));
  };
  afterEach(async () => { await close?.(); close = undefined; });

  const login = (email: string, password = "wrong") =>
    fetch(`${base}/auth/login`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ email, password }) });

  it("answers 429 with Retry-After on the sixth login of one email and does not reach the handler", async () => {
    const s = spies();
    await serve(s);
    for (let i = 0; i < 5; i += 1) expect((await login(EMAIL, PASSWORD)).status).toBe(401);
    const limited = await login(EMAIL, PASSWORD);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBe(15 * 60);
    expect(limited.headers.get("content-type")).toBe("application/json");
    expect(limited.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(await limited.json()).toEqual({ error: { code: "TooManyRequests", message: "Too many attempts. Try again later." } });
    expect(s.login).toHaveBeenCalledTimes(5);
  });

  it("does not limit another email from the same IP, nor another IP for the same email", async () => {
    const s = spies();
    await serve(s);
    for (let i = 0; i < 6; i += 1) await login(EMAIL, PASSWORD);
    expect((await login("other@example.test")).status).toBe(401);
    const otherIp = await handleApiRequest(
      { method: "POST", url: "/auth/login", body: { email: EMAIL, password: PASSWORD }, clientIp: "203.0.113.9" }, dependencies(s));
    expect(otherIp.statusCode).toBe(401);
  });

  it("recovers when the window passes", async () => {
    const s = spies();
    await serve(s);
    for (let i = 0; i < 6; i += 1) await login(EMAIL, PASSWORD);
    expect((await login(EMAIL, PASSWORD)).status).toBe(429);
    clock += 16 * MINUTE;
    expect((await login(EMAIL, PASSWORD)).status).toBe(401);
  });

  it("a successful login resets the IP plus email counter", async () => {
    const s = spies();
    await serve(s);
    for (let i = 0; i < 4; i += 1) await login("good@example.test");
    expect((await login("good@example.test", "right")).status).toBe(200);
    for (let i = 0; i < 5; i += 1) expect((await login("good@example.test")).status).toBe(401);
    expect((await login("good@example.test")).status).toBe(429);
  });

  it("limits register by IP and refresh/logout share a counter", async () => {
    const s = spies();
    await serve(s);
    const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) statuses.push((await post("/auth/register", { email: `n${i}@example.test`, password: PASSWORD })).status);
    expect(statuses.slice(0, 10).every((status) => status !== 429)).toBe(true);
    expect(statuses[10]).toBe(429);
    for (let i = 0; i < 60; i += 1) await post(i % 2 === 0 ? "/auth/refresh" : "/auth/logout", { refreshToken: REFRESH });
    expect((await post("/auth/logout", { refreshToken: REFRESH })).status).toBe(429);
  });

  it("rejects a 1 MiB body with 413 and an x-request-id, without calling any handler", async () => {
    const s = spies();
    await serve(s);
    const big = JSON.stringify({ filler: "x".repeat(1024 * 1024) });
    const requests: [string, string][] = [
      ["POST", "/auth/login"], ["PUT", "/push-devices"], ["PUT", `/trips/${OBJECT_ID}/activities/${OBJECT_ID}/participation`],
      ["POST", `/trips/${OBJECT_ID}/posts`], ["GET", "/notifications"], ["POST", "/auth/register"],
    ];
    for (const [method, path] of requests) {
      // fetch refuses a body on GET, so every oversized request goes through http.request.
      const response = await rawRequest(method, `${base}${path}`, big);
      expect(response.status, `${method} ${path}`).toBe(413);
      expect(response.requestId).toBeTruthy();
      expect(JSON.parse(response.text)).toEqual({ error: { code: "PayloadTooLarge", message: "The request body is too large." } });
    }
    for (const spy of Object.values(s)) expect(spy).not.toHaveBeenCalled();
    expect(logs.filter((entry) => entry.event === "response" && entry.status === 413)).toHaveLength(requests.length);
    expect(logs.find((entry) => entry.status === 413)?.errorCode).toBe("PayloadTooLarge");
  }, 30_000);

  it("answers 413 to a chunked body without Content-Length that exceeds the limit, and the client receives it", async () => {
    const s = spies();
    await serve(s);
    const chunk = Buffer.alloc(8 * 1024, 120);
    const response = await chunkedRequest(`${base}/auth/login`, chunk, 64);
    expect(response.status).toBe(413);
    expect(response.requestId).toBeTruthy();
    expect(JSON.parse(response.text)).toEqual({ error: { code: "PayloadTooLarge", message: "The request body is too large." } });
    expect(s.login).not.toHaveBeenCalled();
    expect(logs.find((entry) => entry.event === "response" && entry.status === 413)?.errorCode).toBe("PayloadTooLarge");
  }, 30_000);

  it("applies the small limit to auth routes and accepts a larger legitimate body on a content route", async () => {
    const s = spies();
    await serve(s);
    const filler = JSON.stringify({ filler: "x".repeat(20_000) });
    expect((await fetch(`${base}/auth/login`, { method: "POST", headers: JSON_HEADERS, body: filler })).status).toBe(413);
    const post = await fetch(`${base}/trips/${OBJECT_ID}/posts`, { method: "POST", headers: JSON_HEADERS, body: filler });
    expect(post.status).not.toBe(413);
  });

  it("answers 415 only when a content type is present and is not JSON", async () => {
    const s = spies();
    await serve(s);
    const body = new TextEncoder().encode(JSON.stringify({ email: EMAIL, password: PASSWORD }));
    const plain = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "text/plain" }, body });
    expect(plain.status).toBe(415);
    expect(s.login).not.toHaveBeenCalled();
    const charset = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body });
    expect(charset.status).toBe(401);
    const missing = await fetch(`${base}/auth/login`, { method: "POST", body });
    expect(missing.status).toBe(401);
  });

  it("never writes credentials, tokens or emails to the logs, also on 429 and 413", async () => {
    const s = spies();
    await serve(s);
    for (let i = 0; i < 6; i += 1) await login(EMAIL, PASSWORD);
    await fetch(`${base}/auth/logout`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ refreshToken: REFRESH, filler: "x".repeat(40_000) }) });
    expect(logs.some((entry) => entry.status === 429)).toBe(true);
    expect(logs.some((entry) => entry.status === 413)).toBe(true);
    const serialized = JSON.stringify(logs);
    for (const secret of [PASSWORD, REFRESH, EMAIL, "SENTINEL"]) expect(serialized).not.toContain(secret);
  });

  it("stores no email or IP in clear in the shared counters", async () => {
    const s = spies();
    await serve(s);
    for (let i = 0; i < 2; i += 1) await login(EMAIL, PASSWORD);
    const stored = JSON.stringify(await database.collection("rateLimits").find().toArray());
    expect(stored).not.toMatch(/sentinel|example|127\.0\.0\.1/i);
  });
});

import { request as httpRequest, type ClientRequest, type RequestOptions } from "node:http";

type RawResponse = { status: number; text: string; requestId: string | undefined };

/**
 * Sends a request and resolves with the response. The server may answer 413 and close without reading the body, so EPIPE/ECONNRESET raised
 * by the request writer after the response arrived are expected and ignored; any error before a response (or a response that never
 * completes) still rejects.
 */
function sendRequest(options: RequestOptions, url: string, write: (req: ClientRequest) => void): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const done = (action: () => void) => { if (!finished) { finished = true; action(); } };
    const req = httpRequest(url, options, (response) => {
      let text = "";
      response.on("data", (chunk: Buffer) => { text += chunk.toString("utf8"); });
      response.on("end", () => done(() => resolve(
        { status: response.statusCode ?? 0, text, requestId: response.headers["x-request-id"] as string | undefined })));
      // A response cut off before its end is a real failure.
      response.on("error", (error) => done(() => reject(error)));
      response.on("close", () => done(() => reject(new Error("response closed before it ended"))));
    });
    req.on("error", (error: NodeJS.ErrnoException) => {
      const lateWriterError = error.code === "EPIPE" || error.code === "ECONNRESET";
      // With a response already started, the outcome is decided by the response events above.
      if (!(lateWriterError && req.res !== undefined)) done(() => reject(error));
    });
    write(req);
  });
}

function rawRequest(method: string, url: string, body: string): Promise<RawResponse> {
  return sendRequest(
    { method, headers: { ...JSON_HEADERS, authorization: "Bearer t", "content-length": Buffer.byteLength(body) } }, url, (req) => req.end(body));
}

/** Streams `count` chunks with Transfer-Encoding: chunked (no Content-Length). */
function chunkedRequest(url: string, chunk: Buffer, count: number): Promise<RawResponse> {
  return sendRequest({ method: "POST", headers: { ...JSON_HEADERS } }, url, (req) => {
    let sent = 0;
    const next = () => {
      if (req.destroyed || sent >= count) { if (!req.destroyed) req.end(); return; }
      sent += 1;
      if (req.write(chunk)) setImmediate(next); else req.once("drain", next);
    };
    next();
  });
}
