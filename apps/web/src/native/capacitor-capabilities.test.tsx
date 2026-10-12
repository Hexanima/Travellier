// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  camera: { requestPermissions: vi.fn(), checkPermissions: vi.fn() },
  push: { requestPermissions: vi.fn(), checkPermissions: vi.fn(), register: vi.fn(), addListener: vi.fn() },
  calendar: { requestPermissions: vi.fn(), checkPermissions: vi.fn() },
}));
vi.mock("@capacitor/camera", async (original) => ({ ...await original<typeof import("@capacitor/camera")>(), Camera: native.camera }));
vi.mock("@capacitor/push-notifications", () => ({ PushNotifications: native.push }));
vi.mock("@capacitor/calendar", () => ({ Calendar: native.calendar }));
vi.mock("@capacitor/core", async (original) => {
  const module = await original<typeof import("@capacitor/core")>();
  return { ...module, Capacitor: { ...module.Capacitor, getPlatform: () => "ios" } };
});

import App from "../App.js";
import { createCapacitorCapabilities } from "./capacitor-capabilities.js";

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
