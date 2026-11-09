import { describe, expect, it } from "vitest";
import * as domain from "../index.js";

const issue = (code: string) => ({ ok: false, error: { tag: "ValidationError", issues: [{ field: "text", code }] } });

describe("createCommentText", () => {
  it("exposes the 2000 code point limit", () => {
    expect(domain.MAX_COMMENT_TEXT_LENGTH).toBe(2000);
  });

  it("trims surrounding whitespace", () => {
    expect(domain.createCommentText("  hola \n")).toEqual({ ok: true, value: "hola" });
  });

  it.each(["", "   ", "\n\t "])("rejects empty text %j as required", (text) => {
    expect(domain.createCommentText(text)).toMatchObject(issue("required"));
  });

  it.each([undefined, null, 5, {}, ["a"]])("rejects non-string %j as invalid", (value) => {
    expect(domain.createCommentText(value)).toMatchObject(issue("invalid"));
  });

  it("accepts the exact limit and rejects one more", () => {
    expect(domain.createCommentText("a".repeat(2000))).toEqual({ ok: true, value: "a".repeat(2000) });
    expect(domain.createCommentText("a".repeat(2001))).toMatchObject(issue("too_long"));
  });

  it("counts emojis as one code point", () => {
    const emojis = "😀".repeat(2000);
    expect(emojis.length).toBe(4000);
    expect(domain.createCommentText(emojis)).toEqual({ ok: true, value: emojis });
    expect(domain.createCommentText(`${emojis}😀`)).toMatchObject(issue("too_long"));
  });

  it("measures the limit after trimming", () => {
    expect(domain.createCommentText(` ${"a".repeat(2000)} `)).toEqual({ ok: true, value: "a".repeat(2000) });
  });

  it("keeps inner line breaks", () => {
    expect(domain.createCommentText("uno\n\ndos")).toEqual({ ok: true, value: "uno\n\ndos" });
  });
});
