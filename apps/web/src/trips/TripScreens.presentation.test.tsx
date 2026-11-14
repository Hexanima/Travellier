// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TripsListScreen } from "./TripScreens.js";
import type { TripManagementApi } from "./trip-management-api.js";
import { resetRememberedFilter } from "./trips-filter-memory.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const trip = {
  id: "507f191e810c19729de860ea",
  name: "Patagonia",
  description: "Lagos",
  primaryDestination: { name: "Bariloche" },
};
const roots: ReturnType<typeof createRoot>[] = [];

afterEach(async () => {
  resetRememberedFilter();
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  document.body.replaceChildren();
});

async function render(list: ReturnType<typeof vi.fn>) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const trips = { list, create: vi.fn() } as Pick<TripManagementApi, "list" | "create">;
  await act(async () => root.render(
    <MemoryRouter initialEntries={["/trips"]}>
      <Routes>
        <Route path="/trips" element={<TripsListScreen trips={trips} onLocalLogout={async () => undefined} />} />
        <Route path="/trips/:tripId/itinerary" element={<h1>Itinerario</h1>} />
        <Route path="/trips/new" element={<h1>Nuevo</h1>} />
      </Routes>
    </MemoryRouter>,
  ));
  return container;
}

describe("Mis viajes: presentación", () => {
  it("usa el ámbito de catálogo y la tarjeta es un solo enlace al viaje con nombre, destino, fechas y descripción (T153)", async () => {
    const container = await render(vi.fn().mockResolvedValue({ ok: true, value: [trip] }));
    expect(container.querySelector("section.trips-panel.trips-panel--catalog")).not.toBeNull();
    const open = container.querySelector(".trips-item a.trips-item-open");
    expect(open?.getAttribute("href")).toBe(`/trips/${trip.id}/itinerary`);
    // El nombre accesible del enlace dice qué viaje se abre, no solo «Itinerario».
    expect(open?.textContent).toContain("Patagonia");
    expect(open?.querySelector("h2")?.textContent).toBe("Patagonia");
    expect(open?.querySelector(".trips-destination")?.textContent).toBe("Bariloche");
    expect(open?.querySelector(".trips-dates")).not.toBeNull();
    expect(open?.querySelector(".trips-description")?.textContent).toBe("Lagos");
    expect(container.querySelector(".trips-item h2")?.textContent).toBe("Patagonia");
  });

  it("la tarjeta no repite la navegación interna del viaje: queda sin acción secundaria (T153)", async () => {
    const container = await render(vi.fn().mockResolvedValue({ ok: true, value: [trip] }));
    // La configuración vive en la cabecera del viaje (prototipo aprobado): la tarjeta es solo el enlace al viaje.
    expect(container.querySelector(".trips-item .trips-item-links")).toBeNull();
    expect(container.querySelectorAll(".trips-item a")).toHaveLength(1);
    for (const rest of ["config", "memories", "journey", "members"]) {
      expect(container.querySelector(`.trips-item a[href="/trips/${trip.id}/${rest}"]`)).toBeNull();
    }
  });

  it("los enlaces de entrada son botones secundarios dentro de su contenedor", async () => {
    const container = await render(vi.fn().mockResolvedValue({ ok: true, value: [trip] }));
    const entries = Array.from(container.querySelectorAll(".trips-entry-actions a"));
    expect(entries.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Unirse con código", "/trips/join"],
      ["Explorar viajes públicos", "/trips/explore"],
    ]);
    for (const link of entries) {
      expect(link.classList.contains("ui-button")).toBe(true);
      expect(link.classList.contains("ui-button--secondary")).toBe(true);
    }
  });

  it("los vacíos de Activos y Finalizados conservan textos y su enlace es un botón", async () => {
    const container = await render(vi.fn().mockResolvedValue({ ok: true, value: [] }));
    expect(container.querySelector(".trips-empty h2")?.textContent).toBe("Todavía no tenés viajes");
    const link = container.querySelector(".trips-empty a");
    expect(link?.textContent).toBe("Crear mi primer viaje");
    expect(link?.getAttribute("href")).toBe("/trips/new");
    expect(link?.classList.contains("ui-button")).toBe(true);
    const finished = Array.from(container.querySelectorAll('[role="tab"]')).find((tab) => tab.textContent === "Finalizados") as HTMLElement;
    await act(async () => finished.click());
    expect(container.querySelector(".trips-empty h2")?.textContent).toBe("Todavía no tenés viajes finalizados");
  });

  it("el vacío de Activos con viajes finalizados conserva su texto y su botón", async () => {
    const past = { ...trip, startAt: "2020-01-01T00:00:00.000Z", endAt: "2020-01-10T00:00:00.000Z" };
    const container = await render(vi.fn().mockResolvedValue({ ok: true, value: [past] }));
    expect(container.querySelector(".trips-empty h2")?.textContent).toBe("No tenés viajes activos");
    const link = container.querySelector(".trips-empty a");
    expect(link?.textContent).toBe("Crear viaje");
    expect(link?.classList.contains("ui-button")).toBe(true);
  });

  it("el pie de Cuenta no mezcla enlaces de texto con un botón: los tres son secundarios (T153)", async () => {
    const container = await render(vi.fn().mockResolvedValue({ ok: true, value: [trip] }));
    const actions = Array.from(container.querySelectorAll(".trips-secondary > *"));
    expect(actions.map((action) => action.textContent)).toEqual(["Mi perfil", "Avisos", "Cerrar sesión"]);
    for (const action of actions) {
      expect(action.classList.contains("ui-button")).toBe(true);
      expect(action.classList.contains("ui-button--secondary")).toBe(true);
    }
  });

  it("«Cerrar sesión» es secundario y la tarjeta navega al viaje", async () => {
    const past = { ...trip, startAt: "2020-01-01T00:00:00.000Z", endAt: "2020-01-10T00:00:00.000Z" };
    const container = await render(vi.fn().mockResolvedValue({ ok: true, value: [past] }));
    const logout = Array.from(container.querySelectorAll(".trips-secondary button")).find((button) => button.textContent === "Cerrar sesión");
    expect(logout?.classList.contains("ui-button--secondary")).toBe(true);
    const finished = Array.from(container.querySelectorAll('[role="tab"]')).find((tab) => tab.textContent === "Finalizados") as HTMLElement;
    await act(async () => finished.click());
    expect(container.querySelector(".trips-item h2")?.textContent).toBe("Patagonia");
    await act(async () => (container.querySelector(".trips-item a.trips-item-open") as HTMLElement).click());
    expect(container.textContent).toContain("Itinerario");
  });
});
