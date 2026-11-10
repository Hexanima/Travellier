import { describe, expect, it } from "vitest";

import { classifyTrips, isFinished, nextBoundaryMs, parseFilter } from "./trip-list-filter.js";
import type { TripListItem } from "./trip-management-api.js";

const item = (id: string, startAt: string | null, endAt: string | null): TripListItem =>
  ({ id, name: id, description: null, primaryDestination: { name: "X" }, startAt, endAt });
const now = Date.parse("2026-10-10T12:00:00.000Z");

describe("isFinished", () => {
  it("a future trip is not finished", () => expect(isFinished("2026-11-01T00:00:00.000Z", now)).toBe(false));
  it("a past trip is finished", () => expect(isFinished("2026-10-09T12:00:00.000Z", now)).toBe(true));
  it("a trip without transports (null) is active", () => expect(isFinished(null, now)).toBe(false));
  it("the exact limit is still active and one millisecond later is finished", () => {
    expect(isFinished("2026-10-10T12:00:00.000Z", now)).toBe(false);
    expect(isFinished("2026-10-10T12:00:00.000Z", now + 1)).toBe(true);
  });
  it("keeps millisecond precision", () => {
    expect(isFinished("2026-10-10T11:59:59.999Z", now)).toBe(true);
    expect(isFinished("2026-10-10T12:00:00.001Z", now)).toBe(false);
  });
  it("an unparseable endAt is treated as absent (active)", () => expect(isFinished("nope", now)).toBe(false));
});

describe("classifyTrips", () => {
  const future = item("future", "2026-12-01T10:00:00.000Z", "2026-12-09T10:00:00.000Z");
  const past = item("past", "2026-09-01T10:00:00.000Z", "2026-09-09T10:00:00.000Z");
  const none = item("none", null, null);
  const onlyStart = item("only-start", "2026-09-01T10:00:00.000Z", null);
  const onlyEnd = item("only-end", null, "2026-12-09T10:00:00.000Z");
  it("splits active and finished preserving order; incomplete configuration is active", () => {
    const result = classifyTrips([future, past, none, onlyStart, onlyEnd], now);
    expect(result.active.map((trip) => trip.id)).toEqual(["future", "none", "only-start", "only-end"]);
    expect(result.finished.map((trip) => trip.id)).toEqual(["past"]);
  });
  it("never duplicates a trip: the first occurrence wins", () => {
    const result = classifyTrips([future, { ...future, name: "dup" }, past, past], now);
    expect(result.active).toHaveLength(1);
    expect(result.active[0]?.name).toBe("future");
    expect(result.finished).toHaveLength(1);
  });
  it("is the same whatever the device time zone (sanity of the TZ in use is logged by the test below)", () => {
    // Around midnight UTC: a local-day comparison would differ between Buenos Aires and UTC.
    const edge = item("edge", null, "2026-10-10T00:30:00.000Z");
    expect(classifyTrips([edge], Date.parse("2026-10-10T00:29:59.999Z")).active).toHaveLength(1);
    expect(classifyTrips([edge], Date.parse("2026-10-10T00:30:00.000Z")).active).toHaveLength(1);
    expect(classifyTrips([edge], Date.parse("2026-10-10T00:30:00.001Z")).finished).toHaveLength(1);
    expect(classifyTrips([edge], Date.parse("2026-10-09T23:59:59.999Z")).active).toHaveLength(1);
  });
  it("runs with the time zone requested by the environment", () => {
    if (process.env.TZ === "UTC") expect(new Date().getTimezoneOffset()).toBe(0);
    if (process.env.TZ === "America/Argentina/Buenos_Aires") expect(new Date().getTimezoneOffset()).toBe(180);
  });
});

describe("nextBoundaryMs", () => {
  it("is the earliest endAt not yet passed (the exact limit counts)", () => {
    const items = [item("a", null, "2026-12-01T00:00:00.000Z"), item("b", null, "2026-10-10T12:00:00.000Z"),
      item("c", null, "2026-09-01T00:00:00.000Z"), item("d", null, null)];
    expect(nextBoundaryMs(items, now)).toBe(now);
  });
  it("is null with nothing to expire", () => {
    expect(nextBoundaryMs([item("c", null, "2026-09-01T00:00:00.000Z"), item("d", null, null)], now)).toBeNull();
    expect(nextBoundaryMs([], now)).toBeNull();
  });
});

describe("parseFilter", () => {
  it("is finished only for exactly that value", () => {
    expect(parseFilter("finished")).toBe("finished");
    for (const raw of [null, undefined, "", "active", "Finished", "finished ", "x", "finished,active"]) expect(parseFilter(raw)).toBe("active");
  });
});
