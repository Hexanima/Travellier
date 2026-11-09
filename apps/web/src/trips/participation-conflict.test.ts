import { describe, expect, it } from "vitest";
import { parseConfirmation } from "./participation-conflict.js";

const a = "a".repeat(24), b = "b".repeat(24);
const valid = () => ({
  conflicts: [
    { activityId: a, reason: "overlap", scheduledAt: "2026-09-25T12:00:00.000Z", durationMinutes: 60 },
    { activityId: b, reason: "same_start", scheduledAt: "2026-09-25T12:30:00.000Z", durationMinutes: null },
  ],
  activity: { scheduledAt: "2026-09-25T12:30:00.000Z", durationMinutes: null },
});

describe("parseConfirmation", () => {
  it("accepts several conflicts and a null duration, renaming to the request payload", () => {
    expect(parseConfirmation(valid())).toEqual({ confirmedConflicts: valid().conflicts, confirmedActivity: valid().activity });
  });
  it("discards unknown fields", () => {
    const input = valid() as Record<string, unknown> & ReturnType<typeof valid>;
    input.conflicts = input.conflicts.map((c) => ({ ...c, title: "Secreto", userId: "x" }));
    input.activity = { ...input.activity, extra: 1 } as typeof input.activity;
    input.extra = true;
    expect(parseConfirmation(input)).toEqual({ confirmedConflicts: valid().conflicts, confirmedActivity: valid().activity });
  });
  it.each([
    ["undefined details", undefined],
    ["empty conflicts", { ...valid(), conflicts: [] }],
    ["conflicts not an array", { ...valid(), conflicts: {} }],
    ["bad activityId", { ...valid(), conflicts: [{ ...valid().conflicts[0], activityId: "xyz" }] }],
    ["unknown reason", { ...valid(), conflicts: [{ ...valid().conflicts[0], reason: "other" }] }],
    ["malformed scheduledAt", { ...valid(), conflicts: [{ ...valid().conflicts[0], scheduledAt: "2026-09-25 12:00" }] }],
    ["zero duration", { ...valid(), conflicts: [{ ...valid().conflicts[0], durationMinutes: 0 }] }],
    ["negative duration", { ...valid(), conflicts: [{ ...valid().conflicts[0], durationMinutes: -5 }] }],
    ["fractional duration", { ...valid(), conflicts: [{ ...valid().conflicts[0], durationMinutes: 1.5 }] }],
    ["missing duration", { ...valid(), conflicts: [{ activityId: a, reason: "overlap", scheduledAt: "2026-09-25T12:00:00.000Z" }] }],
    ["missing activity", { conflicts: valid().conflicts }],
    ["bad activity scheduledAt", { ...valid(), activity: { scheduledAt: "bad", durationMinutes: null } }],
    ["bad activity duration", { ...valid(), activity: { scheduledAt: "2026-09-25T12:30:00.000Z", durationMinutes: 0 } }],
  ])("rejects %s", (_name, input) => {
    expect(parseConfirmation(input as Record<string, unknown> | undefined)).toBeUndefined();
  });
});
