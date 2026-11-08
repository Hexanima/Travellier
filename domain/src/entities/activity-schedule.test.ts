import { describe, expect, it } from "vitest";
import * as domain from "../index.js";
import type { ItineraryDay } from "./itinerary-day.js";

const id = (number: number) => {
  const result = domain.createObjectId(number.toString(16).padStart(24, "0"));
  if (!result.ok) throw result.error;
  return result.value;
};
const tripId = id(1), dayId = id(2), destinationId = id(3);
const day: ItineraryDay = {
  id: dayId, tripId, destinationId, type: "activity", order: 1,
  date: new Date("2026-09-25T00:00:00Z"),
  startsAt: new Date("2026-09-25T10:00:00.123Z"),
  endsAt: new Date("2026-09-26T00:00:00Z"),
};
const next: ItineraryDay = {
  ...day, id: id(4), order: 2, date: new Date("2026-09-26T00:00:00Z"),
  startsAt: new Date("2026-09-26T00:00:00Z"), endsAt: new Date("2026-09-26T18:00:00.789Z"),
};
const schedule = (scheduledAt: Date = new Date("2026-09-25T12:00:00Z")) => ({ tripId, dayId, scheduledAt });
const issue = (field: string, code: string) => ({
  ok: false, error: { tag: "ValidationError", issues: [{ field, code }] },
});

describe("validateActivitySchedule", () => {
  it.each([day.startsAt, new Date("2026-09-25T12:00:00Z"), next.endsAt!])(
    "accepts instants inside the destination window, including arrival and final departure: %s", (at) => {
      const input = { ...schedule(at), dayId: at === next.endsAt ? next.id : dayId };
      expect(domain.validateActivitySchedule(input, [day, next])).toEqual({ ok: true, value: undefined });
    },
  );

  it.each([undefined, null])("requires scheduledAt: %s", (scheduledAt) => {
    expect(domain.validateActivitySchedule({ ...schedule(), scheduledAt } as never, [day]))
      .toMatchObject(issue("scheduledAt", "required"));
  });

  it.each([new Date(Number.NaN), "2026-09-25T12:00:00Z", 0, {}])("rejects invalid scheduledAt: %s", (scheduledAt) => {
    expect(domain.validateActivitySchedule({ ...schedule(), scheduledAt } as never, [day]))
      .toMatchObject(issue("scheduledAt", "invalid"));
  });

  it("rejects a day absent from the itinerary", () => {
    expect(domain.validateActivitySchedule(schedule(), [next])).toMatchObject(issue("dayId", "not_found"));
  });

  it("rejects a day belonging to another Trip", () => {
    expect(domain.validateActivitySchedule(schedule(), [{ ...day, tripId: id(9) }]))
      .toMatchObject(issue("dayId", "mismatch"));
  });

  it.each(["transit_out", "transit_return"] as const)("rejects %s slices even on the same date", (type) => {
    expect(domain.validateActivitySchedule(schedule(), [{ ...day, type }]))
      .toMatchObject(issue("dayId", "invalid"));
  });

  it.each([
    { startsAt: new Date(Number.NaN) }, { startsAt: null }, { startsAt: undefined },
    { endsAt: null }, { endsAt: undefined }, { endsAt: new Date(Number.NaN) },
    { endsAt: new Date("2026-09-25T09:00:00Z") }, { endsAt: day.startsAt },
  ])("rejects disabled or malformed windows: %s", (patch) => {
    expect(domain.validateActivitySchedule(schedule(), [{ ...day, ...patch }] as never))
      .toMatchObject(issue("dayId", "invalid_window"));
  });

  it.each([
    new Date(day.startsAt.getTime() - 1), new Date(next.endsAt!.getTime() + 1),
  ])("rejects an instant outside the destination window by one millisecond: %s", (scheduledAt) => {
    const input = { ...schedule(scheduledAt), dayId: scheduledAt > next.endsAt! ? next.id : dayId };
    expect(domain.validateActivitySchedule(input, [day, next])).toMatchObject(issue("scheduledAt", "outside_window"));
  });

  it("assigns a midnight boundary to the following activity slice", () => {
    const at = next.startsAt;
    expect(domain.validateActivitySchedule(schedule(at), [day, next])).toMatchObject(issue("scheduledAt", "outside_window"));
    expect(domain.validateActivitySchedule({ ...schedule(at), dayId: next.id }, [day, next]))
      .toEqual({ ok: true, value: undefined });
  });

  it("accepts final departure at midnight without requiring a phantom activity day", () => {
    expect(domain.validateActivitySchedule(schedule(day.endsAt!), [day])).toEqual({ ok: true, value: undefined });
  });

  it("does not treat a different destination as a continuation of the selected slice", () => {
    expect(domain.validateActivitySchedule(schedule(day.endsAt!), [day, { ...next, destinationId: id(9) }]))
      .toEqual({ ok: true, value: undefined });
  });

  it("does not treat another Trip as a continuation of the selected slice", () => {
    expect(domain.validateActivitySchedule(schedule(day.endsAt!), [day, { ...next, tripId: id(9) }]))
      .toEqual({ ok: true, value: undefined });
  });

  it("rejects an instant in another destination even on the same calendar date", () => {
    const second = { ...day, id: id(9), destinationId: id(8),
      startsAt: new Date("2026-09-25T17:00:00Z"), endsAt: new Date("2026-09-25T23:00:00Z") };
    const first = { ...day, endsAt: new Date("2026-09-25T14:00:00Z") };
    expect(domain.validateActivitySchedule(schedule(new Date("2026-09-25T18:00:00Z")), [first, second]))
      .toMatchObject(issue("scheduledAt", "outside_window"));
  });

  it("rejects an itinerary without an enabled activity window", () => {
    expect(domain.validateActivitySchedule(schedule(), [])).toMatchObject(issue("dayId", "not_found"));
  });
});
describe("activity duration", () => {
  const withDuration = (durationMinutes: unknown, at = new Date("2026-09-25T12:00:00.456Z"), selected = dayId) =>
    ({ tripId, dayId: selected, scheduledAt: at, durationMinutes }) as never;

  it.each([undefined, null])("validates only the start without duration: %s", (durationMinutes) => {
    const input = withDuration(durationMinutes, day.endsAt!);
    expect(domain.validateActivitySchedule(input, [day])).toEqual({ ok: true, value: undefined });
    expect(domain.activityEndsAt(input)).toBeNull();
  });

  it.each([0, -1, -30, 1.5, 0.1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "30", {}, true])(
    "rejects a nonpositive or noninteger duration: %s", (durationMinutes) => {
      expect(domain.validateActivitySchedule(withDuration(durationMinutes), [day, next]))
        .toMatchObject(issue("durationMinutes", "invalid"));
    });

  it("derives the end from start and duration preserving milliseconds", () => {
    expect(domain.activityEndsAt(withDuration(90))).toEqual(new Date("2026-09-25T13:30:00.456Z"));
  });

  it("does not mutate the start when deriving the end", () => {
    const input = withDuration(90) as { scheduledAt: Date };
    domain.activityEndsAt(input as never)!.setTime(0);
    expect(input.scheduledAt.toISOString()).toBe("2026-09-25T12:00:00.456Z");
  });

  it("accepts an interval crossing midnight over contiguous slices of the same destination", () => {
    const input = withDuration(180, new Date("2026-09-25T22:30:00.456Z"));
    expect(domain.validateActivitySchedule(input, [day, next])).toEqual({ ok: true, value: undefined });
    expect(domain.activityEndsAt(input)).toEqual(new Date("2026-09-26T01:30:00.456Z"));
  });

  it("accepts an end exactly at the final departure", () => {
    const at = new Date(next.endsAt!.getTime() - 60 * 60_000);
    expect(domain.validateActivitySchedule(withDuration(60, at, next.id), [day, next])).toEqual({ ok: true, value: undefined });
    const fromFirst = new Date(next.endsAt!.getTime() - 20 * 60 * 60_000);
    expect(domain.validateActivitySchedule(withDuration(20 * 60, fromFirst), [day, next])).toEqual({ ok: true, value: undefined });
  });

  it.each([1, 60_000])("rejects an end exceeding the final departure by %s ms", (excess) => {
    const at = new Date(next.endsAt!.getTime() - 60 * 60_000 + excess);
    expect(domain.validateActivitySchedule(withDuration(60, at, next.id), [day, next]))
      .toMatchObject(issue("durationMinutes", "outside_window"));
  });

  it("accepts an end at midnight on a final slice without a phantom next day", () => {
    expect(domain.validateActivitySchedule(withDuration(60, new Date("2026-09-25T23:00:00Z")), [day]))
      .toEqual({ ok: true, value: undefined });
    expect(domain.validateActivitySchedule(withDuration(61, new Date("2026-09-25T23:00:00Z")), [day]))
      .toMatchObject(issue("durationMinutes", "outside_window"));
  });

  it.each([{ destinationId: id(9) }, { tripId: id(9) }, { type: "transit_return" as const }])(
    "rejects an end inside a contiguous slice that is not the same destination window: %s", (patch) => {
      expect(domain.validateActivitySchedule(withDuration(120, new Date("2026-09-25T23:00:00Z")), [day, { ...next, ...patch }]))
        .toMatchObject(issue("durationMinutes", "outside_window"));
    });

  it("rejects an end that crosses a gap between slices", () => {
    const later = { ...next, startsAt: new Date("2026-09-26T08:00:00Z") };
    expect(domain.validateActivitySchedule(withDuration(120, new Date("2026-09-25T23:00:00Z")), [day, later]))
      .toMatchObject(issue("durationMinutes", "outside_window"));
  });

  it("validates the start before the duration", () => {
    expect(domain.validateActivitySchedule(withDuration(0, new Date(day.startsAt.getTime() - 1)), [day]))
      .toMatchObject(issue("scheduledAt", "outside_window"));
  });
});
