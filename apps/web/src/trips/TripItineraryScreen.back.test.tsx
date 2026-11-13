// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { itineraryFixture, itineraryId } from "./itinerary-test-fixture.js";
import type { TripItineraryResponse } from "./trip-itinerary-api.js";
import { TripItineraryScreen } from "./TripItineraryScreen.js";
import { BackNavigationProvider } from "../navigation/BackNavigationProvider.js";
import type { AppBackButton } from "../native/app-back-button.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
beforeEach(() => { window.scrollTo = vi.fn() as never; Element.prototype.scrollIntoView = vi.fn() as never; });

const tripId = itineraryId(1);
let where = { pathname: "", search: "" };
function Probe() { const location = useLocation(); where = { pathname: location.pathname, search: location.search }; return null; }
async function render(entry = `/trips/${tripId}/itinerary`) {
  const value = itineraryFixture() as TripItineraryResponse;
  const get = vi.fn().mockImplementation(async (id: string) => ({ ok: true, value: { ...structuredClone(value), tripId: id } }));
  const activities = { get: vi.fn().mockResolvedValue({ ok: true, value: value.activities[0] }), create: vi.fn(), update: vi.fn(), remove: vi.fn() };
  const listeners = new Set<() => void>();
  const exitApp = vi.fn();
  const port: AppBackButton = { onBack: (listener) => { listeners.add(listener); return () => listeners.delete(listener); }, exitApp };
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={["/trips", entry]} initialIndex={1}>
    <BackNavigationProvider backButton={port}><Probe />
      <Routes><Route path="/trips" element={<p>mis viajes</p>} />
        <Route path="/trips/:tripId/itinerary" element={<TripItineraryScreen itinerary={{ get }} activities={activities} timeZone="UTC" now={() => new Date("2026-09-25T12:00:00.000Z")} />} /></Routes>
    </BackNavigationProvider></MemoryRouter>));
  return { container, exitApp, press: async () => { await act(async () => listeners.forEach((listener) => listener())); } };
}
const dialog = () => document.querySelector('[role="dialog"]');
const named = (text: string, root: ParentNode = document) => Array.from(root.querySelectorAll("button")).find((item) => item.textContent?.trim() === text);
const click = async (element: Element | undefined | null) => { expect(element).toBeTruthy(); await act(async () => element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))); };

describe("itinerario y el Atrás nativo", () => {
  it("cierra el selector de destinos sin salir de la pantalla", async () => {
    const view = await render();
    await click(view.container.querySelector('button[aria-haspopup="dialog"]'));
    expect(dialog()).not.toBeNull();
    await view.press();
    expect(dialog()).toBeNull();
    expect(where.pathname).toBe(`/trips/${tripId}/itinerary`);
  });

  it("cierra la creación de actividad (estado local) sin salir de la pantalla", async () => {
    const view = await render();
    await click(named("Crear actividad", view.container));
    expect(dialog()?.textContent).toContain("Nueva actividad");
    await view.press();
    expect(dialog()).toBeNull();
    expect(where.pathname).toBe(`/trips/${tripId}/itinerary`);
    expect(view.exitApp).not.toHaveBeenCalled();
  });

  it("con la confirmación de eliminar abierta cierra primero esa confirmación", async () => {
    const view = await render(`/trips/${tripId}/itinerary?activity=${itineraryId(8)}`);
    expect(dialog()?.textContent).toContain("Detalle de actividad");
    await click(named("Eliminar actividad"));
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2);
    await view.press();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(dialog()?.textContent).toContain("Detalle de actividad");
    await view.press();
    expect(dialog()).toBeNull();
    expect(where.pathname).toBe(`/trips/${tripId}/itinerary`);
  });

  it("sin nada abierto vuelve a Mis viajes", async () => {
    const view = await render();
    await view.press();
    expect(where.pathname).toBe("/trips");
  });
});
