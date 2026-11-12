import { describe, expect, it } from "vitest";

import { deriveTripBounds, deriveTripSchedule } from "./trip-schedule.js";

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

describe("deriveTripSchedule", () => {
  const out = (destinationId: string, departureAt: unknown, arrivalAt: unknown) => ({ destinationId, direction: "outbound", departureAt, arrivalAt });
  const back = (destinationId: string, departureAt: unknown, arrivalAt: unknown) => ({ destinationId, direction: "return", departureAt, arrivalAt });
  const t = (value: string) => d(value);

  it("returns null bounds without destinations", () => {
    expect(deriveTripSchedule([], [out("a", t("2026-10-01T10:00:00.000Z"), t("2026-10-01T12:00:00.000Z"))])).toEqual({ startAt: null, endAt: null });
  });

  it("leaves the end empty without transports", () => {
    expect(deriveTripSchedule(["a"], [])).toEqual({ startAt: null, endAt: null });
  });

  it("leaves the end empty with only an outbound transport but keeps the start", () => {
    const schedule = deriveTripSchedule(["a"], [out("a", t("2026-10-01T10:00:00.000Z"), t("2026-10-01T12:00:00.000Z"))]);
    expect(schedule.startAt).toEqual(t("2026-10-01T10:00:00.000Z"));
    expect(schedule.endAt).toBeNull();
  });

  it("uses min and max when the only destination has outbound and return", () => {
    const schedule = deriveTripSchedule(["a"], [
      out("a", t("2026-10-01T10:00:00.000Z"), t("2026-10-01T12:00:00.000Z")),
      back("a", t("2026-10-09T10:00:00.000Z"), t("2026-10-09T14:00:00.000Z")),
    ]);
    expect(schedule).toEqual({ startAt: t("2026-10-01T10:00:00.000Z"), endAt: t("2026-10-09T14:00:00.000Z") });
  });

  it("leaves the end empty when one of two destinations has no return", () => {
    const schedule = deriveTripSchedule(["a", "b"], [
      out("a", t("2026-10-01T10:00:00.000Z"), t("2026-10-01T12:00:00.000Z")),
      back("a", t("2026-10-05T10:00:00.000Z"), t("2026-10-05T12:00:00.000Z")),
      out("b", t("2026-10-05T14:00:00.000Z"), t("2026-10-05T16:00:00.000Z")),
    ]);
    expect(schedule.endAt).toBeNull();
    expect(schedule.startAt).toEqual(t("2026-10-01T10:00:00.000Z"));
  });

  it("leaves the end empty when a destination has no transports at all", () => {
    const schedule = deriveTripSchedule(["a", "b"], [
      out("a", t("2026-10-01T10:00:00.000Z"), t("2026-10-01T12:00:00.000Z")),
      back("a", t("2026-10-05T10:00:00.000Z"), t("2026-10-05T12:00:00.000Z")),
    ]);
    expect(schedule.endAt).toBeNull();
  });

  it("uses the maximum when every destination has a return", () => {
    const schedule = deriveTripSchedule(["a", "b"], [
      out("a", t("2026-10-01T10:00:00.000Z"), t("2026-10-01T12:00:00.000Z")),
      back("a", t("2026-10-05T10:00:00.000Z"), t("2026-10-05T12:00:00.000Z")),
      out("b", t("2026-10-05T14:00:00.000Z"), t("2026-10-05T16:00:00.000Z")),
      back("b", t("2026-10-12T10:00:00.000Z"), t("2026-10-12T18:00:00.000Z")),
    ]);
    expect(schedule).toEqual({ startAt: t("2026-10-01T10:00:00.000Z"), endAt: t("2026-10-12T18:00:00.000Z") });
  });

  it("treats a return without a valid arrivalAt as missing", () => {
    const outbound = out("a", t("2026-10-01T10:00:00.000Z"), t("2026-10-01T12:00:00.000Z"));
    for (const arrivalAt of [null, undefined, "2026-10-09T10:00:00.000Z", new Date("invalid")]) {
      expect(deriveTripSchedule(["a"], [outbound, back("a", t("2026-10-09T10:00:00.000Z"), arrivalAt)]).endAt).toBeNull();
    }
  });

  it("ignores transports of unknown destinations for completeness", () => {
    const schedule = deriveTripSchedule(["a"], [
      out("a", t("2026-10-01T10:00:00.000Z"), t("2026-10-01T12:00:00.000Z")),
      back("zzz", t("2026-10-09T10:00:00.000Z"), t("2026-10-09T14:00:00.000Z")),
    ]);
    expect(schedule.endAt).toBeNull();
  });

  it("does not invent invalid dates", () => {
    const schedule = deriveTripSchedule(["a"], [out("a", "x", null), back("a", null, t("2026-10-09T14:00:00.000Z"))]);
    expect(schedule).toEqual({ startAt: t("2026-10-09T14:00:00.000Z"), endAt: t("2026-10-09T14:00:00.000Z") });
  });
});
