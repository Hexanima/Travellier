// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  state: { isNative: false },
  camera: { requestPermissions: vi.fn(), checkPermissions: vi.fn(), takePhoto: vi.fn(), chooseFromGallery: vi.fn(), pickImages: vi.fn() },
  push: { requestPermissions: vi.fn(), checkPermissions: vi.fn(), register: vi.fn(), unregister: vi.fn(), addListener: vi.fn() },
  calendar: { requestPermissions: vi.fn(), checkPermissions: vi.fn() },
}));
vi.mock("@capacitor/camera", async (original) => ({ ...await original<typeof import("@capacitor/camera")>(), Camera: native.camera }));
vi.mock("@capacitor/push-notifications", () => ({ PushNotifications: native.push }));
vi.mock("@capacitor/calendar", () => ({ Calendar: native.calendar }));
vi.mock("@capacitor/core", async (original) => {
  const module = await original<typeof import("@capacitor/core")>();
  return { ...module, Capacitor: { ...module.Capacitor, isNativePlatform: () => native.state.isNative, getPlatform: () => native.state.isNative ? "ios" : "web" } };
});

import App from "./App.js";
import { itineraryId } from "./trips/itinerary-test-fixture.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
const originalUrl = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
beforeEach(() => { native.state.isNative = false; });
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  document.body.replaceChildren(); vi.unstubAllGlobals(); vi.clearAllMocks();
  if (originalUrl) Object.defineProperty(URL, "createObjectURL", originalUrl); else Reflect.deleteProperty(URL, "createObjectURL");
});
const tripId = itineraryId(1);
const path = `/trips/${tripId}/memories/new`;
const session = { read: async () => ({ accessToken: "old", refreshToken: "refresh" }), save: async () => undefined, clear: async () => undefined };
const auth = { refresh: vi.fn().mockResolvedValue({ ok: true, value: { accessToken: "a", refreshToken: "r" } }) };
const click = async (element: Element | undefined) => { expect(element).toBeDefined(); await act(async () => element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))); };
const button = (container: ParentNode, label: string) => Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.trim() === label);
const render = async () => {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}>
    <App auth={auth} sessionStorage={session} posts={{ create: vi.fn(), list: vi.fn().mockResolvedValue({ ok: true, value: [] }) }}
      photos={{ reserve: vi.fn() }} /></MemoryRouter>));
  return container;
};

describe("App photo source default por plataforma", () => {
  it("fuera de la app nativa usa el selector de archivos del navegador, no el plugin", async () => {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, writable: true, value: vi.fn(() => "blob:web-photo") });
    const container = await render();
    await click(button(container, "Agregar fotos"));
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    expect(input!.accept).toBe("image/jpeg,image/png,image/webp");
    expect(input!.multiple).toBe(true);
    expect(native.camera.chooseFromGallery).not.toHaveBeenCalled();
    expect(native.camera.pickImages).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Disponible solo en la app.");
    // Cancelar cierra el selector sin dejar un error en el composer.
    await act(async () => { input!.dispatchEvent(new Event("cancel")); });
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(container.textContent).not.toContain("Disponible solo en la app.");
    expect(container.textContent).not.toContain("No pudimos abrir las fotos");
  });
  it("la cámara del navegador abre el selector con capture, sin pedir permisos al plugin", async () => {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, writable: true, value: vi.fn(() => "blob:web-photo") });
    const container = await render();
    await click(button(container, "Sacar foto"));
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input!.getAttribute("capture")).toBe("environment");
    expect(native.camera.checkPermissions).not.toHaveBeenCalled();
    expect(native.camera.takePhoto).not.toHaveBeenCalled();
  });
  it("en la app nativa sigue usando el plugin de Capacitor y no crea ningún input de archivos", async () => {
    native.state.isNative = true;
    native.camera.checkPermissions.mockResolvedValue({ camera: "granted", photos: "granted" });
    native.camera.chooseFromGallery.mockResolvedValue({ results: [] });
    const container = await render();
    await click(button(container, "Agregar fotos"));
    expect(native.camera.chooseFromGallery).toHaveBeenCalledTimes(1);
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });
});
