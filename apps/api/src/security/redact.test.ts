import { describe, expect, it } from "vitest";

import { redactForLog, redactPath, sanitizeErrorForLog } from "./redact.js";
import { redactingLogger } from "./redacting-logger.js";

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

  it("hides invitation code keys without touching similar field names", () => {
    expect(redactForLog({ code: "ABC123", inviteCode: "XYZ", invite: "I", invite_code: "J", errorCode: "NotFound", status: 404 })).toEqual({
      code: "[REDACTED]", inviteCode: "[REDACTED]", invite: "[REDACTED]", invite_code: "[REDACTED]", errorCode: "NotFound", status: 404,
    });
  });

  it("replaces credentials embedded in URL strings, at any depth", () => {
    expect(redactForLog("failed mongodb+srv://admin:p%40ss@cluster0.example.net/db?retryWrites=true"))
      .toBe("failed mongodb+srv://[REDACTED]@cluster0.example.net/db?retryWrites=true");
    expect(redactForLog({ a: [{ url: "https://token123@host.example/path" }], b: "see http://u:pw@h and amqp://x:y@z" })).toEqual({
      a: [{ url: "https://[REDACTED]@host.example/path" }],
      b: "see http://[REDACTED]@h and amqp://[REDACTED]@z",
    });
    expect(JSON.stringify(redactForLog({ stack: ["at connect (mongodb://user:secretpw@host/db)"] }))).not.toContain("secretpw");
  });

  it("leaves URLs without credentials and plain emails alone", () => {
    expect(redactForLog("https://example.test/path?x=1")).toBe("https://example.test/path?x=1");
    expect(redactForLog("user@example.test")).toBe("user@example.test");
  });

  it("keeps primitives", () => {
    expect([redactForLog(1), redactForLog(null), redactForLog(true)]).toEqual([1, null, true]);
  });
});

describe("redactingLogger", () => {
  it("passes every entry through redactForLog before emitting and keeps the entry fields", () => {
    const received: unknown[] = [];
    const logger = redactingLogger((entry: Record<string, unknown>) => received.push(entry))!;
    logger({ event: "error", requestId: "r", path: "/x", errorName: "E", stack: ["  at f (mongodb://u:pw@h/db)"], code: "INVITE" });
    expect(received).toEqual([{ event: "error", requestId: "r", path: "/x", errorName: "E", stack: ["  at f (mongodb://[REDACTED]@h/db)"], code: "[REDACTED]" }]);
  });

  it("returns undefined without a logger", () => {
    expect(redactingLogger(undefined)).toBeUndefined();
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
