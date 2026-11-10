// @vitest-environment jsdom

import { NativeCapabilityError, err, ok, type NativePermissionState, type PushRegistrationPort } from "app-domain";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProfileScreen } from "../profile/ProfileScreen.js";
import { PushNotices } from "./PushNotices.js";
import type { PushDeviceApi } from "./push-device-api.js";
import { createPushDeviceService, type PushDeviceService } from "./push-device-service.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  document.body.replaceChildren();
});

const setup = (permission: NativePermissionState | "unsupported" = "prompt", requested: NativePermissionState = "granted") => {
  const port = {
    checkPermission: vi.fn<PushRegistrationPort["checkPermission"]>(async () => permission === "unsupported" ? err(new NativeCapabilityError("unsupported")) : ok(permission)),
    requestPermission: vi.fn<PushRegistrationPort["requestPermission"]>(async () => ok(requested)),
    register: vi.fn<PushRegistrationPort["register"]>(async () => ok(undefined)),
    unregister: vi.fn<PushRegistrationPort["unregister"]>(async () => ok(undefined)),
    listen: vi.fn<PushRegistrationPort["listen"]>(async () => ok(async () => ok(undefined))),
  } satisfies PushRegistrationPort;
  const api = { register: vi.fn(), revoke: vi.fn() } as unknown as PushDeviceApi;
  const service = createPushDeviceService({ port, api });
  const enable = vi.spyOn(service, "enable");
  return { port, service, enable };
};
const mount = async (element: React.ReactElement) => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(<MemoryRouter>{element}</MemoryRouter>));
  return container;
};
const button = (container: HTMLElement, label: string) => Array.from(container.querySelectorAll("button")).find((item) => item.textContent === label);
const click = async (element: Element | undefined) => { expect(element).toBeDefined(); await act(async () => { element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); }); };
const profile = { name: "Nico", email: "nico@example.test", avatar: null };

describe("PushNotices (connected section)", () => {
  it("checks the permission silently on mount and shows the optional message without prompting", async () => {
    const { port, service } = setup("prompt");
    const container = await mount(<PushNotices push={service} />);
    expect(container.textContent).toContain("Es opcional");
    expect(port.checkPermission).toHaveBeenCalledTimes(1);
    expect(port.requestPermission).not.toHaveBeenCalled();
    expect(port.register).not.toHaveBeenCalled();
  });
  it("Activar avisos calls enable once and requests the permission once", async () => {
    const { port, service, enable } = setup("prompt");
    const container = await mount(<PushNotices push={service} />);
    await click(button(container, "Activar avisos"));
    expect(enable).toHaveBeenCalledTimes(1);
    expect(port.requestPermission).toHaveBeenCalledTimes(1);
  });
  it("shows the denied message after refusing in the dialog and never asks again", async () => {
    const { port, service } = setup("prompt", "denied");
    const container = await mount(<PushNotices push={service} />);
    await click(button(container, "Activar avisos"));
    expect(container.textContent).toContain("Los avisos están desactivados para Travellier.");
    expect(button(container, "Activar avisos")).toBeUndefined();
    expect(port.requestPermission).toHaveBeenCalledTimes(1);
  });
  it("renders nothing when unsupported", async () => {
    const { service } = setup("unsupported");
    const container = await mount(<PushNotices push={service} />);
    expect(container.innerHTML).toBe("");
  });
  it("Ahora no hides the card for this session without touching the port again", async () => {
    const { port, service, enable } = setup("prompt");
    const container = await mount(<PushNotices push={service} dismissible />);
    const calls = port.checkPermission.mock.calls.length;
    await click(button(container, "Ahora no"));
    expect(container.innerHTML).toBe("");
    expect(enable).not.toHaveBeenCalled();
    expect(port.checkPermission).toHaveBeenCalledTimes(calls);
    expect(port.requestPermission).not.toHaveBeenCalled();
    expect(port.register).not.toHaveBeenCalled();
  });
  it("the dismissible card is not shown when notices are already registered", async () => {
    const registeredStatus = { state: "registered", tokenHint: "****1111" } as const;
    const registeredService: PushDeviceService = {
      getStatus: () => registeredStatus,
      subscribe: () => () => undefined,
      refreshStatus: async () => undefined,
      resume: async () => undefined,
      enable: async () => undefined,
      revokeBeforeLogout: async () => ({ revoked: true }),
      reset: () => undefined,
    };
    const registered = await mount(<PushNotices push={registeredService} dismissible />);
    expect(registered.innerHTML).toBe("");
    const inProfile = await mount(<PushNotices push={registeredService} />);
    expect(inProfile.textContent).toContain("Avisos activados en este dispositivo.");
  });
  it("the dismissible card shows the informational denied message with Ahora no, which hides it for the session", async () => {
    const container = await mount(<main><h1>Unirse a un viaje</h1><a href="/x">Ver miembros</a><PushNotices push={setup("denied").service} dismissible /></main>);
    expect(container.textContent).toContain("Los avisos están desactivados para Travellier.");
    expect(button(container, "Ahora no")).toBeDefined();
    expect(button(container, "Activar avisos")).toBeUndefined();
    await click(button(container, "Ahora no"));
    expect(container.querySelector(".push-notices")).toBeNull();
    // The focus goes to the screen heading, not to body.
    expect(document.activeElement).toBe(container.querySelector("h1"));
  });
  it("keeps the confirmation visible when the user enables the notices from the card itself", async () => {
    const { service } = setup("prompt");
    const container = await mount(<PushNotices push={service} dismissible />);
    await click(button(container, "Activar avisos"));
    expect(container.querySelector(".push-notices")).not.toBeNull();
  });
});

describe("ProfileScreen push section", () => {
  const auth = () => ({ getProfile: vi.fn().mockResolvedValue({ ok: true, value: profile }), updateProfile: vi.fn().mockResolvedValue({ ok: true, value: { ...profile, name: "Otro" } }) });
  it("without push renders no notices section and saves as before", async () => {
    const api = auth();
    api.getProfile.mockResolvedValueOnce({ ok: true, value: profile }).mockResolvedValueOnce({ ok: true, value: { ...profile, name: "Otro" } });
    const container = await mount(<ProfileScreen auth={api} />);
    expect(container.textContent).not.toContain("Avisos");
    const input = container.querySelector<HTMLInputElement>('[name="name"]')!;
    await act(async () => { input.value = "Otro"; });
    await act(async () => { container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(api.updateProfile).toHaveBeenCalledWith({ name: "Otro" });
    expect(container.textContent).toContain("Perfil guardado correctamente.");
  });
  it("with an unsupported push service renders no section", async () => {
    const container = await mount(<ProfileScreen auth={auth()} push={setup("unsupported").service} />);
    expect(container.textContent).not.toContain("Avisos");
  });
  it("with a supported push service renders the Avisos section and keeps saving the profile", async () => {
    const api = auth();
    api.getProfile.mockResolvedValueOnce({ ok: true, value: profile }).mockResolvedValueOnce({ ok: true, value: { ...profile, name: "Otro" } });
    const { service, port } = setup("prompt");
    const container = await mount(<ProfileScreen auth={api} push={service} />);
    expect(container.querySelector("h2")?.textContent).toBe("Avisos");
    expect(container.textContent).toContain("Activar avisos");
    expect(button(container, "Ahora no")).toBeUndefined();
    await act(async () => { container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(api.updateProfile).toHaveBeenCalledTimes(1);
    expect(port.requestPermission).not.toHaveBeenCalled();
  });
});
