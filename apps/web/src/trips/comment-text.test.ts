import { describe, expect, it } from "vitest";
import { commentLength, commentProblem, COMMENT_MAX } from "./comment-text.js";

describe("comment text rules", () => {
  it("counts code points, not UTF-16 units", () => {
    expect(commentLength("abc")).toBe(3);
    expect(commentLength("😀😀")).toBe(2);
    expect("😀".length).toBe(2);
  });
  it("accepts up to 2000 code points and rejects 2001, also with emoji", () => {
    expect(COMMENT_MAX).toBe(2000);
    expect(commentProblem("a".repeat(2000))).toBeUndefined();
    expect(commentProblem("a".repeat(2001))).toBe("too_long");
    expect(commentProblem("😀".repeat(2000))).toBeUndefined();
    expect(commentProblem("😀".repeat(2001))).toBe("too_long");
  });
  it("rejects empty text after trim", () => {
    expect(commentProblem("")).toBe("required");
    expect(commentProblem("  \n\t ")).toBe("required");
    expect(commentProblem(" a ")).toBeUndefined();
  });
  it("measures the text that is sent (trimmed) against the limit", () => {
    expect(commentProblem(`  ${"a".repeat(2000)}  `)).toBeUndefined();
  });
});
