import { describe, expect, it } from "vitest";

import {
  bodyLimitFor,
  contentTypeProblem,
  payloadTooLargeResponse,
  readSecurityConfig,
  tooManyRequestsResponse,
  unsupportedMediaTypeResponse,
} from "./request-limits.js";

describe("readSecurityConfig", () => {
  it("uses documented defaults", () => {
    const config = readSecurityConfig({});
    expect(config).toMatchObject({ maxBodyBytes: 262_144, maxBodyBytesAuth: 16_384, rateLimitEnabled: true });
    expect(config.authRateLimit.failMode).toBe("open");
    expect(config.authRateLimit.login.account).toEqual({ limit: 5, windowMs: 900_000 });
    expect(config.authRateLimit.login.ip).toEqual({ limit: 30, windowMs: 900_000 });
    expect(config.authRateLimit.register.ip).toEqual({ limit: 10, windowMs: 3_600_000 });
    expect(config.authRateLimit.refresh.ip).toEqual({ limit: 60, windowMs: 900_000 });
  });

  it("reads overrides per environment", () => {
    const config = readSecurityConfig({
      MAX_BODY_BYTES: "4000", MAX_BODY_BYTES_AUTH: "2048", AUTH_RATE_LIMIT_ENABLED: "false", AUTH_RATE_LIMIT_FAIL_MODE: "closed",
      AUTH_RATE_LIMIT_LOGIN_ACCOUNT_MAX: "3", AUTH_RATE_LIMIT_LOGIN_ACCOUNT_WINDOW_SECONDS: "60",
      AUTH_RATE_LIMIT_LOGIN_IP_MAX: "7", AUTH_RATE_LIMIT_REGISTER_IP_MAX: "2", AUTH_RATE_LIMIT_REFRESH_IP_WINDOW_SECONDS: "30",
    });
    expect(config).toMatchObject({ maxBodyBytes: 4000, maxBodyBytesAuth: 2048, rateLimitEnabled: false });
    expect(config.authRateLimit.failMode).toBe("closed");
    expect(config.authRateLimit.login.account).toEqual({ limit: 3, windowMs: 60_000 });
    expect(config.authRateLimit.login.ip.limit).toBe(7);
    expect(config.authRateLimit.register.ip.limit).toBe(2);
    expect(config.authRateLimit.refresh.ip.windowMs).toBe(30_000);
  });

  it.each([
    ["MAX_BODY_BYTES", "abc"], ["MAX_BODY_BYTES", "0"], ["MAX_BODY_BYTES", "-5"], ["MAX_BODY_BYTES", "1048577"], ["MAX_BODY_BYTES", "1.5"],
    ["MAX_BODY_BYTES_AUTH", "10"], ["AUTH_RATE_LIMIT_ENABLED", "yes"], ["AUTH_RATE_LIMIT_FAIL_MODE", "maybe"],
    ["AUTH_RATE_LIMIT_LOGIN_ACCOUNT_MAX", "0"], ["AUTH_RATE_LIMIT_LOGIN_IP_WINDOW_SECONDS", "999999"],
  ])("rejects %s=%s naming the variable but not the value", (name, value) => {
    let message = "";
    try { readSecurityConfig({ [name]: value }); } catch (error) { message = (error as Error).message; }
    expect(message).toContain(name);
    expect(message).not.toContain(`${value}`.length > 3 ? value : "\u0000");
  });

  it("rejects an auth limit above the general limit", () => {
    expect(() => readSecurityConfig({ MAX_BODY_BYTES: "2000", MAX_BODY_BYTES_AUTH: "5000" })).toThrow("MAX_BODY_BYTES_AUTH");
  });
});

describe("bodyLimitFor", () => {
  const config = readSecurityConfig({});
  it("uses the small limit for auth and push device routes and the default for the rest", () => {
    for (const path of ["/auth/login", "/auth/register", "/auth/refresh", "/auth/logout", "/push-devices", "/push-devices/revoke", "/trips/join"]) {
      expect(bodyLimitFor(path, config)).toBe(16_384);
    }
    for (const path of ["/trips/507f1f77bcf86cd799439011/posts", "/notifications", "/trips"]) {
      expect(bodyLimitFor(path, config)).toBe(262_144);
    }
  });
});

describe("contentTypeProblem", () => {
  it("accepts JSON with or without charset and a missing header", () => {
    expect(contentTypeProblem(undefined)).toBe(false);
    expect(contentTypeProblem("application/json")).toBe(false);
    expect(contentTypeProblem("Application/JSON; charset=utf-8")).toBe(false);
  });
  it("rejects a present non JSON content type", () => {
    for (const value of ["text/plain", "application/x-www-form-urlencoded", "application/jsonp", "multipart/form-data; boundary=x", ""]) {
      expect(contentTypeProblem(value)).toBe(true);
    }
  });
});

describe("security responses", () => {
  it("builds 413, 415 and 429 with generic JSON errors and the retry header", () => {
    expect(payloadTooLargeResponse()).toMatchObject({ statusCode: 413, headers: { "content-type": "application/json" } });
    expect(JSON.parse(payloadTooLargeResponse().body)).toEqual({ error: { code: "PayloadTooLarge", message: "The request body is too large." } });
    expect(JSON.parse(unsupportedMediaTypeResponse().body).error.code).toBe("UnsupportedMediaType");
    expect(unsupportedMediaTypeResponse().statusCode).toBe(415);
    const limited = tooManyRequestsResponse(120);
    expect(limited.statusCode).toBe(429);
    expect(limited.headers).toEqual({ "content-type": "application/json", "retry-after": "120" });
    expect(JSON.parse(limited.body)).toEqual({ error: { code: "TooManyRequests", message: "Too many attempts. Try again later." } });
  });
});
