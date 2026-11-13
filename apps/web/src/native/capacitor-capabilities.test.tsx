// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  camera: { requestPermissions: vi.fn(), checkPermissions: vi.fn() },
  push: { requestPermissions: vi.fn(), checkPermissions: vi.fn(), register: vi.fn(), addListener: vi.fn() },
  calendar: { requestPermissions: vi.fn(), checkPermissions: vi.fn(), findEvents: vi.fn(), createEvent: vi.fn(), modifyEvent: vi.fn(), deleteEvent: vi.fn() },
  filesystem: { writeFile: vi.fn(), deleteFile: vi.fn() },
  share: { canShare: vi.fn(), share: vi.fn() },
}));
vi.mock("@capacitor/camera", async (original) => ({ ...await original<typeof import("@capacitor/camera")>(), Camera: native.camera }));
vi.mock("@capacitor/push-notifications", () => ({ PushNotifications: native.push }));
vi.mock("@capacitor/calendar", () => ({ Calendar: native.calendar }));
vi.mock("@capacitor/filesystem", async (original) => ({ ...await original<typeof import("@capacitor/filesystem")>(), Filesystem: native.filesystem }));
vi.mock("@capacitor/share", () => ({ Share: native.share }));
vi.mock("@capacitor/core", async (original) => {
  const module = await original<typeof import("@capacitor/core")>();
  return { ...module, Capacitor: { ...module.Capacitor, getPlatform: () => "ios" } };
});

import App from "../App.js";
import { createCapacitorCapabilities, createCapacitorIcsSharer } from "./capacitor-capabilities.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Capacitor composition", () => {
  it("connects the real plugin boundary through Result without requesting access", async () => {
    native.calendar.checkPermissions.mockResolvedValueOnce({ readCalendar: "denied", writeCalendar: "granted" });
    const services = createCapacitorCapabilities();
    expect(services).toBeDefined();
    if (services) expect(await services.calendar.checkAccess()).toEqual({ ok: true, value: { read: "denied", write: "granted" } });
    for (const plugin of [native.camera, native.push, native.calendar]) expect(plugin.requestPermissions).not.toHaveBeenCalled();
    expect(native.push.register).not.toHaveBeenCalled();
  });

  it("exposes the calendar events port over the same plugin without calling it at creation", () => {
    expect(typeof createCapacitorCapabilities().calendarEvents.update).toBe("function");
    for (const name of ["findEvents", "createEvent", "modifyEvent", "deleteEvent"] as const) expect(native.calendar[name]).not.toHaveBeenCalled();
  });

  it("builds the .ics sharer without plugin calls and writes then shares through the real plugin boundary", async () => {
    const sharer = createCapacitorIcsSharer();
    for (const fn of [native.filesystem.writeFile, native.share.canShare, native.share.share]) expect(fn).not.toHaveBeenCalled();
    native.filesystem.writeFile.mockResolvedValueOnce({ uri: "file:///cache/travellier-viaje.ics" });
    native.share.canShare.mockResolvedValueOnce({ value: true });
    native.share.share.mockResolvedValueOnce({});
    expect(await sharer.save("BEGIN:VCALENDAR", "travellier-viaje.ics")).toEqual({ ok: true, via: "shared" });
    expect(native.share.share).toHaveBeenCalledWith({ title: "travellier-viaje.ics", files: ["file:///cache/travellier-viaje.ics"] });
  });

  it("mounts and remounts the app under StrictMode without native permission dialogs", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(
        <StrictMode><MemoryRouter initialEntries={["/login"]}>
          <App apiBaseUrl="https://api.example.test"
            sessionStorage={{ read: async () => null, save: async () => undefined, clear: async () => undefined }}
            nativeApp={{ getLaunchUrl: async () => undefined, addListener: async () => ({ remove: async () => undefined }) }} />
        </MemoryRouter></StrictMode>,
      ));
      expect(container.textContent).toContain("Iniciar sesión");
      for (const plugin of [native.camera, native.push, native.calendar]) expect(plugin.requestPermissions).not.toHaveBeenCalled();
      expect(native.push.register).not.toHaveBeenCalled();
      expect(native.push.addListener).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
