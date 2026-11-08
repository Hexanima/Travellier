import { describe, expect, it } from "vitest";
import { formatActivityClock, formatActivityRange } from "./activity-time-format.js";

const BA = "America/Argentina/Buenos_Aires";
describe("formatActivityRange", () => {
  it("does not invent an end without duration", () => {
    expect(formatActivityRange({ scheduledAt: "2026-09-26T13:00:00.000Z", durationMinutes: null }, BA))
      .toEqual({ start: "10:00", end: null, endDateLabel: null, startIso: "2026-09-26T13:00:00.000Z", endIso: null });
    expect(formatActivityRange({ scheduledAt: "2026-09-26T13:00:00.000Z" }, BA).end).toBeNull();
  });
  it("shows only the clock when the end falls on the same local day", () => {
    expect(formatActivityRange({ scheduledAt: "2026-09-26T13:00:00.000Z", durationMinutes: 90 }, BA))
      .toEqual({ start: "10:00", end: "11:30", endDateLabel: null, startIso: "2026-09-26T13:00:00.000Z", endIso: "2026-09-26T14:30:00.000Z" });
  });
  it("detects crossing midnight in the given zone, not in UTC", () => {
    // 22:30 BA (01:30Z next day): ends 00:30 BA next day, but both are the same UTC day.
    const crossing = formatActivityRange({ scheduledAt: "2026-09-27T01:30:00.000Z", durationMinutes: 120 }, BA);
    expect(crossing).toMatchObject({ start: "22:30", end: "00:30", endDateLabel: expect.stringContaining("27") });
    expect(crossing.endDateLabel).toContain("sep");
    // 21:30 BA (00:30Z) to 23:30 BA stays within one BA day while it crosses nothing in UTC either.
    expect(formatActivityRange({ scheduledAt: "2026-09-27T00:30:00.000Z", durationMinutes: 120 }, BA).endDateLabel).toBeNull();
    // Same instants in UTC: 01:30Z + 2 h = 03:30Z, same day.
    expect(formatActivityRange({ scheduledAt: "2026-09-27T01:30:00.000Z", durationMinutes: 120 }, "UTC").endDateLabel).toBeNull();
    // 22:30Z + 2 h crosses in UTC but not in BA (19:30 -> 21:30).
    expect(formatActivityRange({ scheduledAt: "2026-09-26T22:30:00.000Z", durationMinutes: 120 }, "UTC").endDateLabel).toContain("27");
    expect(formatActivityRange({ scheduledAt: "2026-09-26T22:30:00.000Z", durationMinutes: 120 }, BA).endDateLabel).toBeNull();
  });
  it("adds the year only when the end year differs", () => {
    const range = formatActivityRange({ scheduledAt: "2026-12-31T22:00:00.000Z", durationMinutes: 180 }, "UTC");
    expect(range.end).toBe("01:00");
    expect(range.endDateLabel).toContain("1");
    expect(range.endDateLabel).toContain("ene");
    expect(range.endDateLabel).toContain("2027");
    expect(formatActivityRange({ scheduledAt: "2026-09-26T22:00:00.000Z", durationMinutes: 180 }, "UTC").endDateLabel).not.toContain("2026");
  });
  it("treats an end exactly at local midnight as the next day", () => {
    const range = formatActivityRange({ scheduledAt: "2026-09-27T01:00:00.000Z", durationMinutes: 60 }, BA);
    expect(range).toMatchObject({ start: "22:00", end: "23:00", endDateLabel: null });
    const midnight = formatActivityRange({ scheduledAt: "2026-09-27T02:00:00.000Z", durationMinutes: 60 }, BA);
    expect(midnight).toMatchObject({ start: "23:00", end: "00:00" });
    expect(midnight.endDateLabel).toContain("27");
  });
  it("uses calendar days across a DST change", () => {
    // Europe/Madrid falls back at 01:00Z on 2026-10-25: 4 h of elapsed time from 23:30 local end at 02:30 local on the 25th.
    const range = formatActivityRange({ scheduledAt: "2026-10-24T21:30:00.000Z", durationMinutes: 240 }, "Europe/Madrid");
    expect(range.start).toBe("23:30");
    expect(range.end).toBe("02:30");
    expect(range.endDateLabel).toContain("25");
  });
  it("formats a standalone clock", () => {
    expect(formatActivityClock("2026-09-26T13:05:00.000Z", BA)).toBe("10:05");
  });
});
