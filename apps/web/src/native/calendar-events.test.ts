import { describe, expect, it, vi } from "vitest";
import { createCalendarEvents } from "./calendar-events.js";
import { createNativeCapabilities, type NativeDependencies } from "./capabilities.js";

const marker = `travellier:activity-${"b".repeat(24)}@${"a".repeat(24)}`;
const spec = { title: "Paseo", notes: `Notas\n${marker}`, location: "Plaza", url: "https://maps.example/x", startDate: 1_000, endDate: 2_000 };
const window = { startMs: 500, endMs: 2_500 };
const code = (value: string) => Object.assign(new Error("native detail with Paseo content"), { code: value });

function plugin() {
  return {
    findEvents: vi.fn(async () => ({ events: [] as { id: string; notes?: string; startDate: number; endDate: number; calendarId?: string }[] })),
    createEvent: vi.fn(async () => ({ id: "ev-1" } as { id?: string })),
    modifyEvent: vi.fn(async () => undefined),
    deleteEvent: vi.fn(async () => undefined),
    checkPermissions: vi.fn(),
    requestPermissions: vi.fn(),
  };
}
const adapter = (platform = "android", calendar = plugin()) => ({ calendar, port: createCalendarEvents(calendar as unknown as NativeDependencies["calendar"], () => platform) });

describe("calendar events adapter", () => {
  it("finds by marker in the window and keeps only events whose notes carry the exact marker line", async () => {
    const { calendar, port } = adapter();
    calendar.findEvents.mockResolvedValueOnce({ events: [
      { id: "1", notes: `Notas\n${marker}`, startDate: 10, endDate: 20, calendarId: "c1" },
      { id: "2", notes: `${marker}extra`, startDate: 10, endDate: 20 },
      { id: "3", notes: `cita ${marker}`, startDate: 10, endDate: 20 },
      { id: "4", startDate: 10, endDate: 20 },
      { id: "5", notes: `${marker}\r\n`, startDate: 11, endDate: 21 },
    ] });
    expect(await port.find(marker, window)).toEqual({ ok: true, value: [{ id: "1", startMs: 10, endMs: 20, calendarId: "c1" }, { id: "5", startMs: 11, endMs: 21 }] });
    expect(calendar.findEvents).toHaveBeenCalledWith({ notes: marker, startDate: 500, endDate: 2_500 });
  });
  it("creates with the managed fields only and returns the id", async () => {
    const { calendar, port } = adapter("ios");
    expect(await port.create(spec)).toEqual({ ok: true, value: { id: "ev-1" } });
    expect(calendar.createEvent).toHaveBeenCalledWith(spec);
    const bare = { title: "T", notes: marker, startDate: 1, endDate: 1 };
    await port.create(bare);
    expect(calendar.createEvent).toHaveBeenLastCalledWith(bare);
  });
  it("fails a create that reports no id (it cannot be tracked) so the marker adoption takes over later", async () => {
    const { calendar, port } = adapter();
    calendar.createEvent.mockResolvedValueOnce({});
    expect(await port.create(spec)).toMatchObject({ ok: false, error: { kind: "native" } });
  });
  it("updates by marker and previous window, replacing the managed fields", async () => {
    const { calendar, port } = adapter();
    expect(await port.update(marker, window, spec)).toEqual({ ok: true, value: undefined });
    expect(calendar.modifyEvent).toHaveBeenCalledWith({ filter: { notes: marker, startDate: 500, endDate: 2_500 }, newEvent: spec });
  });
  it("removes by id", async () => {
    const { calendar, port } = adapter();
    expect(await port.remove("ev-9")).toEqual({ ok: true, value: undefined });
    expect(calendar.deleteEvent).toHaveBeenCalledWith({ id: "ev-9" });
  });
  it("maps «no match» (CLDR-0001) to missing in update and remove, and denial (CLDR-0020) to denied", async () => {
    const { calendar, port } = adapter();
    calendar.modifyEvent.mockRejectedValueOnce(code("OS-PLUG-CLDR-0001"));
    calendar.deleteEvent.mockRejectedValueOnce(code("OS-PLUG-CLDR-0001"));
    expect(await port.update(marker, window, spec)).toMatchObject({ ok: false, error: { kind: "missing" } });
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
    for (const result of [await port.find(marker, window), await port.create(spec), await port.update(marker, window, spec), await port.remove("x")]) {
      expect(result).toMatchObject({ ok: false, error: { kind: "unsupported" } });
    }
    for (const spy of [calendar.findEvents, calendar.createEvent, calendar.modifyEvent, calendar.deleteEvent]) expect(spy).not.toHaveBeenCalled();
  });
  it("is built without effects and never requests or checks permissions", async () => {
    const { calendar, port } = adapter();
    expect(calendar.checkPermissions).not.toHaveBeenCalled();
    await port.find(marker, window); await port.create(spec); await port.update(marker, window, spec); await port.remove("x");
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
