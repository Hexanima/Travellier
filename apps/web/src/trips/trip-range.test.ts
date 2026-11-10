import { describe, expect, it } from "vitest";

import { classifyTrips } from "./trip-list-filter.js";
import { formatTripRange } from "./trip-range.js";

describe("formatTripRange", () => {
  it("shows the dates of the device time zone", () => {
    expect(formatTripRange("2026-10-01T10:00:00.000Z", "2026-10-09T12:00:00.000Z", "UTC")).toBe("1 oct – 9 oct 2026");
    // 01:00 UTC is still the previous day in Buenos Aires.
    expect(formatTripRange("2026-10-01T01:00:00.000Z", "2026-10-09T01:00:00.000Z", "America/Argentina/Buenos_Aires")).toBe("30 sept – 8 oct 2026");
    expect(formatTripRange("2026-10-01T01:00:00.000Z", "2026-10-09T01:00:00.000Z", "UTC")).toBe("1 oct – 9 oct 2026");
  });
  it("uses the system zone when none is given", () => {
    const expected = formatTripRange("2026-10-01T01:00:00.000Z", "2026-10-09T01:00:00.000Z", Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(formatTripRange("2026-10-01T01:00:00.000Z", "2026-10-09T01:00:00.000Z")).toBe(expected);
  });
  it("shows both years when they differ and one date when the day is the same", () => {
    expect(formatTripRange("2026-12-28T10:00:00.000Z", "2027-01-03T10:00:00.000Z", "UTC")).toBe("28 dic 2026 – 3 ene 2027");
    expect(formatTripRange("2026-10-01T10:00:00.000Z", "2026-10-01T20:00:00.000Z", "UTC")).toBe("1 oct 2026");
  });
  it("says the dates are pending without both of them", () => {
    for (const [start, end] of [[null, null], ["2026-10-01T10:00:00.000Z", null], [null, "2026-10-01T10:00:00.000Z"], ["x", "y"], [undefined, undefined]] as const) {
      expect(formatTripRange(start, end, "UTC")).toBe("Fechas por definir");
    }
  });
  it("never changes the classification, whatever the zone shown", () => {
    const trip = { id: "a", name: "A", description: null, primaryDestination: { name: "X" }, startAt: null, endAt: "2026-10-10T00:30:00.000Z" };
    const now = Date.parse("2026-10-10T00:31:00.000Z");
    formatTripRange(trip.startAt, trip.endAt, "America/Argentina/Buenos_Aires");
    expect(classifyTrips([trip], now).finished).toHaveLength(1);
  });
});
