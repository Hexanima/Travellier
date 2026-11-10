import { describe, expect, it } from "vitest";
import * as domain from "../index.js";

const id = (number: number) => {
  const parsed = domain.createObjectId(number.toString(16).padStart(24, "0"));
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};
const tripId = id(1), commentId = id(2);
const input = () => ({ id: id(3), tripId, commentId, userId: id(4), createdAt: new Date("2026-10-04T12:00:00.789Z") });
const comment = { id: commentId, tripId };

describe("createCommentLike", () => {
  it("copies the date and keeps the references", () => {
    const source = input();
    const result = domain.createCommentLike(source, { comment });
    expect(result).toEqual({ ok: true, value: source });
    if (result.ok) expect(result.value.createdAt).not.toBe(source.createdAt);
  });

  it("rejects a comment from another Trip", () => {
    expect(domain.createCommentLike(input(), { comment: { id: commentId, tripId: id(9) } }))
      .toMatchObject({ ok: false, error: { tag: "ValidationError", issues: [{ field: "commentId", code: "mismatch" }] } });
  });

  it("rejects a different comment id", () => {
    expect(domain.createCommentLike(input(), { comment: { id: id(8), tripId } }))
      .toMatchObject({ ok: false, error: { issues: [{ field: "commentId", code: "mismatch" }] } });
  });

  it.each([new Date("nope"), "2026-10-04", undefined])("rejects invalid createdAt %j", (createdAt) => {
    expect(domain.createCommentLike({ ...input(), createdAt: createdAt as Date }, { comment }))
      .toMatchObject({ ok: false, error: { issues: [{ field: "createdAt", code: "invalid" }] } });
  });
});
