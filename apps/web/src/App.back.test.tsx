// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.js";
import type { AppBackButton } from "./native/app-back-button.js";
import { itineraryFixture, itineraryId } from "./trips/itinerary-test-fixture.js";
import { noticesOrigin } from "./trips/post-origin.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); vi.unstubAllGlobals(); });

const tripId = itineraryId(1);
const me = itineraryId(20);
const backButton = () => {
  const listeners = new Set<() => void>();
  const exitApp = vi.fn();
  const port: AppBackButton = { onBack: (listener) => { listeners.add(listener); return () => listeners.delete(listener); }, exitApp };
  return { port, exitApp, press: async () => { await act(async () => listeners.forEach((listener) => listener())); } };
};
const storage = () => ({ read: vi.fn().mockResolvedValue({ accessToken: "old", refreshToken: "refresh" }), save: vi.fn().mockResolvedValue(undefined), clear: vi.fn().mockResolvedValue(undefined) });
const auth = { refresh: vi.fn().mockResolvedValue({ ok: true, value: { accessToken: "access", refreshToken: "refresh" } }) };
const props = (over: Partial<ComponentProps<typeof App>> = {}): ComponentProps<typeof App> => ({
  auth, sessionStorage: storage(),
  trips: { list: vi.fn().mockResolvedValue({ ok: true, value: [] }), get: vi.fn().mockResolvedValue({ ok: true, value: { id: tripId, name: "Córdoba", description: null, expenseMode: "register" } }) },
  members: { list: vi.fn().mockResolvedValue({ ok: true, value: { currentUserId: me, members: [] } }) },
  itinerary: { get: vi.fn().mockResolvedValue({ ok: true, value: itineraryFixture() }) },
  participations: { get: vi.fn().mockResolvedValue({ ok: true, value: null }) },
  posts: { list: vi.fn().mockResolvedValue({ ok: true, value: [] }) },
  ...over,
});
type Entry = string | { pathname: string; search?: string; state?: unknown };
async function render(entry: Entry | Entry[], app: ComponentProps<typeof App>) {
  const entries = Array.isArray(entry) ? entry : [entry];
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}><App {...app} /></MemoryRouter>));
  return container;
}

describe("App back button integration", () => {
  it("desde una raíz del Trip vuelve a Mis viajes", async () => {
    const button = backButton();
    const container = await render(`/trips/${tripId}/itinerary`, props({ backButton: button.port }));
    expect(container.textContent).toContain("Itinerario");
    await button.press();
    expect(container.textContent).toContain("Mis viajes");
    expect(button.exitApp).not.toHaveBeenCalled();
  });

  it("desde una raíz del Trip abierta por un aviso vuelve a avisos, igual que su enlace Volver", async () => {
    const button = backButton();
    const notifications = { list: vi.fn().mockResolvedValue({ ok: true, value: { notifications: [], unreadCount: 0 } }) };
    const container = await render({ pathname: `/trips/${tripId}/itinerary`, state: { origin: noticesOrigin } }, props({ backButton: button.port, notifications }));
    expect(container.querySelector("a.trips-back")?.textContent).toBe("Volver a avisos");
    await button.press();
    expect(container.textContent).toContain("Avisos");
  });

  it("en Mis viajes sin historial cierra la app en vez de dejar el Atrás muerto", async () => {
    const button = backButton();
    await render("/trips", props({ backButton: button.port }));
    await button.press();
    expect(button.exitApp).toHaveBeenCalledTimes(1);
  });

  it("en una pantalla interna sin historial vuelve a Mis viajes", async () => {
    const button = backButton();
    const container = await render(`/trips/${tripId}/journey`, props({ backButton: button.port, journey: { listDestinations: vi.fn().mockResolvedValue({ ok: true, value: [] }) } }));
    await button.press();
    expect(container.textContent).toContain("Mis viajes");
    expect(button.exitApp).not.toHaveBeenCalled();
  });

  it("en una pantalla interna con historial vuelve a la anterior", async () => {
    const button = backButton();
    const notifications = { list: vi.fn().mockResolvedValue({ ok: true, value: { notifications: [], unreadCount: 0 } }) };
    const container = await render(["/trips", "/notifications"], props({ backButton: button.port, notifications }));
    expect(container.textContent).toContain("Avisos");
    await button.press();
    expect(container.textContent).toContain("Mis viajes");
  });

  it("sin puerto nativo no se toca nada: la app sigue funcionando con el Atrás del navegador", async () => {
    const container = await render(`/trips/${tripId}/itinerary`, props());
    expect(container.textContent).toContain("Itinerario");
  });

  it("con el detalle de una actividad abierto, el Atrás lo cierra y deja el itinerario igual", async () => {
    const button = backButton();
    const activityId = itineraryId(8);
    const activities = { get: vi.fn().mockResolvedValue({ ok: true, value: itineraryFixture().activities.find((activity) => activity.id === activityId) }) };
    const container = await render({ pathname: `/trips/${tripId}/itinerary`, search: `?activity=${activityId}&day=2026-09-25` }, props({ backButton: button.port, activities }));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await button.press();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).toContain("Itinerario");
  });

  it("con el detalle abierto desde el itinerario (entrada propia) el Atrás vuelve al itinerario tal cual estaba", async () => {
    const button = backButton();
    const activityId = itineraryId(8);
    const activities = { get: vi.fn().mockResolvedValue({ ok: true, value: itineraryFixture().activities.find((activity) => activity.id === activityId) }) };
    const container = await render(`/trips/${tripId}/itinerary`, props({ backButton: button.port, activities }));
    const open = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes("Paseo por el centro"));
    await act(async () => open?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await button.press();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).toContain("Itinerario");
    expect(button.exitApp).not.toHaveBeenCalled();
  });

  it("con el selector de destinos abierto el Atrás lo cierra sin cambiar el día", async () => {
    const button = backButton();
    const container = await render({ pathname: `/trips/${tripId}/itinerary`, search: "?day=2026-09-25" }, props({ backButton: button.port }));
    const banner = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes("Ver destinos"));
    await act(async () => banner?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })));
    expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe("Destinos del viaje");
    await button.press();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector("[aria-current=date]")?.getAttribute("data-day")).toBe("2026-09-25");
  });

  it("con el compositor de recuerdos sucio el Atrás pide confirmación y Descartar sale", async () => {
    const button = backButton();
    const container = await render([`/trips/${tripId}/memories`, `/trips/${tripId}/memories/new`], props({ backButton: button.port }));
    const description = container.querySelector("[name=description]") as HTMLTextAreaElement;
    expect(description).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(description, "Un recuerdo");
      description.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await button.press();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Descartar cambios");
    expect(container.querySelector("[name=description]")).not.toBeNull();
    const discard = Array.from(document.querySelectorAll("button")).find((item) => item.textContent === "Descartar");
    await act(async () => discard?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })));
    expect(container.querySelector("[name=description]")).toBeNull();
  });

  it("en las fotos, el Atrás cierra el visor y deja la galería donde estaba", async () => {
    const button = backButton();
    const photo = { id: itineraryId(40), postId: itineraryId(540), order: 0, uploadedAt: "2026-09-26T10:00:00.000Z", uploaderId: me,
      url: "https://s3.test/40?sig=x", expiresAtMs: Date.parse("2100-01-01T00:00:00.000Z"),
      post: { createdAt: "2026-09-26T09:00:00.000Z", authorId: me, rootActivityId: null, rootTransportId: null } };
    const gallery = { list: vi.fn().mockResolvedValue({ ok: true, value: { photos: [photo], nextCursor: null } }) };
    const container = await render(`/trips/${tripId}/memories/photos`, props({ backButton: button.port, gallery }));
    await act(async () => container.querySelector(`[data-photo="${photo.id}"] button`)?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await button.press();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector(`[data-photo="${photo.id}"]`)).not.toBeNull();
  });
});
