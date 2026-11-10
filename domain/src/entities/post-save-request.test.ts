import { describe, expect, it } from "vitest";
import * as domain from "../index.js";

const id = (number: number) => {
  const parsed = domain.createObjectId(number.toString(16).padStart(24, "0"));
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};
const post: domain.Post = { id: id(1), tripId: id(2), authorId: id(3), createdAt: new Date("2026-10-04T12:00:00Z"),
  description: "Cena", mapsUrl: null, activityId: null, parentPostId: null, transportId: null };
const activity = { title: "Plan", description: null, scheduledAt: new Date("2026-09-25T12:00:00Z"), durationMinutes: 60, mapsUrl: null };
const stored = (fields: Partial<domain.StoredPostSave> = {}): domain.StoredPostSave => ({ post, activity: null, photoKeys: [], hasExpense: false, ...fields });
const request = (fields: Partial<domain.PostSaveRequest> = {}): domain.PostSaveRequest => ({ expenseMatches: true, ...fields });

describe("isSameRequest (T87)", () => {
  it("treats an omitted optional field as null, like the creation does", () => {
    expect(domain.isSameRequest(stored(), request({ description: "Cena" }))).toBe(true);
    expect(domain.isSameRequest(stored(), request({ description: "Cena", mapsUrl: null, activityId: null, parentPostId: null, transportId: null }))).toBe(true);
    expect(domain.isSameRequest(stored(), request({ description: "Cena", mapsUrl: undefined }))).toBe(true);
  });

  it.each<[string, Partial<domain.PostSaveRequest>]>([
    ["description", { description: "Otra" }], ["omitted description", {}], ["mapsUrl", { description: "Cena", mapsUrl: "maps" }],
    ["activityId", { description: "Cena", activityId: id(9) }], ["parentPostId", { description: "Cena", parentPostId: id(9) }],
    ["transportId", { description: "Cena", transportId: id(9) }], ["photos where none were stored", { description: "Cena", photoKeys: ["a"] }],
    ["expense sent where none was stored", { description: "Cena", expenseSent: true }],
  ])("differs on %s", (_, fields) => {
    expect(domain.isSameRequest(stored(), request(fields))).toBe(false);
  });

  it("compares the new activity by its persistable fields and requires the post to be linked to one", () => {
    const linked = stored({ post: { ...post, activityId: id(7) }, activity });
    const same = { title: "Plan", scheduledAt: new Date("2026-09-25T12:00:00Z"), durationMinutes: 60 };
    expect(domain.isSameRequest(linked, request({ description: "Cena", newActivity: same }))).toBe(true);
    expect(domain.isSameRequest(linked, request({ description: "Cena", newActivity: { ...same, description: null, mapsUrl: null } }))).toBe(true);
    for (const difference of [{ title: "Otro" }, { scheduledAt: new Date("2026-09-25T12:01:00Z") }, { durationMinutes: 30 }, { durationMinutes: undefined },
      { description: "x" }, { mapsUrl: "m" }]) {
      expect(domain.isSameRequest(linked, request({ description: "Cena", newActivity: { ...same, ...difference } }))).toBe(false);
    }
    expect(domain.isSameRequest(linked, request({ description: "Cena" }))).toBe(false);
    expect(domain.isSameRequest(stored(), request({ description: "Cena", newActivity: same }))).toBe(false);
  });

  it("compares the photo keys as an ordered list", () => {
    const withPhotos = stored({ photoKeys: ["a", "b"] });
    expect(domain.isSameRequest(withPhotos, request({ description: "Cena", photoKeys: ["a", "b"] }))).toBe(true);
    expect(domain.isSameRequest(withPhotos, request({ description: "Cena", photoKeys: ["b", "a"] }))).toBe(false);
    expect(domain.isSameRequest(withPhotos, request({ description: "Cena", photoKeys: ["a"] }))).toBe(false);
    expect(domain.isSameRequest(withPhotos, request({ description: "Cena" }))).toBe(false);
  });

  it("requires an expense request exactly when one is stored", () => {
    expect(domain.isSameRequest(stored({ hasExpense: true }), request({ description: "Cena", expenseSent: true }))).toBe(true);
    expect(domain.isSameRequest(stored({ hasExpense: true }), request({ description: "Cena" }))).toBe(false);
    expect(domain.isSameRequest(stored(), request({ description: "Cena", expenseSent: true }))).toBe(false);
    expect(domain.isSameRequest(stored({ hasExpense: true }), request({ description: "Cena", expenseSent: true, expenseMatches: false }))).toBe(false);
  });
});
