// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  calendar: { requestPermissions: vi.fn(), checkPermissions: vi.fn(), findEvents: vi.fn(), createEvent: vi.fn(), modifyEvent: vi.fn(), deleteEvent: vi.fn() },
  camera: { requestPermissions: vi.fn(), checkPermissions: vi.fn() },
  push: { requestPermissions: vi.fn(), checkPermissions: vi.fn(), register: vi.fn(), addListener: vi.fn() },
  platform: { native: false },
}));
vi.mock("@capacitor/camera", async (original) => ({ ...await original<typeof import("@capacitor/camera")>(), Camera: native.camera }));
vi.mock("@capacitor/push-notifications", () => ({ PushNotifications: native.push }));
vi.mock("@capacitor/calendar", () => ({ Calendar: native.calendar }));
vi.mock("@capacitor/core", async (original) => {
  const module = await original<typeof import("@capacitor/core")>();
  return { ...module, Capacitor: { ...module.Capacitor, getPlatform: () => native.platform.native ? "android" : "web", isNativePlatform: () => native.platform.native } };
});

import App from "./App.js";
import { createCalendarRefStore } from "./calendar/calendar-ref-store.js";
import { createCalendarSyncService } from "./calendar/calendar-sync-service.js";
import { fakeCalendar, memoryPreferences } from "./calendar/calendar-test-fixture.js";
import { itineraryFixture, itineraryId } from "./trips/itinerary-test-fixture.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); native.platform.native = false; vi.clearAllMocks(); });
const jwt = (payload: object) => ["{\"alg\":\"none\"}", JSON.stringify(payload), "sig"].map((part, index) => index === 2 ? part : btoa(part).replace(/=+$/, "")).join(".")
const storage = () => ({ read: vi.fn().mockResolvedValue({ accessToken: "old", refreshToken: "refresh" }), save: vi.fn().mockResolvedValue(undefined), clear: vi.fn().mockResolvedValue(undefined) });
async function render(props: Partial<ComponentProps<typeof App>> = {}) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  const get = vi.fn().mockResolvedValue({ ok: true, value: itineraryFixture() });
  await act(async () => root.render(<MemoryRouter initialEntries={[`/trips/${itineraryId(1)}/itinerary`]}>
    <App auth={{ refresh: vi.fn().mockResolvedValue({ ok: true, value: { accessToken: jwt({ sub: "user-1" }), refreshToken: "refresh" } }) }} sessionStorage={storage()}
      itinerary={{ get }} nativeApp={{ getLaunchUrl: async () => undefined, addListener: async () => ({ remove: async () => undefined }) }} {...props} />
  </MemoryRouter>));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  return container;
}

describe("App native calendar sync wiring", () => {
  it("is inert on the web: no panel and no calendar plugin call", async () => {
    const container = await render();
    expect(container.textContent).toContain("Paseo por el centro");
    expect(container.querySelector(".calendar-sync")).toBeNull();
    for (const spy of Object.values(native.calendar)) expect(spy).not.toHaveBeenCalled();
  });
  it("on a native platform it offers the opt-in without checking events or requesting permissions on open", async () => {
    native.platform.native = true;
    native.calendar.checkPermissions.mockResolvedValue({ readCalendar: "prompt", writeCalendar: "prompt" });
    const container = await render();
    expect(container.querySelector(".calendar-sync")).not.toBeNull();
    expect(container.textContent).toContain("Mantener sincronizado con el calendario");
    expect(native.calendar.requestPermissions).not.toHaveBeenCalled();
    for (const name of ["findEvents", "createEvent", "modifyEvent", "deleteEvent"] as const) expect(native.calendar[name]).not.toHaveBeenCalled();
  });
  it("uses an injected service (also on the web)", async () => {
    const calendar = fakeCalendar();
    const service = createCalendarSyncService({ access: calendar.accessPort, events: calendar.port, store: createCalendarRefStore(memoryPreferences().preferences), accountId: () => "user-1", now: () => new Date() });
    const container = await render({ calendarSync: service });
    expect(container.querySelector(".calendar-sync")).not.toBeNull();
    expect(calendar.calls).toEqual([]);
  });
});
