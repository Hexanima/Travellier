import { describe, expect, it } from "vitest";
import * as domain from "../index.js";

const id = (number: number) => {
  const parsed = domain.createObjectId(number.toString(16).padStart(24, "0"));
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};
const tripId = id(1);
const postId = id(2);
const input = () => ({ id: id(3), tripId, postId, authorId: id(4), text: "  Qué lindo!  ",
  createdAt: new Date("2026-10-04T12:00:00.789Z") });
const post = { id: postId, tripId };

describe("createComment", () => {
  it("normalizes the text and copies the date", () => {
    const source = input();
    const result = domain.createComment(source, { post });
    expect(result).toEqual({ ok: true, value: { ...source, text: "Qué lindo!" } });
    if (result.ok) expect(result.value.createdAt).not.toBe(source.createdAt);
  });

  it("rejects a post from another Trip", () => {
    expect(domain.createComment(input(), { post: { id: postId, tripId: id(9) } }))
      .toMatchObject({ ok: false, error: { tag: "ValidationError", issues: [{ field: "postId", code: "mismatch" }] } });
  });

  it("rejects a different post id", () => {
    expect(domain.createComment(input(), { post: { id: id(8), tripId } }))
      .toMatchObject({ ok: false, error: { issues: [{ field: "postId", code: "mismatch" }] } });
  });

  it("rejects invalid text", () => {
    expect(domain.createComment({ ...input(), text: "   " }, { post }))
      .toMatchObject({ ok: false, error: { issues: [{ field: "text", code: "required" }] } });
  });

  it.each([new Date("nope"), "2026-10-04", undefined])("rejects invalid createdAt %j", (createdAt) => {
    expect(domain.createComment({ ...input(), createdAt: createdAt as Date }, { post }))
      .toMatchObject({ ok: false, error: { issues: [{ field: "createdAt", code: "invalid" }] } });
  });
});

describe("editCommentText", () => {
  const stored = (): domain.Comment => ({ ...input(), text: "Antes" });

  it("changes only the text", () => {
    const original = stored();
    const result = domain.editCommentText(original, "  Después ");
    expect(result).toEqual({ ok: true, value: { ...original, text: "Después" } });
    expect(original.text).toBe("Antes");
  });

  it("keeps id, author, post, Trip and creation date", () => {
    const result = domain.editCommentText(stored(), "Nuevo");
    expect(result.ok && [result.value.id, result.value.authorId, result.value.postId, result.value.tripId,
      result.value.createdAt.toISOString()]).toEqual([id(3), id(4), postId, tripId, "2026-10-04T12:00:00.789Z"]);
  });

  it("rejects invalid text", () => {
    expect(domain.editCommentText(stored(), "a".repeat(2001)))
      .toMatchObject({ ok: false, error: { issues: [{ field: "text", code: "too_long" }] } });
  });
});
