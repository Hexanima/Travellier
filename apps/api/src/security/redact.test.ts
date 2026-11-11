import { describe, expect, it } from "vitest";

import { redactForLog, redactPath, sanitizeErrorForLog } from "./redact.js";

describe("redactForLog", () => {
  it("replaces values of sensitive keys at any depth", () => {
    const result = redactForLog({
      email: "a@b.com",
      password: "hunter2",
      nested: { refreshToken: "r", Authorization: "Bearer x", apiKey: "k", private_key: "p", cookie: "c", clientSecret: "s", credentials: "c" },
      list: [{ accessToken: "t" }],
    });
    expect(result).toEqual({
      email: "a@b.com",
      password: "[REDACTED]",
      nested: {
        refreshToken: "[REDACTED]", Authorization: "[REDACTED]", apiKey: "[REDACTED]", private_key: "[REDACTED]",
        cookie: "[REDACTED]", clientSecret: "[REDACTED]", credentials: "[REDACTED]",
      },
      list: [{ accessToken: "[REDACTED]" }],
    });
  });

  it("bounds strings, depth and cycles", () => {
    const cyclic: Record<string, unknown> = { name: "x" };
    cyclic.self = cyclic;
    expect(redactForLog(cyclic)).toEqual({ name: "x", self: "[Circular]" });
    expect((redactForLog("a".repeat(500)) as string).length).toBeLessThanOrEqual(215);
    const deep = { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } };
    expect(JSON.stringify(redactForLog(deep))).toContain("[Truncated]");
  });

  it("keeps primitives", () => {
    expect([redactForLog(1), redactForLog(null), redactForLog(true)]).toEqual([1, null, true]);
  });
});

describe("sanitizeErrorForLog", () => {
  it("drops the message, which can carry connection strings", () => {
    const error = new Error("connect failed mongodb://user:pw@host/db");
    error.name = "MongoServerSelectionError";
    const sanitized = sanitizeErrorForLog(error);
    expect(sanitized.errorName).toBe("MongoServerSelectionError");
    expect(sanitized.stack?.every((line) => /^\s+at /.test(line))).toBe(true);
    expect(JSON.stringify(sanitized)).not.toContain("pw@host");
  });

  it("names non-Error throwables generically", () => {
    expect(sanitizeErrorForLog("secret")).toEqual({ errorName: "UnknownError" });
  });
});

describe("redactPath", () => {
  it("hides verification and invitation tokens and drops the query", () => {
    expect(redactPath("/auth/verify/abc123?x=1")).toBe("/auth/verify/[REDACTED]");
    expect(redactPath("/invite/CODE9")).toBe("/invite/[REDACTED]");
    expect(redactPath(undefined)).toBe("/");
  });
});
