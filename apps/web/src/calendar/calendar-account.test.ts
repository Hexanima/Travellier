import { describe, expect, it } from "vitest";
import { accountIdFromAccessToken } from "./calendar-account.js";

const b64url = (value: object) => btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jwt = (payload: object) => `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.signature`;

describe("accountIdFromAccessToken", () => {
  it("reads the sub claim without verifying the signature (it is not a secret)", () => {
    expect(accountIdFromAccessToken(jwt({ sub: "64b0c0ffee00000000000001", exp: 1 }))).toBe("64b0c0ffee00000000000001");
  });
  it("answers null for anything that is not a usable token, instead of guessing an account", () => {
    for (const token of [undefined, null, "", "abc", "a.b", "a.b.c", `x.${b64url({ sub: 5 })}.y`, `x.${b64url({ sub: "" })}.y`, `x.${b64url({})}.y`, `x.${"%%%"}.y`, `x.${btoa("[1]")}.y`, `x.${btoa("no json")}.y`]) {
      expect(accountIdFromAccessToken(token)).toBeNull();
    }
  });
  it("rejects absurdly long subjects", () => {
    expect(accountIdFromAccessToken(jwt({ sub: "a".repeat(300) }))).toBeNull();
  });
});
