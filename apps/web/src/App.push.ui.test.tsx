// @vitest-environment jsdom

import { ok, type NativePermissionState, type PushRegistrationPort } from "app-domain";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App.js";
import type { NativeAppUrlApi } from "./navigation/app-url-listener.js";
import type { PushDeviceApi } from "./push/push-device-api.js";
import { createPushDeviceService } from "./push/push-device-service.js";
import { itineraryFixture, itineraryId } from "./trips/itinerary-test-fixture.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

const pushService = (permission: NativePermissionState) => {
  const port = {
    checkPermission: vi.fn<PushRegistrationPort["checkPermission"]>(async () => ok(permission)),
    requestPermission: vi.fn<PushRegistrationPort["requestPermission"]>(async () => ok(permission)),
    register: vi.fn<PushRegistrationPort["register"]>(async () => ok(undefined)),
    unregister: vi.fn<PushRegistrationPort["unregister"]>(async () => ok(undefined)),
    listen: vi.fn<PushRegistrationPort["listen"]>(async () => ok(async () => ok(undefined))),
  } satisfies PushRegistrationPort;
  return { port, service: createPushDeviceService({ port, api: { register: vi.fn(), revoke: vi.fn() } as unknown as PushDeviceApi }) };
};
const click = async (container: ParentNode, label: string) => {
  const element = Array.from(container.querySelectorAll("button")).find((item) => item.textContent === label);
  expect(element, label).toBeDefined();
  await act(async () => { element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
};

describe("push notices after joining a Trip", () => {
  const renderInvite = async (permission: NativePermissionState, joined: boolean) => {
    const { port, service } = pushService(permission);
    const nativeApp: NativeAppUrlApi = {
      addListener: vi.fn(async () => ({ remove: vi.fn().mockResolvedValue(undefined) })),
      getLaunchUrl: vi.fn().mockResolvedValue({ url: "com.travellier.app://invite/VIAJE-X7K2" }),
    };
    const joinByCode = vi.fn().mockResolvedValue({ ok: true, value: { tripId: "507f191e810c19729de860ea", joined } });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(
      <MemoryRouter initialEntries={["/"]}>
        <App auth={{ refresh: vi.fn().mockResolvedValue({ ok: true, value: { accessToken: "a", refreshToken: "r" } }) }} trips={{ joinByCode }}
          sessionStorage={{ read: async () => ({ accessToken: "old", refreshToken: "r" }), save: async () => undefined, clear: async () => undefined }}
          nativeApp={nativeApp} push={service} />
      </MemoryRouter>,
    ));
    return { container, port };
  };

  it("offers a dismissible card only after joining, without prompting; Ahora no hides it for the session", async () => {
    const { container, port } = await renderInvite("prompt", true);
    expect(container.textContent).not.toContain("Activar avisos");
    await click(container, "Confirmar unión");
    expect(container.textContent).toContain("Te uniste al viaje");
    expect(container.textContent).toContain("Activar avisos");
    expect(port.requestPermission).not.toHaveBeenCalled();
    const calls = port.checkPermission.mock.calls.length;
    await click(container, "Ahora no");
    expect(container.textContent).not.toContain("Activar avisos");
    expect(container.textContent).toContain("Te uniste al viaje");
    expect(port.checkPermission).toHaveBeenCalledTimes(calls);
    expect(port.requestPermission).not.toHaveBeenCalled();
  });
  it("does not offer the card when the person was already a member", async () => {
    const { container } = await renderInvite("prompt", false);
    await click(container, "Confirmar unión");
    expect(container.textContent).toContain("Ya sos parte de este viaje.");
    expect(container.textContent).not.toContain("Activar avisos");
  });
});

describe("denied notifications do not affect the Trip screens", () => {
  it("keeps Modificado and Voy / No voy operable with the permission denied", async () => {
    const { port, service } = pushService("denied");
    const mark = { reason: "schedule_conflict", changedFields: ["scheduledAt", "durationMinutes"], changedAt: "2026-09-26T10:00:00.000Z" };
    const base = { id: itineraryId(50), tripId: itineraryId(1), activityId: itineraryId(8), userId: itineraryId(20), updatedAt: "2026-09-25T12:00:00.000Z" };
    const fetch = vi.fn().mockImplementation(async (url: string, request: RequestInit) => {
      if (url.endsWith("/auth/refresh")) return new Response(JSON.stringify({ accessToken: "renewed", refreshToken: "refresh" }));
      if (url.endsWith("/itinerary")) return new Response(JSON.stringify({ itinerary: itineraryFixture() }));
      if (request.method === "PUT") return new Response(JSON.stringify({ participation: { ...base, status: "going" } }));
      return new Response(JSON.stringify({ participation: url.includes(itineraryId(8)) ? { ...base, status: "pending", decisionRequired: mark } : null }));
    });
    vi.stubGlobal("fetch", fetch);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(
      <MemoryRouter initialEntries={[`/trips/${itineraryId(1)}/itinerary`]}>
        <App apiBaseUrl="https://api.test" push={service} sessionStorage={{ read: async () => ({ accessToken: "old", refreshToken: "refresh" }), save: async () => undefined, clear: async () => undefined }} />
      </MemoryRouter>,
    ));
    const card = () => container.querySelector<HTMLElement>(`[data-itinerary-item="${itineraryId(8)}"]`)!;
    expect(card().textContent).toContain("Modificado");
    await click(card(), "Voy");
    expect(card().textContent).not.toContain("Modificado");
    expect(card().querySelector('[aria-pressed="true"]')?.textContent).toBe("Voy");
    expect(port.requestPermission).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Avisos");
  });
});
