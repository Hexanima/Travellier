import { afterEach, describe, expect, it, vi } from "vitest";
import type { CalendarEvent } from "./calendar-events.js";
import { eventMarker, maxNotesLength, maxTitleLength, specFingerprint, toNativeEventSpec } from "./native-event-spec.js";

afterEach(() => vi.restoreAllMocks());
const tripId = "a".repeat(24);
const event = (patch: Partial<CalendarEvent> = {}): CalendarEvent => ({
  key: `activity-${"b".repeat(24)}`, kind: "activity", id: "b".repeat(24), start: new Date("2026-09-25T12:00:00.789Z"), end: null, summary: "Paseo", ...patch,
});
const lines = (text: string) => text.split("\n");

describe("toNativeEventSpec", () => {
  it("ends where it starts when there is no duration (no invented interval) and truncates milliseconds to seconds", () => {
    const spec = toNativeEventSpec(event(), tripId);
    expect(spec.startDate).toBe(Date.parse("2026-09-25T12:00:00.000Z"));
    expect(spec.endDate).toBe(spec.startDate);
    const timed = toNativeEventSpec(event({ end: new Date("2026-09-25T13:30:00.999Z") }), tripId);
    expect(timed.endDate).toBe(Date.parse("2026-09-25T13:30:00.000Z"));
  });
  it("puts the marker on its own last line, after the description", () => {
    const marker = eventMarker(event().key, tripId);
    expect(marker).toBe(`travellier:activity-${"b".repeat(24)}@${tripId}`);
    expect(toNativeEventSpec(event(), tripId).notes).toBe(marker);
    const described = toNativeEventSpec(event({ description: "Línea 1\nLínea 2" }), tripId).notes;
    expect(lines(described)).toEqual(["Línea 1", "Línea 2", marker]);
  });
  it("keeps the marker whole when the notes are trimmed, by code points", () => {
    const marker = eventMarker(event().key, tripId);
    const notes = toNativeEventSpec(event({ description: "😀".repeat(5000) }), tripId).notes;
    expect([...notes].length).toBeLessThanOrEqual(maxNotesLength);
    expect(notes.endsWith(`\n${marker}`)).toBe(true);
    expect(notes).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
    expect(maxNotesLength).toBe(2000);
  });
  it("trims the title to 200 code points without splitting surrogate pairs", () => {
    const title = toNativeEventSpec(event({ summary: "😀".repeat(300) }), tripId).title;
    expect([...title]).toHaveLength(maxTitleLength);
    expect(maxTitleLength).toBe(200);
    expect(title).toBe("😀".repeat(200));
  });
  it("carries only title, notes, place, link and times: no expenses, participants, tokens, costs or flight numbers", () => {
    const polluted = { ...event({ description: "Cena", location: "Plaza", url: "https://maps.example/x" }), participants: ["u1"], expense: 100, accessToken: "tok", costPerPerson: 9, flightNumber: "AR1" } as CalendarEvent;
    const spec = toNativeEventSpec(polluted, tripId);
    expect(Object.keys(spec).sort()).toEqual(["endDate", "location", "notes", "startDate", "title", "url"]);
    expect(JSON.stringify(spec)).not.toMatch(/tok|AR1|participants|expense|costPerPerson/);
    expect(spec).toMatchObject({ location: "Plaza", url: "https://maps.example/x" });
    expect("location" in toNativeEventSpec(event(), tripId)).toBe(false);
  });
});

describe("specFingerprint", () => {
  it("is stable, changes with any managed field and ignores sub-second noise", () => {
    const base = toNativeEventSpec(event(), tripId);
    expect(specFingerprint(base)).toBe(specFingerprint(toNativeEventSpec(event(), tripId)));
    expect(specFingerprint(toNativeEventSpec(event({ start: new Date("2026-09-25T12:00:00.100Z") }), tripId))).toBe(specFingerprint(base));
    for (const patch of [{ summary: "Otro" }, { description: "x" }, { location: "Lugar" }, { url: "https://a.example" }, { start: new Date("2026-09-25T12:00:01Z") }, { end: new Date("2026-09-25T13:00:00Z") }] as Partial<CalendarEvent>[]) {
      expect(specFingerprint(toNativeEventSpec(event(patch), tripId))).not.toBe(specFingerprint(base));
    }
    expect(specFingerprint(base)).toMatch(/^[0-9a-f]{16}$/);
  });
  it("does not depend on the local zone: no local-time accessor or locale formatter is touched", () => {
    const calls = vi.fn();
    for (const name of ["getHours", "getDate", "getMonth", "getFullYear", "getTimezoneOffset", "toString", "toLocaleString", "toLocaleDateString", "toLocaleTimeString"] as const) {
      vi.spyOn(Date.prototype, name).mockImplementation(() => { calls(); return "x" as never; });
    }
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(() => { calls(); throw new Error("no Intl"); });
    const fingerprint = specFingerprint(toNativeEventSpec(event({ end: new Date("2026-09-25T13:00:00Z") }), tripId));
    expect(calls).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    expect(specFingerprint(toNativeEventSpec(event({ end: new Date("2026-09-25T13:00:00Z") }), tripId))).toBe(fingerprint);
  });
});
