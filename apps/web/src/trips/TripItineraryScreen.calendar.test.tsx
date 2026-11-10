// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCalendarRefStore } from "../calendar/calendar-ref-store.js";
import { createCalendarSyncService } from "../calendar/calendar-sync-service.js";
import { fakeCalendar, memoryPreferences } from "../calendar/calendar-test-fixture.js";
import { itineraryFixture, itineraryId } from "./itinerary-test-fixture.js";
import type { TripItineraryApi, TripItineraryResponse } from "./trip-itinerary-api.js";
import { TripItineraryScreen } from "./TripItineraryScreen.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  document.body.replaceChildren();
  vi.restoreAllMocks();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});
const fixture = () => itineraryFixture() as TripItineraryResponse;
const enableLabel = "Mantener sincronizado con el calendario";

function world(options: { permission?: "grant" | "deny"; visible?: boolean } = {}) {
  const calendar = fakeCalendar();
  if (options.permission === "deny") calendar.set("denied", "denied");
  const prefs = memoryPreferences();
  const service = createCalendarSyncService({ access: calendar.accessPort, events: calendar.port, store: createCalendarRefStore(prefs.preferences), accountId: () => "user-1", now: () => new Date("2026-11-10T15:30:00.000Z") });
  return { calendar, prefs, service };
}
async function render(get: TripItineraryApi["get"], service?: ReturnType<typeof world>["service"]) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={[`/trips/${itineraryId(1)}/itinerary`]}>
    <Routes><Route path="/trips/:tripId/itinerary" element={<TripItineraryScreen itinerary={{ get }} calendarSync={service} timeZone="America/Argentina/Buenos_Aires"
      icsExport={{ download: () => ({ ok: true as const }), now: () => new Date("2026-11-10T12:34:56.000Z") }} />} /></Routes>
  </MemoryRouter>));
  return container;
}
const button = (container: HTMLElement, label: string) => Array.from(container.querySelectorAll("button")).find((item) => item.textContent === label);
const click = (element: Element) => act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const setVisibility = (value: "visible" | "hidden") => Object.defineProperty(document, "visibilityState", { configurable: true, get: () => value });

describe("itinerary screen native calendar sync", () => {
  it("renders nothing and runs nothing without a service (web)", async () => {
    const container = await render(vi.fn().mockResolvedValue({ ok: true, value: fixture() }));
    expect(button(container, enableLabel)).toBeUndefined();
    expect(container.querySelector(".calendar-sync")).toBeNull();
    expect(container.textContent).toContain("El archivo es una copia estática");
  });
  it("offers the opt-in after loading and touches neither the calendar nor the permission on open", async () => {
    const { service, calendar } = world();
    const container = await render(vi.fn().mockResolvedValue({ ok: true, value: fixture() }), service);
    await settle();
    expect(button(container, enableLabel)).toBeDefined();
    expect(calendar.calls).toEqual([]);
    expect(calendar.accessPort.requestAccess).not.toHaveBeenCalled();
    expect(calendar.events.size).toBe(0);
  });
  it("is not offered while loading or when the itinerary fails to load", async () => {
    const { service } = world();
    const pending = await render(vi.fn(() => new Promise<never>(() => undefined)), service);
    expect(pending.querySelector(".calendar-sync")).toBeNull();
    const failed = await render(vi.fn().mockResolvedValue({ ok: false, error: { kind: "network" } }), service);
    expect(failed.querySelector(".calendar-sync")).toBeNull();
  });
  it("asks for the permission only when the user activates it, then creates the events and announces it once", async () => {
    const { service, calendar } = world();
    const container = await render(vi.fn().mockResolvedValue({ ok: true, value: fixture() }), service);
    await click(button(container, enableLabel)!);
    await settle();
    expect(calendar.accessPort.requestAccess).toHaveBeenCalledExactlyOnceWith("manage");
    expect(calendar.events.size).toBe(5);
    expect(container.querySelector(".calendar-sync [role=\"status\"]")?.textContent).toMatch(/^Sincronizado con el calendario el /);
    expect(container.querySelectorAll(".calendar-sync [role=\"alert\"]")).toHaveLength(0);
    expect(button(container, "Dejar de sincronizar")).toBeDefined();
  });
  it("denied: explains the system settings without a settings button, never says synced, and the app and the .ics export keep working", async () => {
    const { service, calendar } = world({ permission: "deny" });
    const container = await render(vi.fn().mockResolvedValue({ ok: true, value: fixture() }), service);
    await click(button(container, enableLabel)!);
    await settle();
    const panel = container.querySelector(".calendar-sync")!;
    expect(panel.textContent).toContain("Ajustes del sistema");
    expect(panel.textContent).not.toContain("Sincronizado con el calendario");
    expect(Array.from(panel.querySelectorAll("button"))).toHaveLength(0);
    expect(calendar.events.size).toBe(0);
    expect(container.textContent).toContain("Paseo por el centro");
    expect(button(container, "Exportar a calendario (.ics)")).toBeDefined();
  });
  it("error: one alert, a Retry that works once the calendar does, and the itinerary stays usable", async () => {
    const { service, calendar } = world();
    calendar.failing.set("create", () => true);
    const container = await render(vi.fn().mockResolvedValue({ ok: true, value: fixture() }), service);
    await click(button(container, enableLabel)!);
    await settle();
    expect(container.querySelectorAll("[role=\"alert\"]")).toHaveLength(1);
    expect(container.textContent).toContain("Visita al museo");
    calendar.failing.clear();
    await click(button(container, "Reintentar")!);
    await settle();
    expect(calendar.events.size).toBe(5);
    expect(container.querySelectorAll("[role=\"alert\"]")).toHaveLength(0);
  });
  it("keeps the focus on the pressed button while it works (aria-disabled, no disabled) and ignores a second press", async () => {
    const { service, calendar } = world();
    calendar.dialog.grant = true;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(calendar.accessPort.requestAccess).mockImplementationOnce(async () => { await gate; return { ok: true as const, value: { read: "granted", write: "granted" } }; });
    const container = await render(vi.fn().mockResolvedValue({ ok: true, value: fixture() }), service);
    const enable = button(container, enableLabel)!;
    enable.focus();
    await click(enable);
    await click(enable);
    expect(enable.getAttribute("aria-disabled")).toBe("true");
    expect(enable.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(enable);
    expect(calendar.accessPort.requestAccess).toHaveBeenCalledTimes(1);
    release();
    await settle();
  });
  it("when already enabled, a load of the itinerary syncs without any dialog, and a change updates the event", async () => {
    const { service, calendar, prefs } = world();
    const first = await render(vi.fn().mockResolvedValue({ ok: true, value: fixture() }), service);
    await click(button(first, enableLabel)!);
    await settle();
    const ids = [...calendar.events.keys()];
    await act(async () => roots.splice(0).forEach((root) => root.unmount()));
    // A new session of the app over the same Preferences and calendar.
    const again = createCalendarSyncService({ access: calendar.accessPort, events: calendar.port, store: createCalendarRefStore(prefs.preferences), accountId: () => "user-1", now: () => new Date("2026-11-10T16:00:00.000Z") });
    const edited = fixture();
    edited.activities[0]!.title = "Paseo renombrado";
    calendar.calls.length = 0;
    vi.mocked(calendar.accessPort.requestAccess).mockClear();
    const second = await render(vi.fn().mockResolvedValue({ ok: true, value: edited }), again);
    await settle();
    expect(calendar.accessPort.requestAccess).not.toHaveBeenCalled();
    expect(calendar.calls).toEqual(["update"]);
    expect([...calendar.events.keys()]).toEqual(ids);
    expect(second.querySelector(".calendar-sync [role=\"status\"]")?.textContent).toMatch(/^Sincronizado con el calendario/);
  });
  it("does not sync from a load while the app is hidden", async () => {
    const { service, calendar } = world();
    const first = await render(vi.fn().mockResolvedValue({ ok: true, value: fixture() }), service);
    await click(button(first, enableLabel)!);
    await settle();
    await act(async () => roots.splice(0).forEach((root) => root.unmount()));
    calendar.calls.length = 0;
    setVisibility("hidden");
    const edited = fixture();
    edited.activities[0]!.title = "No debe sincronizar";
    await render(vi.fn().mockResolvedValue({ ok: true, value: edited }), service);
    await settle();
    expect(calendar.calls).toEqual([]);
  });
  it("on returning to the foreground it re-reads the itinerary and syncs only while enabled", async () => {
    const { service, calendar } = world();
    const get = vi.fn().mockResolvedValue({ ok: true, value: fixture() });
    const container = await render(get, service);
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await settle();
    expect(get).toHaveBeenCalledTimes(1);
    await click(button(container, enableLabel)!);
    await settle();
    const edited = fixture();
    edited.activities[0]!.title = "Cambio remoto";
    get.mockResolvedValue({ ok: true, value: edited });
    calendar.calls.length = 0;
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_000);
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await settle();
    expect(get).toHaveBeenCalledTimes(2);
    expect(calendar.titles()).toContain("Cambio remoto");
  });
  it("«Dejar de sincronizar» keeps the events and «Quitar del calendario» deletes them after confirming", async () => {
    const { service, calendar } = world();
    const container = await render(vi.fn().mockResolvedValue({ ok: true, value: fixture() }), service);
    await click(button(container, enableLabel)!);
    await settle();
    await click(button(container, "Dejar de sincronizar")!);
    await settle();
    expect(calendar.events.size).toBe(5);
    expect(button(container, enableLabel)).toBeDefined();
    await click(button(container, enableLabel)!);
    await settle();
    await click(button(container, "Quitar del calendario")!);
    expect(calendar.events.size).toBe(5);
    await click(button(container, "Quitar")!);
    await settle();
    expect(calendar.events.size).toBe(0);
    expect(button(container, enableLabel)).toBeDefined();
  });
});
