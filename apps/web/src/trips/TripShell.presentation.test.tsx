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

describe("TripShell: jerarquía de «Actualizar» (T153)", () => {
  it("«Actualizar» acompaña el título del viaje y no compite con la fila de pestañas", async () => {
    const container = await mount(`/trips/${tripId}/itinerary`);
    const button = refreshButton(container)!;
    expect(button.closest(".trip-shell-header")).not.toBeNull();
    expect(button.closest('[role="tabpanel"]')).toBeNull();
    expect(button.classList.contains("trip-shell-refresh")).toBe(true);
    // Comparte la fila del nombre: es hermano del h1 dentro de la cabecera, no un bloque aparte. El contrato «sin relleno» vive en trip-shell-css.test.ts.
    const header = button.closest(".trip-shell-header")!;
    expect(button.parentElement).toBe(header);
    expect(button.previousElementSibling?.tagName).toBe("H1");
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
