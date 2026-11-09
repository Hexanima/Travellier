import { afterEach, describe, expect, it, vi } from "vitest";
import { itineraryId } from "./itinerary-test-fixture.js";
import { initialNewActivity, newActivityLabel, newActivityWhen, parseNewActivity, resolveNewActivity } from "./new-activity-draft.js";
import type { NewActivityDraft } from "./post-draft.js";
import type { ItineraryDayResponse } from "./trip-itinerary-api.js";

afterEach(() => vi.useRealTimers());
const tripId = itineraryId(1), buenosAires = "America/Argentina/Buenos_Aires";
const day = (n: number, startsAt: string, endsAt: string, type = "activity", destination = 2): ItineraryDayResponse => ({
  id: itineraryId(n), tripId, destinationId: itineraryId(destination), date: `${startsAt.slice(0, 10)}T00:00:00.000Z`, type, startsAt, endsAt, order: n, items: [],
  expenseSummary: { totalAmount: 0, expenseCount: 0 } } as unknown as ItineraryDayResponse);
// Activity slice 10:00-18:00Z = 07:00-15:00 in Buenos Aires.
const days = [day(3, "2026-09-25T08:00:00.000Z", "2026-09-25T10:00:00.000Z", "transit_out"), day(4, "2026-09-25T10:00:00.000Z", "2026-09-25T18:00:00.000Z"),
  day(5, "2026-09-25T18:00:00.000Z", "2026-09-25T20:00:00.000Z", "transit_return")];
const draft = (extra: Partial<NewActivityDraft> = {}): NewActivityDraft => ({ title: "Cena", date: "2026-09-25", time: "12:00", durationHours: "", durationMinutes: "", ...extra });
const resolve = (value: NewActivityDraft, list = days, timeZone = buenosAires) => resolveNewActivity(value, { days: list, timeZone, tripId });

describe("initialNewActivity", () => {
  it("preloads the current moment in the device zone, with no title or duration", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-25T15:30:00.000Z"));
    expect(initialNewActivity(buenosAires)).toEqual({ title: "", date: "2026-09-25", time: "12:30", durationHours: "", durationMinutes: "" });
    expect(initialNewActivity("Asia/Tokyo")).toEqual({ title: "", date: "2026-09-26", time: "00:30", durationHours: "", durationMinutes: "" });
  });
});

describe("resolveNewActivity", () => {
  it("resolves a valid start in the local zone and an empty duration to null without inventing an end", () => {
    expect(resolve(draft())).toEqual({ ok: true, value: { scheduledAt: "2026-09-25T15:00:00.000Z", durationMinutes: null } });
  });
  it("resolves the duration in minutes", () => {
    expect(resolve(draft({ durationHours: "1", durationMinutes: "30" }))).toEqual({ ok: true, value: { scheduledAt: "2026-09-25T15:00:00.000Z", durationMinutes: 90 } });
  });
  it("requires a trimmed title", () => {
    expect(resolve(draft({ title: "   " }))).toEqual({ ok: false, errors: { title: "Ingresá un título para la actividad." } });
  });
  it("requires date and time", () => {
    expect(resolve(draft({ date: "", time: "" }))).toEqual({ ok: false, errors: { date: "Ingresá la fecha.", time: "Ingresá la hora." } });
  });
  it("rejects a start outside every activity slice", () => {
    expect(resolve(draft({ time: "20:00" }))).toEqual({ ok: false, errors: { scheduledAt: "Elegí un horario dentro de la franja de actividad del destino." } });
    expect(resolve(draft({ time: "06:59" })).ok).toBe(false);
  });
  it.each([
    [{ durationHours: "0" }, "durationMinutes"], [{ durationMinutes: "75" }, "durationMinutes"], [{ durationHours: "abc" }, "durationHours"], [{ durationMinutes: "x" }, "durationMinutes"],
  ])("rejects an invalid duration %j on %s", (extra, field) => {
    const result = resolve(draft(extra as Partial<NewActivityDraft>));
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : Object.keys(result.errors)).toEqual([field]);
  });
  it("rejects an end after the destination departure and keeps the start error out of it", () => {
    expect(resolve(draft({ time: "14:00", durationHours: "2" }))).toEqual({ ok: false,
      errors: { durationMinutes: "La actividad terminaría después de la salida del destino. Acortá la duración o elegí otro horario." } });
  });
  it("accepts an end exactly at the departure", () => {
    expect(resolve(draft({ time: "14:00", durationHours: "1" })).ok).toBe(true);
  });
  it("accepts the contiguous boundary between two activity slices and a duration that crosses it", () => {
    const split = [day(4, "2026-09-25T10:00:00.000Z", "2026-09-25T14:00:00.000Z"), day(6, "2026-09-25T14:00:00.000Z", "2026-09-25T18:00:00.000Z")];
    expect(resolve(draft({ time: "11:00" }), split)).toEqual({ ok: true, value: { scheduledAt: "2026-09-25T14:00:00.000Z", durationMinutes: null } });
    expect(resolve(draft({ time: "10:30", durationHours: "2" }), split).ok).toBe(true);
    expect(resolve(draft({ time: "10:30", durationHours: "5" }), split).ok).toBe(false);
  });
  it("takes the first valid candidate of an ambiguous DST hour", () => {
    // 2026-11-01 01:30 happens twice in New York (05:30Z and 06:30Z); only the second one is inside the slice.
    const slice = [day(4, "2026-11-01T06:00:00.000Z", "2026-11-01T12:00:00.000Z")];
    expect(resolve(draft({ date: "2026-11-01", time: "01:30" }), slice, "America/New_York"))
      .toEqual({ ok: true, value: { scheduledAt: "2026-11-01T06:30:00.000Z", durationMinutes: null } });
    const early = [day(4, "2026-11-01T05:00:00.000Z", "2026-11-01T12:00:00.000Z")];
    expect(resolve(draft({ date: "2026-11-01", time: "01:30" }), early, "America/New_York"))
      .toEqual({ ok: true, value: { scheduledAt: "2026-11-01T05:30:00.000Z", durationMinutes: null } });
  });
  it("rejects a local time that does not exist (DST gap)", () => {
    const slice = [day(4, "2026-03-08T00:00:00.000Z", "2026-03-09T00:00:00.000Z")];
    expect(resolve(draft({ date: "2026-03-08", time: "02:30" }), slice, "America/New_York"))
      .toEqual({ ok: false, errors: { scheduledAt: "Ingresá una fecha y hora válidas en tu zona local." } });
  });
  it("explains that transports are needed first when there are no activity slices", () => {
    const message = "Todavía no hay franjas de actividad: cargá los transportes primero.";
    expect(resolve(draft(), [])).toEqual({ ok: false, errors: { scheduledAt: message } });
    expect(resolve(draft(), [days[0]!, days[2]!])).toEqual({ ok: false, errors: { scheduledAt: message } });
  });
  it("reports title and duration errors together before the window", () => {
    const result = resolve(draft({ title: "", durationMinutes: "99" }));
    expect(result).toEqual({ ok: false, errors: { title: "Ingresá un título para la actividad.", durationMinutes: "Ingresá minutos enteros entre 0 y 59." } });
  });
});

describe("parseNewActivity (itinerary not loaded)", () => {
  it("returns the first instant and the duration without checking any window", () => {
    expect(parseNewActivity(draft({ time: "23:00", durationHours: "30" }), buenosAires)).toEqual({ ok: true, value: { scheduledAt: "2026-09-26T02:00:00.000Z", durationMinutes: 1800 } });
    expect(parseNewActivity(draft({ date: "2026-11-01", time: "01:30" }), "America/New_York")).toEqual({ ok: true, value: { scheduledAt: "2026-11-01T05:30:00.000Z", durationMinutes: null } });
  });
  it("still rejects a missing title, a bad duration and a nonexistent local time", () => {
    expect(parseNewActivity(draft({ title: " ", durationMinutes: "75" }), buenosAires)).toEqual({ ok: false,
      errors: { title: "Ingresá un título para la actividad.", durationMinutes: "Ingresá minutos enteros entre 0 y 59." } });
    expect(parseNewActivity(draft({ date: "2026-03-08", time: "02:30" }), "America/New_York")).toEqual({ ok: false,
      errors: { scheduledAt: "Ingresá una fecha y hora válidas en tu zona local." } });
  });
});

describe("new activity summary", () => {
  it("shows date, time and duration only when present", () => {
    expect(newActivityWhen(draft())).toBe("25/09/2026 12:00");
    expect(newActivityLabel(draft())).toBe("Cena · 25/09/2026 12:00");
    expect(newActivityLabel(draft({ durationHours: "1", durationMinutes: "30" }))).toBe("Cena · 25/09/2026 12:00 · 1 h 30 min");
    expect(newActivityLabel(draft({ title: "  Cena  ", durationMinutes: "45" }))).toBe("Cena · 25/09/2026 12:00 · 45 min");
    expect(newActivityLabel(draft({ durationMinutes: "99" }))).toBe("Cena · 25/09/2026 12:00");
  });
});
