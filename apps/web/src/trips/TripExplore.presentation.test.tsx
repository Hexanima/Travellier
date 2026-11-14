// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PublicTripConfirmationScreen, TripExploreScreen } from "./TripExploreScreen.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tripId = "507f191e810c19729de860ea";
const publicTrip = { kind: "public", id: tripId, name: "Patagonia", description: "Lagos y senderos", primaryDestination: { name: "Bariloche" }, visibility: "public" };
const roots: ReturnType<typeof createRoot>[] = [];

afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  document.body.replaceChildren();
});

async function render(path: string, trips: Record<string, unknown>) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/trips/explore" element={<TripExploreScreen trips={trips as never} />} />
        <Route path="/trips/explore/:tripId" element={<PublicTripConfirmationScreen trips={trips as never} />} />
        <Route path="/trips" element={<h1>Mis viajes</h1>} />
      </Routes>
    </MemoryRouter>,
  ));
  return container;
}

describe("Explorar: presentación", () => {
  it("usa el ámbito de catálogo y agrupa «Ver viaje» en los enlaces de la fila", async () => {
    const container = await render("/trips/explore", { listPublic: vi.fn().mockResolvedValue({ ok: true, value: [publicTrip] }) });
    expect(container.querySelector("section.trips-panel.trips-panel--catalog")).not.toBeNull();
    const link = container.querySelector(".trips-item .trips-item-links a.trips-settings-link");
    expect(link?.textContent).toBe("Ver viaje");
    expect(link?.getAttribute("href")).toBe(`/trips/explore/${tripId}`);
    // La acción de la tarjeta es un botón secundario, no un enlace subrayado (T153).
    expect(link?.classList.contains("ui-button")).toBe(true);
    expect(link?.classList.contains("ui-button--secondary")).toBe(true);
  });

  it("el enlace del vacío es un botón y conserva su texto y destino", async () => {
    const container = await render("/trips/explore", { listPublic: vi.fn().mockResolvedValue({ ok: true, value: [] }) });
    expect(container.querySelector(".trips-empty h2")?.textContent).toBe("No hay viajes públicos para explorar");
    const link = container.querySelector(".trips-empty a");
    expect(link?.textContent).toBe("Unirse con código");
    expect(link?.getAttribute("href")).toBe("/trips/join");
    expect(link?.classList.contains("ui-button")).toBe(true);
  });

  it("la confirmación conserva «Confirmar unión» como botón secundario sobre la tarjeta de marca", async () => {
    const container = await render(`/trips/explore/${tripId}`, { get: vi.fn().mockResolvedValue({ ok: true, value: publicTrip }), joinPublic: vi.fn() });
    const confirm = Array.from(container.querySelectorAll(".trip-public-preview button")).find((button) => button.textContent === "Confirmar unión");
    expect(confirm).toBeDefined();
    expect(confirm?.classList.contains("ui-button--secondary")).toBe(true);
  });

  it("quien ya es integrante ve «Ya sos parte de este viaje» sin botón de unión", async () => {
    const container = await render(`/trips/explore/${tripId}`, { get: vi.fn().mockResolvedValue({ ok: true, value: { ...publicTrip, kind: "member" } }), joinPublic: vi.fn() });
    expect(container.querySelector(".trip-public-preview")?.textContent).toContain("Ya sos parte de este viaje.");
    expect(container.querySelector("button")).toBeNull();
  });
});
