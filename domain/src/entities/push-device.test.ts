import { describe, expect, it } from "vitest";

import { MAX_PUSH_DEVICES_PER_USER, maskPushToken, validatePushDeviceInput } from "./push-device.js";
import type { ValidationError } from "../errors/validation-error.js";

const token = "fAkE-token_0123456789:APA91bH";

const issuesOf = (input: unknown): { field: string; code: string }[] => {
  const result = validatePushDeviceInput(input);
  if (result.ok) throw new Error("expected a validation error");
  return (result.error as ValidationError).issues.map(({ field, code }) => ({ field, code }));
};

describe("validatePushDeviceInput", () => {
  it("accepts fcm on android and apns on ios", () => {
    expect(validatePushDeviceInput({ provider: "fcm", platform: "android", token })).toEqual({ ok: true, value: { provider: "fcm", platform: "android", token } });
    expect(validatePushDeviceInput({ provider: "apns", platform: "ios", token })).toEqual({ ok: true, value: { provider: "apns", platform: "ios", token } });
  });

  it("trims the token and ignores unknown fields", () => {
    const result = validatePushDeviceInput({ provider: "fcm", platform: "android", token: `  ${token}\n`, userId: "x", id: "y" });
    expect(result).toEqual({ ok: true, value: { provider: "fcm", platform: "android", token } });
  });

  it("rejects incompatible provider and platform pairs", () => {
    expect(issuesOf({ provider: "fcm", platform: "ios", token })).toEqual([{ field: "platform", code: "incompatible" }]);
    expect(issuesOf({ provider: "apns", platform: "android", token })).toEqual([{ field: "platform", code: "incompatible" }]);
  });

  it("rejects unknown or missing provider and platform", () => {
    expect(issuesOf({ provider: "sns", platform: "android", token })).toEqual([{ field: "provider", code: "invalid" }]);
    expect(issuesOf({ provider: "fcm", platform: "web", token })).toEqual([{ field: "platform", code: "invalid" }]);
    expect(issuesOf({ token })).toEqual([{ field: "provider", code: "invalid" }, { field: "platform", code: "invalid" }]);
  });

  it("rejects empty, blank, spaced, control, too long and non-string tokens", () => {
    const base = { provider: "fcm", platform: "android" };
    for (const bad of ["", "   ", "ab cd", "ab\tcd", "ab\u0000cd", "tökén", "a".repeat(4097), 123, null, undefined, {}]) {
      expect(issuesOf({ ...base, token: bad }).map((issue) => issue.field)).toEqual(["token"]);
    }
    expect(validatePushDeviceInput({ ...base, token: "a".repeat(4096) }).ok).toBe(true);
  });

  it("rejects a non-object input", () => {
    for (const bad of [null, undefined, "x", 3, []]) expect(issuesOf(bad).length).toBeGreaterThan(0);
  });

  it("never echoes the token in the messages", () => {
    const result = validatePushDeviceInput({ provider: "fcm", platform: "ios", token });
    expect(JSON.stringify(result)).not.toContain(token);
  });
});

describe("maskPushToken", () => {
  it("shows only the last four characters", () => {
    const hint = maskPushToken(token);
    expect(hint.endsWith(token.slice(-4))).toBe(true);
    expect(hint).not.toContain(token.slice(0, -4));
  });

  it("hides short tokens entirely", () => {
    expect(maskPushToken("abcd1234")).not.toContain("1234");
    expect(maskPushToken("abc")).not.toContain("abc");
  });
});

describe("MAX_PUSH_DEVICES_PER_USER", () => {
  it("is the provisional limit of 10", () => {
    expect(MAX_PUSH_DEVICES_PER_USER).toBe(10);
  });
});
