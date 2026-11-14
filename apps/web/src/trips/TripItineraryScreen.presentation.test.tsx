// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { itineraryFixture, itineraryId } from "./itinerary-test-fixture.js";
import type { TripItineraryApi, TripItineraryResponse } from "./trip-itinerary-api.js";
import { TripItineraryScreen } from "./TripItineraryScreen.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
const tripId = itineraryId(1);
const fixture = () => itineraryFixture() as TripItineraryResponse;
/** Destinos cargados pero sin transportes: el itinerario no tiene días (el caso que el usuario reportó). */
const withoutDays = (): TripItineraryResponse => ({ ...fixture(), days: [], activities: [], posts: [], transports: [] });

async function render(value: TripItineraryResponse) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={[`/trips/${tripId}/itinerary`]}>
    <Routes><Route path="/trips/:tripId/itinerary" element={<TripItineraryScreen
      itinerary={{ get: vi.fn().mockResolvedValue({ ok: true, value }) } as unknown as TripItineraryApi} timeZone="UTC" />} /></Routes>
  </MemoryRouter>));
  return container;
}
const journeyLinks = (container: HTMLElement) => Array.from(container.querySelectorAll(`a[href="/trips/${tripId}/journey"]`));

describe("Itinerario: jerarquía y agrupación (T153)", () => {
  it("sin itinerario deja un solo camino a destinos y transportes: el del estado vacío", async () => {
    const container = await render(withoutDays());
    expect(container.textContent).toContain("Todavía no hay itinerario");
    const links = journeyLinks(container);
    expect(links.map((link) => link.textContent)).toEqual(["Configurar transportes"]);
    expect(links[0]!.closest(".trips-empty")).not.toBeNull();
    expect(links[0]!.classList.contains("ui-button")).toBe(true);
    expect(Array.from(container.querySelectorAll("button")).some((item) => item.textContent?.includes("Ver destinos"))).toBe(false);
  });
  it("sin itinerario no repite el vacío con el aviso de exportación", async () => {
    const container = await render(withoutDays());
    expect(container.textContent).not.toContain("No hay nada para exportar");
    expect(container.querySelector(".ics-export-empty")).toBeNull();
  });
  it("con itinerario conserva el acceso a destinos, el balance y la exportación, como botones secundarios agrupados", async () => {
    const container = await render(fixture());
    const actions = container.querySelector(".itinerary-header .itinerary-header-actions")!;
    const links = Array.from(actions.querySelectorAll("a"));
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Destinos y transportes", `/trips/${tripId}/journey`],
      ["Balance", `/trips/${tripId}/balance`],
    ]);
    for (const link of links) {
      expect(link.classList.contains("ui-button")).toBe(true);
      expect(link.classList.contains("ui-button--secondary")).toBe(true);
    }
    expect(container.querySelector(".ics-export")).not.toBeNull();
    expect(container.querySelector(".itinerary-destination-banner")).not.toBeNull();
  });
});
