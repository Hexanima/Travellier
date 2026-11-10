import { describe, expect, it } from "vitest";

import { deriveTripBounds } from "./trip-schedule.js";

const d = (value: string) => new Date(value);

describe("deriveTripBounds", () => {
  it("returns null bounds without transports", () => {
    expect(deriveTripBounds([])).toEqual({ startAt: null, endAt: null });
  });

  it("uses the minimum and maximum of known departures and arrivals", () => {
    const bounds = deriveTripBounds([
      { departureAt: d("2026-10-01T10:00:00.000Z"), arrivalAt: d("2026-10-01T14:00:00.000Z") },
      { departureAt: d("2026-10-09T08:00:00.000Z"), arrivalAt: d("2026-10-09T12:00:00.000Z") },
    ]);
    expect(bounds).toEqual({ startAt: d("2026-10-01T10:00:00.000Z"), endAt: d("2026-10-09T12:00:00.000Z") });
  });

  it("handles several destinations with unordered legs", () => {
    const bounds = deriveTripBounds([
      { departureAt: d("2026-10-20T08:00:00.000Z"), arrivalAt: d("2026-10-20T10:00:00.000Z") },
      { departureAt: d("2026-10-05T08:00:00.000Z"), arrivalAt: d("2026-10-05T10:00:00.000Z") },
      { departureAt: d("2026-10-12T08:00:00.000Z"), arrivalAt: d("2026-10-12T10:00:00.000Z") },
      { departureAt: d("2026-10-25T08:00:00.000Z"), arrivalAt: d("2026-10-25T18:00:00.000Z") },
    ]);
    expect(bounds).toEqual({ startAt: d("2026-10-05T08:00:00.000Z"), endAt: d("2026-10-25T18:00:00.000Z") });
  });

  it("keeps a lone known departure or arrival as both bounds", () => {
    expect(deriveTripBounds([{ departureAt: d("2026-10-01T10:00:00.000Z") }]))
      .toEqual({ startAt: d("2026-10-01T10:00:00.000Z"), endAt: d("2026-10-01T10:00:00.000Z") });
    expect(deriveTripBounds([{ arrivalAt: d("2026-10-02T10:00:00.000Z") }]))
      .toEqual({ startAt: d("2026-10-02T10:00:00.000Z"), endAt: d("2026-10-02T10:00:00.000Z") });
  });

  it("ignores null, undefined, invalid dates and strings", () => {
    const bounds = deriveTripBounds([
      { departureAt: null, arrivalAt: undefined },
      { departureAt: new Date("nope"), arrivalAt: "2026-10-01T10:00:00.000Z" },
      { departureAt: d("2026-10-03T10:00:00.000Z"), arrivalAt: 12 },
    ]);
    expect(bounds).toEqual({ startAt: d("2026-10-03T10:00:00.000Z"), endAt: d("2026-10-03T10:00:00.000Z") });
    expect(deriveTripBounds([{ departureAt: null, arrivalAt: "x" }, {}])).toEqual({ startAt: null, endAt: null });
  });

  it("preserves milliseconds", () => {
    const bounds = deriveTripBounds([{ departureAt: d("2026-10-01T10:00:00.123Z"), arrivalAt: d("2026-10-05T10:00:00.999Z") }]);
    expect(bounds.startAt?.toISOString()).toBe("2026-10-01T10:00:00.123Z");
    expect(bounds.endAt?.toISOString()).toBe("2026-10-05T10:00:00.999Z");
  });

  it("returns new Date instances", () => {
    const source = d("2026-10-01T10:00:00.000Z");
    const bounds = deriveTripBounds([{ departureAt: source, arrivalAt: source }]);
    expect(bounds.startAt).not.toBe(source);
    expect(bounds.endAt).not.toBe(source);
    expect(bounds.startAt).not.toBe(bounds.endAt);
  });

  it("accepts any iterable", () => {
    const bounds = deriveTripBounds(new Set([{ departureAt: d("2026-10-01T10:00:00.000Z") }]));
    expect(bounds.startAt).toEqual(d("2026-10-01T10:00:00.000Z"));
  });
});
