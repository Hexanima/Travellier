import { describe, expect, it } from "vitest";
import { err, ok, UnknownError, type RateLimitHit, type RateLimitPort } from "app-domain";

import { createAuthRateLimiter, defaultAuthRateLimitConfig, type AuthRateLimitConfig } from "./auth-rate-limit.js";

const NOW = new Date("2026-11-10T12:00:00.000Z");
const SECRET = "test-secret-not-real";

const fakePort = (options: { fail?: boolean; throws?: boolean } = {}) => {
  const counts = new Map<string, number>();
  const hits: RateLimitHit[] = [];
  const resets: { bucket: string; key: string }[] = [];
  const port: RateLimitPort = {
    hit: async (input) => {
      hits.push(input);
      if (options.throws) throw new Error("mongodb://u:p@h");
      if (options.fail) return err(new UnknownError("down"));
      const id = `${input.bucket}:${input.key}`;
      const count = (counts.get(id) ?? 0) + 1;
      counts.set(id, count);
      return ok({ allowed: count <= input.limit, count, retryAfterSeconds: 42 });
    },
    reset: async (input) => { resets.push(input); counts.delete(`${input.bucket}:${input.key}`); return ok(undefined); },
  };
  return { port, hits, resets };
};

const create = (port: RateLimitPort, config: Partial<AuthRateLimitConfig> = {}, errors: string[] = []) =>
  createAuthRateLimiter({ port, secret: SECRET, config: { ...defaultAuthRateLimitConfig, ...config }, now: () => NOW, onError: (name) => errors.push(name) });

describe("auth rate limiter", () => {
  it("limits login by IP plus email and rejects the sixth attempt with the window delay", async () => {
    const { port } = fakePort();
    const limiter = create(port);
    for (let i = 0; i < 5; i += 1) expect(await limiter.check("login", { ip: "1.2.3.4", email: "a@b.com" })).toEqual({ allowed: true });
    expect(await limiter.check("login", { ip: "1.2.3.4", email: "a@b.com" })).toEqual({ allowed: false, retryAfterSeconds: 42 });
  });

  it("does not affect another email or another IP", async () => {
    const { port } = fakePort();
    const limiter = create(port);
    for (let i = 0; i < 6; i += 1) await limiter.check("login", { ip: "1.2.3.4", email: "a@b.com" });
    expect(await limiter.check("login", { ip: "1.2.3.4", email: "other@b.com" })).toEqual({ allowed: true });
    expect(await limiter.check("login", { ip: "5.6.7.8", email: "a@b.com" })).toEqual({ allowed: true });
  });

  it("limits by IP regardless of the email", async () => {
    const { port } = fakePort();
    const limiter = create(port, { login: { ip: { limit: 3, windowMs: 1000 }, account: { limit: 100, windowMs: 1000 } } });
    for (let i = 0; i < 3; i += 1) expect(await limiter.check("login", { ip: "1.1.1.1", email: `u${i}@b.com` })).toEqual({ allowed: true });
    expect(await limiter.check("login", { ip: "1.1.1.1", email: "u9@b.com" })).toMatchObject({ allowed: false });
  });

  it("normalizes the email and never stores the email or the IP in clear", async () => {
    const { port, hits } = fakePort();
    const limiter = create(port);
    await limiter.check("login", { ip: "1.2.3.4", email: "  User@Example.COM " });
    await limiter.check("login", { ip: "1.2.3.4", email: "user@example.com" });
    const account = hits.filter((hit) => hit.bucket === "auth.login.account");
    expect(account).toHaveLength(2);
    expect(account[0].key).toBe(account[1].key);
    expect(account[0].key).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(hits)).not.toMatch(/example|1\.2\.3\.4/i);
    expect(hits[0].now).toBe(NOW);
  });

  it("keys depend on the secret", async () => {
    const first = fakePort(), second = fakePort();
    await create(first.port).check("register", { ip: "1.2.3.4" });
    await createAuthRateLimiter({ port: second.port, secret: "another", config: defaultAuthRateLimitConfig, now: () => NOW }).check("register", { ip: "1.2.3.4" });
    expect(first.hits[0].key).not.toBe(second.hits[0].key);
  });

  it("register, refresh and logout use IP buckets; logout shares refresh", async () => {
    const { port, hits } = fakePort();
    const limiter = create(port);
    await limiter.check("register", { ip: "1.2.3.4" });
    await limiter.check("refresh", { ip: "1.2.3.4" });
    await limiter.check("logout", { ip: "1.2.3.4" });
    expect(hits.map((hit) => hit.bucket)).toEqual(["auth.register.ip", "auth.refresh.ip", "auth.refresh.ip"]);
    expect(hits[0]).toMatchObject({ limit: 10, windowMs: 3_600_000 });
    expect(hits[1]).toMatchObject({ limit: 60, windowMs: 900_000 });
    expect(hits[1].key).toBe(hits[2].key);
  });

  it("a successful login resets only the IP plus email counter, never the IP", async () => {
    const { port, resets, hits } = fakePort();
    const limiter = create(port);
    await limiter.check("login", { ip: "1.2.3.4", email: "a@b.com" });
    await limiter.succeeded("login", { ip: "1.2.3.4", email: "a@b.com" });
    expect(resets).toEqual([{ bucket: "auth.login.account", key: hits.find((hit) => hit.bucket === "auth.login.account")!.key }]);
    await limiter.succeeded("register", { ip: "1.2.3.4" });
    expect(resets).toHaveLength(1);
  });

  it("fails open by default and reports only the error name", async () => {
    const errors: string[] = [];
    const limiter = create(fakePort({ fail: true }).port, {}, errors);
    expect(await limiter.check("login", { ip: "1.2.3.4", email: "a@b.com" })).toEqual({ allowed: true });
    const thrown = create(fakePort({ throws: true }).port, {}, errors);
    expect(await thrown.check("register", { ip: "1.2.3.4" })).toEqual({ allowed: true });
    expect(errors).toEqual(["UnknownError", "Error"]);
    expect(JSON.stringify(errors)).not.toContain("mongodb://");
  });

  it("fails closed when configured", async () => {
    const limiter = create(fakePort({ fail: true }).port, { failMode: "closed" });
    expect(await limiter.check("register", { ip: "1.2.3.4" })).toMatchObject({ allowed: false });
  });

  it("uses an unknown bucket key when the IP is missing instead of skipping the limit", async () => {
    const { port, hits } = fakePort();
    await create(port).check("register", { ip: undefined });
    expect(hits).toHaveLength(1);
  });

  it("rejects an empty secret without echoing it", () => {
    expect(() => createAuthRateLimiter({ port: fakePort().port, secret: "", config: defaultAuthRateLimitConfig })).toThrow("secret");
  });
});
