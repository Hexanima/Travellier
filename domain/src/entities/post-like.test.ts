import { describe, expect, it } from "vitest";
import * as domain from "../index.js";

const id = (number: number) => {
  const parsed = domain.createObjectId(number.toString(16).padStart(24, "0"));
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};
const tripId = id(1), postId = id(2);
const input = () => ({ id: id(3), tripId, postId, userId: id(4), createdAt: new Date("2026-10-04T12:00:00.789Z") });
const post = { id: postId, tripId };

describe("createPostLike", () => {
  it("copies the date and keeps the references", () => {
    const source = input();
    const result = domain.createPostLike(source, { post });
    expect(result).toEqual({ ok: true, value: source });
    if (result.ok) expect(result.value.createdAt).not.toBe(source.createdAt);
  });

  it("rejects a post from another Trip", () => {
    expect(domain.createPostLike(input(), { post: { id: postId, tripId: id(9) } }))
      .toMatchObject({ ok: false, error: { tag: "ValidationError", issues: [{ field: "postId", code: "mismatch" }] } });
  });

  it("rejects a different post id", () => {
    expect(domain.createPostLike(input(), { post: { id: id(8), tripId } }))
      .toMatchObject({ ok: false, error: { issues: [{ field: "postId", code: "mismatch" }] } });
  });

  it.each([new Date("nope"), "2026-10-04", undefined])("rejects invalid createdAt %j", (createdAt) => {
    expect(domain.createPostLike({ ...input(), createdAt: createdAt as Date }, { post }))
      .toMatchObject({ ok: false, error: { issues: [{ field: "createdAt", code: "invalid" }] } });
  });
});
