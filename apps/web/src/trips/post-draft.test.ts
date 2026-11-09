import { describe, expect, it } from "vitest";
import { draftFromPost, emptyDraft, hasContent, isDraftDirty, prepareCreate, prepareUpdate, type PostDraft } from "./post-draft.js";

const draft = (description: string, mapsUrl = ""): PostDraft => ({ values: { description, mapsUrl }, extras: {} });
describe("post draft", () => {
  it("starts empty", () => expect(emptyDraft()).toEqual(draft("")));
  it("is built from a saved post, turning null into empty text", () => {
    expect(draftFromPost({ description: "Hola", mapsUrl: null })).toEqual(draft("Hola"));
    expect(draftFromPost({ description: null, mapsUrl: "https://maps.test/x" })).toEqual(draft("", "https://maps.test/x"));
  });
  it("has no content with blanks and has it with text or only a location", () => {
    expect(hasContent(draft("  \n\t ", "   "))).toBe(false);
    expect(hasContent(draft("Hola"))).toBe(true);
    expect(hasContent(draft("", "https://maps.test/x"))).toBe(true);
  });
  it("prepares a create with trimmed values and omits empty ones", () => {
    expect(prepareCreate(draft("  Hola  ", "  "))).toEqual({ description: "Hola" });
    expect(prepareCreate(draft(" ", " https://maps.test/x "))).toEqual({ mapsUrl: "https://maps.test/x" });
    expect(prepareCreate(draft("Hola", "https://maps.test/x"))).toEqual({ description: "Hola", mapsUrl: "https://maps.test/x" });
  });
  it("prepares an update with only what changed, null when cleared and {} without changes", () => {
    const original = { description: "Hola", mapsUrl: "https://maps.test/x" };
    expect(prepareUpdate(draft("Hola", "https://maps.test/x"), original)).toEqual({});
    expect(prepareUpdate(draft("  Hola  ", "https://maps.test/x"), original)).toEqual({});
    expect(prepareUpdate(draft("Chau", "https://maps.test/x"), original)).toEqual({ description: "Chau" });
    expect(prepareUpdate(draft("Hola", ""), original)).toEqual({ mapsUrl: null });
    expect(prepareUpdate(draft("", "https://maps.test/y"), original)).toEqual({ description: null, mapsUrl: "https://maps.test/y" });
    expect(prepareUpdate(draft("Hola", "https://maps.test/x"), { description: null, mapsUrl: null })).toEqual({ description: "Hola", mapsUrl: "https://maps.test/x" });
    expect(prepareUpdate(draft("", ""), { description: null, mapsUrl: null })).toEqual({});
  });
  it("is dirty only when it differs from the base", () => {
    expect(isDraftDirty(draft("Hola"), emptyDraft())).toBe(true);
    expect(isDraftDirty(draft("", "x"), emptyDraft())).toBe(true);
    expect(isDraftDirty(emptyDraft(), emptyDraft())).toBe(false);
    expect(isDraftDirty(draft("Hola"), draft("Hola"))).toBe(false);
    expect(isDraftDirty(draft("Hola  "), draft("Hola"))).toBe(true);
  });
});
