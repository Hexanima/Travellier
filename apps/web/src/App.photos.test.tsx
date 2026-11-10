// @vitest-environment jsdom
import { err, NativeCapabilityError, ok } from "app-domain";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  camera: { requestPermissions: vi.fn(), checkPermissions: vi.fn(), takePhoto: vi.fn(), chooseFromGallery: vi.fn(), pickImages: vi.fn() },
  push: { requestPermissions: vi.fn(), checkPermissions: vi.fn(), register: vi.fn(), unregister: vi.fn(), addListener: vi.fn() },
  calendar: { requestPermissions: vi.fn(), checkPermissions: vi.fn() },
}));
vi.mock("@capacitor/camera", async (original) => ({ ...await original<typeof import("@capacitor/camera")>(), Camera: native.camera }));
vi.mock("@capacitor/push-notifications", () => ({ PushNotifications: native.push }));
vi.mock("@capacitor/calendar", () => ({ Calendar: native.calendar }));
vi.mock("@capacitor/core", async (original) => {
  const module = await original<typeof import("@capacitor/core")>();
  return { ...module, Capacitor: { ...module.Capacitor, getPlatform: () => "ios" } };
});

import App from "./App.js";
import { itineraryId } from "./trips/itinerary-test-fixture.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); vi.unstubAllGlobals(); });
const tripId = itineraryId(1);
const path = `/trips/${tripId}/memories/new`;
const session = { read: async () => ({ accessToken: "old", refreshToken: "refresh" }), save: async () => undefined, clear: async () => undefined };
const click = async (element: Element | undefined) => { expect(element).toBeDefined(); await act(async () => element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))); };
const button = (container: ParentNode, label: string) => Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.trim() === label);

describe("App photo wiring", () => {
  it("builds the default photo dependencies without asking the device for any permission at startup", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) =>
      url.endsWith("/auth/refresh") ? new Response(JSON.stringify({ accessToken: "renewed", refreshToken: "renewed-refresh" })) : new Response("{}", { status: 500 })));
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container); roots.push(root);
    await act(async () => root.render(<MemoryRouter initialEntries={[path]}><App apiBaseUrl="https://api.test" sessionStorage={session} /></MemoryRouter>));
    expect(container.querySelector(".post-photos-section")).not.toBeNull();
    expect(button(container, "Agregar fotos")).toBeDefined(); expect(button(container, "Sacar foto")).toBeDefined();
    for (const plugin of [native.camera, native.push, native.calendar]) {
      expect(plugin.requestPermissions).not.toHaveBeenCalled(); expect(plugin.checkPermissions).not.toHaveBeenCalled();
    }
    expect(native.camera.chooseFromGallery).not.toHaveBeenCalled(); expect(native.camera.takePhoto).not.toHaveBeenCalled();
    expect(native.push.register).not.toHaveBeenCalled();
  });
  it("shows no photo section when there is no photo api to talk to", async () => {
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container); roots.push(root);
    await act(async () => root.render(<MemoryRouter initialEntries={[path]}>
      <App auth={{ refresh: vi.fn().mockResolvedValue({ ok: true, value: { accessToken: "a", refreshToken: "r" } }) }} sessionStorage={session} posts={{}} /></MemoryRouter>));
    expect(container.querySelector('[name="description"]')).not.toBeNull();
    expect(container.querySelector(".post-photos-section")).toBeNull();
  });
  it("passes the injected photo api and device dependencies to the composer: reserve, direct transfer, then create with the key", async () => {
    const reserve = vi.fn().mockResolvedValue({ ok: true, value: [{ key: `trips/${tripId}/photos/k1`, uploadUrl: "https://s3.test/k1", headers: { "content-type": "image/jpeg" }, expiresAt: Date.UTC(2026, 10, 10, 12, 15) }] });
    const put = vi.fn().mockResolvedValue({ ok: true });
    const select = vi.fn().mockResolvedValueOnce(ok([{ reference: "file:///1.jpg", previewUrl: "https://localhost/1.jpg", format: "jpeg" }])).mockResolvedValue(err(new NativeCapabilityError("cancelled")));
    const read = vi.fn().mockResolvedValue(ok(new Blob(["x"], { type: "image/jpeg" })));
    const create = vi.fn().mockResolvedValue({ ok: true, value: { id: itineraryId(30), tripId, authorId: itineraryId(20), description: null, mapsUrl: null, activityId: null, parentPostId: null, transportId: null, createdAt: "2026-11-10T12:00:00.000Z" } });
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container); roots.push(root);
    await act(async () => root.render(<MemoryRouter initialEntries={[path]}>
      <App auth={{ refresh: vi.fn().mockResolvedValue({ ok: true, value: { accessToken: "a", refreshToken: "r" } }) }} sessionStorage={session} posts={{ create, list: vi.fn().mockResolvedValue({ ok: true, value: [] }) }}
        photos={{ reserve }} devicePhotos={{ source: { checkPermission: vi.fn(), select }, reader: { read }, transfer: { put }, now: () => Date.UTC(2026, 10, 10, 12, 0) }} /></MemoryRouter>));
    await click(button(container, "Agregar fotos"));
    expect(select).toHaveBeenCalledExactlyOnceWith("gallery");
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(reserve).toHaveBeenCalledExactlyOnceWith(tripId, [{ contentType: "image/jpeg", sizeBytes: 1 }]);
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0]![0]).toBe("https://s3.test/k1");
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { photos: [{ key: `trips/${tripId}/photos/k1` }] });
    for (const plugin of [native.camera]) expect(plugin.requestPermissions).not.toHaveBeenCalled();
  });
});
