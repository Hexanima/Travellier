// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TripRefreshProvider, useTripRefreshLoader } from "./trip-refresh.js";
import { TripShell } from "./TripShell.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
beforeEach(() => { window.scrollTo = vi.fn() as never; Object.defineProperty(window, "scrollY", { configurable: true, writable: true, value: 0 }); });
const tripId = "0123456789abcdef01234567";
const load = vi.fn(async () => ({ status: "ok" as const }));
function Screen() { useTripRefreshLoader("screen", load); return <p data-screen>pantalla</p>; }

async function mount(path: string) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/trips/:tripId" element={<TripRefreshProvider tripId={tripId}><TripShell /></TripRefreshProvider>}>
      <Route path="itinerary" element={<Screen />} />
      <Route path="memories" element={<Screen />} />
    </Route>
  </Routes></MemoryRouter>));
  return container;
}
const refreshButton = (container: HTMLElement) => Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "Actualizar");
const settingsLink = (container: HTMLElement) => container.querySelector<HTMLAnchorElement>(`.trip-shell-header a[href="/trips/${tripId}/config"]`);

describe("TripShell: jerarquía de «Actualizar» (T153)", () => {
  it("«Actualizar» acompaña el título del viaje y no compite con la fila de pestañas", async () => {
    const container = await mount(`/trips/${tripId}/itinerary`);
    const button = refreshButton(container)!;
    expect(button.closest(".trip-shell-header")).not.toBeNull();
    expect(button.closest('[role="tabpanel"]')).toBeNull();
    expect(button.classList.contains("trip-shell-refresh")).toBe(true);
    // Vive en la fila de acciones de la cabecera, debajo del nombre: el nombre del viaje conserva su línea completa. El contrato «sin relleno» y el reparto viven en trip-shell-css.test.ts.
    const header = button.closest(".trip-shell-header")!;
    const actions = button.closest(".trip-shell-actions")!;
    expect(actions.parentElement).toBe(header);
    expect(header.firstElementChild?.tagName).toBe("H1");
    expect(header.firstElementChild?.nextElementSibling).toBe(actions);
    // La fila de pestañas conserva sus tres controles: nada se suma ni se quita.
    expect(Array.from(container.querySelectorAll('[role="tablist"] [role="tab"]')).map((tab) => tab.textContent)).toEqual(["Itinerario", "Diario", "Grupo"]);
  });
  it("en Diario queda una sola acción fuera de las dos filas de pestañas", async () => {
    const container = await mount(`/trips/${tripId}/memories`);
    expect(Array.from(container.querySelectorAll('[role="tablist"]'))).toHaveLength(2);
    expect(refreshButton(container)!.closest(".trip-shell-header")).not.toBeNull();
    expect(container.querySelectorAll(".trip-shell-refresh")).toHaveLength(1);
  });
});
describe("TripShell: acceso a la configuración (T153)", () => {
  it("la cabecera del viaje lleva a la configuración desde la fila de acciones, sin ocupar la línea del nombre", async () => {
    const container = await mount(`/trips/${tripId}/itinerary`);
    const link = settingsLink(container)!;
    const header = link.closest(".trip-shell-header")!;
    const actions = link.closest(".trip-shell-actions")!;
    expect(link.parentElement).toBe(actions);
    expect(actions.parentElement).toBe(header);
    // El nombre no comparte fila con ninguna acción: las dos acciones son las únicas hijas de la fila de acciones.
    expect(Array.from(actions.children).map((item) => item.textContent)).toEqual(["Actualizar", "Configuración"]);
    expect(link.classList.contains("trip-shell-settings")).toBe(true);
    // El nombre accesible dice que la configuración es la del viaje; el texto visible queda contenido en él.
    expect(link.textContent).toBe("Configuración");
    expect(link.getAttribute("aria-label")).toBe("Configuración del viaje");
    expect(link.closest('[role="tabpanel"]')).toBeNull();
    // La fila de pestañas conserva sus tres controles.
    expect(Array.from(container.querySelectorAll('[role="tablist"] [role="tab"]')).map((tab) => tab.textContent)).toEqual(["Itinerario", "Diario", "Grupo"]);
  });
  it("el acceso no depende del rol ni de la sección abierta: una sola entrada en cada raíz", async () => {
    for (const path of ["itinerary", "memories"]) {
      const container = await mount(`/trips/${tripId}/${path}`);
      expect(container.querySelectorAll(".trip-shell-settings")).toHaveLength(1);
      expect(settingsLink(container)).not.toBeNull();
    }
  });
});
