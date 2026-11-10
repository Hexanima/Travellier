import { describe, expect, it } from "vitest";
import { comparePhotoPosition, createObjectId, encodePhotoCursor, parsePhotoCursor, type ObjectId } from "../index.js";

const id = (n: number): ObjectId => {
  const parsed = createObjectId(n.toString(16).padStart(24, "0"));
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};
const tripId = id(1), otherTrip = id(2);
const position = { createdAtMs: Date.parse("2026-11-09T10:00:00.000Z"), postId: id(10), order: 3 };
const raw = (value: unknown) => btoa(typeof value === "string" ? value : JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const valid = { v: 1, t: tripId, f: "all", c: position.createdAtMs, p: position.postId, o: 3 };
const parse = (value: unknown, filter: Parameters<typeof parsePhotoCursor>[1]["filter"] = "all", trip = tripId) =>
  parsePhotoCursor(value, { tripId: trip, filter });
const invalid = { ok: false, error: { tag: "ValidationError", issues: [{ field: "cursor", code: "invalid" }] } };

describe("post photo cursor", () => {
  it("round-trips the position for the same Trip and filter", () => {
    const encoded = encodePhotoCursor({ tripId, filter: "all", position });
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(parse(encoded)).toEqual({ ok: true, value: position });
    const filter = `a:${id(7)}` as const;
    expect(parse(encodePhotoCursor({ tripId, filter, position }), filter)).toEqual({ ok: true, value: position });
  });

  it("encodes the documented JSON shape", () => {
    const encoded = encodePhotoCursor({ tripId, filter: `t:${id(8)}`, position });
    const json = JSON.parse(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")));
    expect(json).toEqual({ v: 1, t: tripId, f: `t:${id(8)}`, c: position.createdAtMs, p: position.postId, o: 3 });
  });

  it("rejects empty, non-string, non-base64 and non-JSON values", () => {
    for (const value of ["", undefined, 5, null, "***", "!!!!", raw("not json"), raw("[1]"), raw("null"), raw("5")]) {
      expect(parse(value)).toMatchObject(invalid);
    }
  });

  it("rejects an unknown version and malformed fields", () => {
    const cases: Record<string, unknown>[] = [
      { ...valid, v: 2 }, { ...valid, v: "1" }, { ...valid, t: "zz" }, { ...valid, p: "abc" }, { ...valid, p: 5 },
      { ...valid, f: "x" }, { ...valid, f: "a:zz" }, { ...valid, f: "b:" + id(7) },
      { ...valid, c: 1.5 }, { ...valid, c: "1" }, { ...valid, c: null }, { ...valid, o: -1 }, { ...valid, o: 1.2 }, { ...valid, o: "3" },
    ];
    for (const value of cases) expect(parse(raw(value))).toMatchObject(invalid);
    // JSON cannot carry NaN/Infinity; they arrive as null or as a number that overflows to Infinity.
    expect(parse(raw('{"v":1,"t":"' + tripId + '","f":"all","c":1e999,"p":"' + position.postId + '","o":3}'))).toMatchObject(invalid);
    expect(parse(raw({ ...valid, c: Number.MAX_SAFE_INTEGER * 2 }))).toMatchObject(invalid);
  });

  it("rejects an oversized cursor", () => {
    const padded = raw({ ...valid, extra: "x".repeat(600) });
    expect(padded.length).toBeGreaterThan(512);
    expect(parse(padded)).toMatchObject(invalid);
  });

  it("rejects a cursor of another Trip or another filter", () => {
    const all = encodePhotoCursor({ tripId, filter: "all", position });
    expect(parse(all, "all", otherTrip)).toMatchObject(invalid);
    expect(parse(all, `a:${id(7)}`)).toMatchObject(invalid);
    const activity = encodePhotoCursor({ tripId, filter: `a:${id(7)}`, position });
    expect(parse(activity, "all")).toMatchObject(invalid);
    expect(parse(activity, `a:${id(9)}`)).toMatchObject(invalid);
    expect(parse(activity, `t:${id(7)}`)).toMatchObject(invalid);
  });

  describe("comparePhotoPosition", () => {
    const at = (createdAtMs: number, postId: number, order: number) => ({ createdAtMs, postId: id(postId), order });
    it("lists newest publication first, then post id descending, then order ascending", () => {
      const sorted = [at(1, 1, 0), at(2, 1, 1), at(2, 9, 0), at(2, 9, 2), at(2, 10, 0), at(3, 1, 0)]
        .sort(comparePhotoPosition);
      expect(sorted.map((p) => [p.createdAtMs, p.postId, p.order])).toEqual(
        [at(3, 1, 0), at(2, 10, 0), at(2, 9, 0), at(2, 9, 2), at(2, 1, 1), at(1, 1, 0)].map((p) => [p.createdAtMs, p.postId, p.order]));
      expect(comparePhotoPosition(at(1, 1, 0), at(1, 1, 0))).toBe(0);
    });
  });
});
