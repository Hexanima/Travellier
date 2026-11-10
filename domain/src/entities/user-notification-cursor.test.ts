import { describe, expect, it } from "vitest";

import { createObjectId, type ObjectId } from "../value-objects/object-id.js";
import { compareNotificationPosition, encodeNotificationCursor, parseNotificationCursor } from "./user-notification-cursor.js";

const id = (n: number): ObjectId => {
  const parsed = createObjectId(n.toString(16).padStart(24, "0"));
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};
const position = { createdAtMs: Date.UTC(2026, 9, 4, 12), id: id(7) };

describe("notification cursor", () => {
  it("round-trips a position as an opaque token", () => {
    const token = encodeNotificationCursor(position);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(parseNotificationCursor(token)).toEqual({ ok: true, value: position });
  });

  it.each([[""], ["no es base64!"], ["e30"], [5], [undefined], [btoa(JSON.stringify({ v: 2, c: 1, i: id(1) }))],
    [btoa(JSON.stringify({ v: 1, c: "x", i: id(1) }))], [btoa(JSON.stringify({ v: 1, c: 1, i: "zz" }))], ["a".repeat(600)]])(
    "rejects %s as invalid", (raw) => {
      expect(parseNotificationCursor(raw)).toMatchObject({ ok: false, error: { tag: "ValidationError", issues: [{ field: "cursor", code: "invalid" }] } });
    });

  it("orders newest first with the id descending on ties", () => {
    const older = { createdAtMs: position.createdAtMs - 1, id: id(9) };
    expect(compareNotificationPosition(position, older)).toBeLessThan(0);
    expect(compareNotificationPosition({ ...position, id: id(8) }, position)).toBeLessThan(0);
    expect(compareNotificationPosition(position, position)).toBe(0);
  });
});
