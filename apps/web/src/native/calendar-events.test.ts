import { describe, expect, it, vi } from "vitest";
import { createCalendarEvents } from "./calendar-events.js";
import { createNativeCapabilities, type NativeDependencies } from "./capabilities.js";

const marker = `travellier:activity-${"b".repeat(24)}@${"a".repeat(24)}`;
const spec = { title: "Paseo", notes: `Notas\n${marker}`, location: "Plaza", url: "https://maps.example/x", startDate: 1_000, endDate: 2_000 };
const window = { startMs: 500, endMs: 2_500 };
const code = (value: string) => Object.assign(new Error("native detail with Paseo content"), { code: value });
type Found = { id: string; notes?: string; location?: string; startDate: number; endDate: number; calendarId?: string };

function plugin() {
  return {
    findEvents: vi.fn(async () => ({ events: [] as Found[] })),
    createEvent: vi.fn(async () => ({ id: "ev-1" } as { id?: string })),
    modifyEvent: vi.fn(async () => undefined),
    deleteEvent: vi.fn(async () => undefined),
    checkPermissions: vi.fn(),
    requestPermissions: vi.fn(),
  };
}
const adapter = (platform = "android", calendar = plugin()) => ({ calendar, port: createCalendarEvents(calendar as unknown as NativeDependencies["calendar"], () => platform) });
const exists = (calendar: ReturnType<typeof plugin>, ...events: Pick<Found, "id" | "notes" | "location" | "calendarId">[]) =>
  calendar.findEvents.mockResolvedValue({ events: events.map((event) => ({ startDate: 1_000, endDate: 2_000, ...event })) });

describe("calendar events adapter", () => {
  it("finds by marker in the window and keeps only events whose notes carry the marker as a line of its own", async () => {
    const { calendar, port } = adapter();
    calendar.findEvents.mockResolvedValueOnce({ events: [
      { id: "1", notes: `Notas\n${marker}`, startDate: 10, endDate: 20, calendarId: "c1" },
      { id: "2", notes: `${marker}extra`, startDate: 10, endDate: 20 },
      { id: "3", notes: `cita ${marker}`, startDate: 10, endDate: 20 },
      { id: "4", startDate: 10, endDate: 20 },
      { id: "5", notes: `${marker}\r\n`, startDate: 11, endDate: 21 },
      // Android appends the url to the last line of the notes when an event was created with one: it is still the marker.
      { id: "6", notes: `Notas\n${marker} https://maps.example/x`, startDate: 12, endDate: 22 },
      { id: "6", notes: `Notas\n${marker} https://maps.example/x`, startDate: 12, endDate: 22 },
      { id: "7", notes: `${marker}\thttps://x`, startDate: 13, endDate: 23 },
    ] });
    expect(await port.find(marker, window)).toEqual({ ok: true, value: [{ id: "1", startMs: 10, endMs: 20, calendarId: "c1" }, { id: "5", startMs: 11, endMs: 21 },
      { id: "6", startMs: 12, endMs: 22 }, { id: "7", startMs: 13, endMs: 23 }] });
    expect(calendar.findEvents).toHaveBeenCalledWith({ notes: marker, startDate: 500, endDate: 2_500 });
  });
  it("never mistakes the marker of another key for this one (strict delimitation)", async () => {
    const { calendar, port } = adapter();
    const longer = `${marker}X`;
    const sibling = marker.replace("b".repeat(24), `${"b".repeat(23)}c`);
    calendar.findEvents.mockResolvedValueOnce({ events: [
      { id: "1", notes: longer, startDate: 1, endDate: 2 }, { id: "2", notes: `${marker}-2`, startDate: 1, endDate: 2 },
      { id: "3", notes: `${marker}9 ${marker}`, startDate: 1, endDate: 2 }, { id: "4", notes: sibling, startDate: 1, endDate: 2 },
    ] });
    expect(await port.find(marker, window)).toEqual({ ok: true, value: [] });
    calendar.findEvents.mockResolvedValueOnce({ events: [{ id: "1", notes: marker, startDate: 1, endDate: 2 }] });
    expect(await port.find(longer, window)).toEqual({ ok: true, value: [] });
  });
  it("creates with the managed fields only, never sends url (the link is its own line above the marker) and returns the id", async () => {
    const { calendar, port } = adapter("ios");
    expect(await port.create(spec)).toEqual({ ok: true, value: { id: "ev-1" } });
    expect(calendar.createEvent).toHaveBeenCalledWith({ title: "Paseo", notes: `Notas\nhttps://maps.example/x\n${marker}`, location: "Plaza", startDate: 1_000, endDate: 2_000 });
    const bare = { title: "T", notes: marker, startDate: 1, endDate: 1 };
    await port.create(bare);
    expect(calendar.createEvent).toHaveBeenLastCalledWith(bare);
    const android = adapter("android");
    await android.port.create({ ...spec, notes: marker });
    expect(android.calendar.createEvent).toHaveBeenCalledWith({ title: "Paseo", notes: `https://maps.example/x\n${marker}`, location: "Plaza", startDate: 1_000, endDate: 2_000 });
    expect(JSON.stringify([calendar.createEvent.mock.calls, android.calendar.createEvent.mock.calls])).not.toContain("\"url\"");
  });
  it("fails a create that reports no id (it cannot be tracked) so the marker adoption takes over later", async () => {
    const { calendar, port } = adapter();
    calendar.createEvent.mockResolvedValueOnce({});
    expect(await port.create(spec)).toMatchObject({ ok: false, error: { kind: "native" } });
  });
  it("updates in place when the referenced event is the only candidate: filter by marker and window, managed fields, never url", async () => {
    const { calendar, port } = adapter();
    exists(calendar, { id: "ev-9", notes: marker });
    expect(await port.update("ev-9", marker, window, spec)).toEqual({ ok: true, value: { id: "ev-9" } });
    expect(calendar.modifyEvent).toHaveBeenCalledWith({ filter: { notes: marker, startDate: 500, endDate: 2_500 },
      newEvent: { title: "Paseo", notes: `Notas\nhttps://maps.example/x\n${marker}`, location: "Plaza", startDate: 1_000, endDate: 2_000 } });
    expect(calendar.deleteEvent).not.toHaveBeenCalled();
    expect(calendar.createEvent).not.toHaveBeenCalled();
  });
  it("clears the place in iOS sending an empty location, and recreates in Android (the plugin ignores empty strings there)", async () => {
    const noPlace = { title: "Paseo", notes: marker, startDate: 1_000, endDate: 2_000 };
    const ios = adapter("ios");
    exists(ios.calendar, { id: "ev-9", notes: marker, location: "Plaza" });
    expect(await ios.port.update("ev-9", marker, window, noPlace)).toEqual({ ok: true, value: { id: "ev-9" } });
    expect(ios.calendar.modifyEvent).toHaveBeenCalledWith({ filter: expect.anything(), newEvent: { ...noPlace, location: "" } });
    const android = adapter("android");
    exists(android.calendar, { id: "ev-9", notes: marker, location: "Plaza", calendarId: "c7" });
    expect(await android.port.update("ev-9", marker, window, noPlace)).toEqual({ ok: true, value: { id: "ev-1" } });
    expect(android.calendar.modifyEvent).not.toHaveBeenCalled();
    expect(android.calendar.deleteEvent).toHaveBeenCalledWith({ id: "ev-9" });
    expect(android.calendar.createEvent).toHaveBeenCalledWith({ ...noPlace, calendarId: "c7" });
  });
  it("is tied to the referenced id: another event that only contains the marker is never modified (delete by id and create again)", async () => {
    const { calendar, port } = adapter();
    exists(calendar, { id: "foreign", notes: `cita ${marker}` }, { id: "ev-9", notes: marker, calendarId: "c1" });
    expect(await port.update("ev-9", marker, window, spec)).toEqual({ ok: true, value: { id: "ev-1" } });
    expect(calendar.modifyEvent).not.toHaveBeenCalled();
    expect(calendar.deleteEvent).toHaveBeenCalledExactlyOnceWith({ id: "ev-9" });
    expect(calendar.createEvent).toHaveBeenCalledWith(expect.objectContaining({ title: "Paseo", calendarId: "c1" }));
  });
  it("removes copies that carry the marker and then updates the referenced event in place", async () => {
    const { calendar, port } = adapter();
    exists(calendar, { id: "copy", notes: marker }, { id: "ev-9", notes: marker });
    expect(await port.update("ev-9", marker, window, spec)).toEqual({ ok: true, value: { id: "ev-9" } });
    expect(calendar.deleteEvent).toHaveBeenCalledExactlyOnceWith({ id: "copy" });
    expect(calendar.modifyEvent).toHaveBeenCalledTimes(1);
  });
  it("answers missing, touching nothing, when the referenced event is not found or lost its marker", async () => {
    const { calendar, port } = adapter();
    exists(calendar, { id: "other", notes: marker });
    expect(await port.update("ev-9", marker, window, spec)).toMatchObject({ ok: false, error: { kind: "missing" } });
    exists(calendar, { id: "ev-9", notes: `x${marker}` });
    expect(await port.update("ev-9", marker, window, spec)).toMatchObject({ ok: false, error: { kind: "missing" } });
    expect(calendar.modifyEvent).not.toHaveBeenCalled();
    expect(calendar.deleteEvent).not.toHaveBeenCalled();
  });
  it("removes by id", async () => {
    const { calendar, port } = adapter();
    expect(await port.remove("ev-9")).toEqual({ ok: true, value: undefined });
    expect(calendar.deleteEvent).toHaveBeenCalledWith({ id: "ev-9" });
  });
  it("maps «no match» (CLDR-0001) to missing in update and remove, and denial (CLDR-0020) to denied", async () => {
    const { calendar, port } = adapter();
    exists(calendar, { id: "ev-9", notes: marker });
    calendar.modifyEvent.mockRejectedValueOnce(code("OS-PLUG-CLDR-0001"));
    calendar.deleteEvent.mockRejectedValueOnce(code("OS-PLUG-CLDR-0001"));
    expect(await port.update("ev-9", marker, window, spec)).toMatchObject({ ok: false, error: { kind: "missing" } });
    expect(await port.remove("x")).toMatchObject({ ok: false, error: { kind: "missing" } });
    calendar.findEvents.mockRejectedValueOnce(code("OS-PLUG-CLDR-0020"));
    expect(await port.find(marker, window)).toMatchObject({ ok: false, error: { kind: "denied" } });
    calendar.createEvent.mockRejectedValueOnce(new Error("boom"));
    expect(await port.create(spec)).toMatchObject({ ok: false, error: { kind: "native" } });
  });
  it("never leaks plugin messages or event content in the error", async () => {
    const { calendar, port } = adapter();
    calendar.createEvent.mockRejectedValueOnce(code("OS-PLUG-CLDR-0009"));
    const result = await port.create(spec);
    expect(JSON.stringify(result)).not.toMatch(/Paseo|content/);
  });
  it("is unsupported on the web without touching the plugin", async () => {
    const { calendar, port } = adapter("web");
    for (const result of [await port.find(marker, window), await port.create(spec), await port.update("ev-9", marker, window, spec), await port.remove("x")]) {
      expect(result).toMatchObject({ ok: false, error: { kind: "unsupported" } });
    }
    for (const spy of [calendar.findEvents, calendar.createEvent, calendar.modifyEvent, calendar.deleteEvent]) expect(spy).not.toHaveBeenCalled();
  });
  it("is built without effects and never requests or checks permissions", async () => {
    const { calendar, port } = adapter();
    expect(calendar.checkPermissions).not.toHaveBeenCalled();
    await port.find(marker, window); await port.create(spec); await port.update("ev-9", marker, window, spec); await port.remove("x");
    expect(calendar.checkPermissions).not.toHaveBeenCalled();
    expect(calendar.requestPermissions).not.toHaveBeenCalled();
  });
  it("is exposed by the native capabilities as calendarEvents", () => {
    const calendar = plugin();
    const capabilities = createNativeCapabilities({ platform: () => "ios", calendar } as unknown as NativeDependencies);
    expect(typeof capabilities.calendarEvents.find).toBe("function");
    expect(calendar.findEvents).not.toHaveBeenCalled();
  });
});
