import { describe, expect, it } from "vitest";
import { sameValue } from "./same-value.js";

describe("sameValue", () => {
  it("compares plain data structurally", () => {
    expect(sameValue({ a: [1, { b: null }], c: "x" }, { c: "x", a: [1, { b: null }] })).toBe(true);
    expect(sameValue([1, 2], [1, 2, 3])).toBe(false);
    expect(sameValue({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameValue({ a: undefined }, { b: undefined })).toBe(false);
    expect(sameValue([], {})).toBe(false);
    expect(sameValue(null, {})).toBe(false);
  });
});
