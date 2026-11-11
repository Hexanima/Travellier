import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";

import { createMongoRateLimitRepository, resetFilter } from "./rate-limit-repository.js";

const WINDOW = 15 * 60_000;
const NOW = new Date(Math.floor(Date.UTC(2026, 10, 10, 12, 0, 0) / WINDOW) * WINDOW + 60_000);
const after = (ms: number) => new Date(NOW.getTime() + ms);

describe("MongoDB rate limit repository", () => {
  let server: MongoMemoryServer, client: MongoClient, database: Db;
  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    client = new MongoClient(server.getUri());
    await client.connect();
    database = client.db("rate_limit_test");
  }, 120_000);
  afterAll(async () => { await client?.close(); await server?.stop(); });
  beforeEach(async () => { await database.collection("rateLimits").deleteMany({}); });

  const limiter = () => createMongoRateLimitRepository(database);
  const hit = (over: Record<string, unknown> = {}) =>
    limiter().hit({ bucket: "auth.login.ip", key: "k1", limit: 3, windowMs: WINDOW, now: NOW, ...over });
  const value = async (promise: ReturnType<typeof hit>) => {
    const result = await promise;
    if (!result.ok) throw new Error("expected ok");
    return result.value;
  };

  it("counts attempts and rejects past the limit, still counting the rejected ones", async () => {
    expect((await value(hit())).count).toBe(1);
    expect(await value(hit())).toMatchObject({ allowed: true, count: 2 });
    expect(await value(hit())).toMatchObject({ allowed: true, count: 3 });
    expect(await value(hit())).toMatchObject({ allowed: false, count: 4 });
  });

  it("answers the seconds left of the window", async () => {
    const decision = await value(hit({ now: after(1_000) }));
    expect(decision.retryAfterSeconds).toBe(Math.ceil((WINDOW - 61_000) / 1000));
    const edge = await value(hit({ now: new Date(NOW.getTime() - 60_000 + WINDOW - 1) }));
    expect(edge.retryAfterSeconds).toBe(1);
  });

  it("recovers when the next window starts", async () => {
    for (let i = 0; i < 4; i += 1) await hit();
    expect((await value(hit())).allowed).toBe(false);
    expect(await value(hit({ now: after(WINDOW) }))).toMatchObject({ allowed: true, count: 1 });
  });

  it("keeps buckets and keys independent", async () => {
    for (let i = 0; i < 4; i += 1) await hit();
    expect((await value(hit({ key: "k2" }))).count).toBe(1);
    expect((await value(hit({ bucket: "auth.refresh.ip" }))).count).toBe(1);
  });

  it("reset forgets one key only", async () => {
    for (let i = 0; i < 4; i += 1) await hit();
    await hit({ key: "k2" });
    expect((await limiter().reset({ bucket: "auth.login.ip", key: "k1" })).ok).toBe(true);
    expect((await value(hit())).count).toBe(1);
    expect((await value(hit({ key: "k2" }))).count).toBe(2);
  });

  it("reset removes every window of that bucket and key but not look-alike buckets or keys", async () => {
    const hits: [string, string, Date][] = [
      ["login", "k1", NOW], ["login", "k1", after(WINDOW)], ["login", "k1", after(3 * WINDOW)],
      ["login-ip", "k1", NOW], ["login:k1", "k", NOW], ["login", "k10", NOW], ["login", "k1x", NOW], ["login", "k", NOW], ["logon", "k1", NOW],
      ["a.b", "k1", NOW], ["aXb", "k1", NOW], ["a.b", "k1", after(WINDOW)],
    ];
    for (const [bucket, key, now] of hits) await hit({ bucket, key, now });
    expect((await limiter().reset({ bucket: "login", key: "k1" })).ok).toBe(true);
    expect((await limiter().reset({ bucket: "a.b", key: "k1" })).ok).toBe(true);
    const left = (await database.collection("rateLimits").find().toArray()).map((document) => [document.bucket, document.keyHash].join("|")).sort();
    expect(left).toEqual(["aXb|k1", "login-ip|k1", "login:k1|k", "login|k", "login|k1x", "login|k10", "logon|k1"].sort());
  });

  it("escapes regex metacharacters and anchors the _id prefix", () => {
    const pattern = new RegExp(resetFilter("a.b", "k(1)+")._id.$regex);
    expect(pattern.test("a.b:k(1)+:1700000000000")).toBe(true);
    expect(pattern.test("aXb:k(1)+:1700000000000")).toBe(false);
    expect(pattern.test("a.b:k1:1700000000000")).toBe(false);
    expect(pattern.test("x:a.b:k(1)+:1")).toBe(false);
  });

  it("reset filters by an anchored _id prefix so the _id index is used, not a collection scan", async () => {
    await hit();
    const explained = await database.command({
      explain: { delete: "rateLimits", deletes: [{ q: resetFilter("auth.login.ip", "k1"), limit: 0 }] },
      verbosity: "queryPlanner",
    });
    const plan = JSON.stringify(explained.queryPlanner.winningPlan);
    expect(plan).toContain("IXSCAN");
    expect(plan).not.toContain("COLLSCAN");
  });

  it("counts exactly under concurrency", async () => {
    const decisions = await Promise.all(Array.from({ length: 50 }, () => value(hit({ limit: 10 }))));
    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(10);
    expect(Math.max(...decisions.map((decision) => decision.count))).toBe(50);
    expect(await database.collection("rateLimits").countDocuments()).toBe(1);
  });

  it("stores only opaque data with an expiry after the window", async () => {
    await hit({ key: "0123456789abcdef0123456789abcdef" });
    const documents = await database.collection("rateLimits").find().toArray();
    expect(documents).toHaveLength(1);
    expect(Object.keys(documents[0]).sort()).toEqual(["_id", "bucket", "count", "expiresAt", "keyHash"]);
    expect(documents[0].expiresAt.getTime()).toBeGreaterThan(NOW.getTime() + WINDOW - 60_000);
    expect(JSON.stringify(documents[0])).not.toMatch(/@|\d+\.\d+\.\d+\.\d+/);
  });

  it("answers an error result when the database fails", async () => {
    const broken = createMongoRateLimitRepository({ collection: () => { throw new Error("mongodb://u:p@h"); } } as unknown as Db);
    const result = await broken.hit({ bucket: "b", key: "k", limit: 1, windowMs: 1000, now: NOW });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("u:p@h");
  });
});
