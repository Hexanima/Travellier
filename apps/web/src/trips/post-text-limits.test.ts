import { describe, expect, it } from "vitest";
import { EXPENSE_BREAKDOWN_MAX, POST_DESCRIPTION_MAX, breakdownTooLong, descriptionTooLong, textLength } from "./post-text-limits.js";

describe("post text limits", () => {
  it("uses the server limits", () => {
    expect(POST_DESCRIPTION_MAX).toBe(5000);
    expect(EXPENSE_BREAKDOWN_MAX).toBe(2000);
  });
  it("counts code points: an emoji is one", () => {
    expect(textLength("a😀b")).toBe(3);
    expect(descriptionTooLong("😀".repeat(5000))).toBe(false);
    expect(descriptionTooLong("😀".repeat(5001))).toBe(true);
  });
  it("accepts 5000 and rejects 5001 characters of the description", () => {
    expect(descriptionTooLong("a".repeat(5000))).toBe(false);
    expect(descriptionTooLong("a".repeat(5001))).toBe(true);
  });
  it("measures the trimmed text (what is sent)", () => {
    expect(descriptionTooLong(`  ${"a".repeat(5000)}  \n`)).toBe(false);
    expect(breakdownTooLong(` ${"a".repeat(2000)} `)).toBe(false);
  });
  it("accepts 2000 and rejects 2001 characters of the breakdown", () => {
    expect(breakdownTooLong("a".repeat(2000))).toBe(false);
    expect(breakdownTooLong("a".repeat(2001))).toBe(true);
  });
});
