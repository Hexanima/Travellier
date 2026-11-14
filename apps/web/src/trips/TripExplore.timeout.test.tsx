// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PublicTripConfirmationScreen, TripExploreScreen } from "./TripExploreScreen.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tripId = "507f191e810c19729de860ea";
const publicTrip = { kind: "public", id: tripId, name: "Patagonia", description: "Lagos y senderos", primaryDestination: { name: "Bariloche" }, visibility: "public" };
const timeout = { ok: false as const, error: { kind: "network", code: "TimeoutError" } };
const offline = { ok: false as const, error: { kind: "network", code: "NetworkError" } };
const timeoutText = "La conexión tardó demasiado. Intentá nuevamente.";
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

const alertText = (container: Element) => container.querySelector('[role="alert"]')?.textContent ?? "";
const press = async (container: Element, label: string) =>
  act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent === label)?.click());

describe("Explorar: el timeout se distingue de la conexión caída (T150)", () => {
  it("la lista de viajes públicos muestra el texto del timeout y conserva el reintento", async () => {
    const listPublic = vi.fn().mockResolvedValueOnce(timeout).mockResolvedValueOnce({ ok: true, value: [publicTrip] });
    const container = await render("/trips/explore", { listPublic });
    expect(alertText(container)).toContain(timeoutText);
    expect(alertText(container)).not.toContain("No pudimos cargar los viajes públicos");
    await press(container, "Reintentar");
    expect(listPublic).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Patagonia");
  });

  it("la lista conserva el texto de siempre con la conexión caída", async () => {
    const container = await render("/trips/explore", { listPublic: vi.fn().mockResolvedValue(offline) });
    expect(alertText(container)).toContain("No pudimos cargar los viajes públicos. Intentá nuevamente.");
    expect(alertText(container)).not.toContain("tardó demasiado");
  });

  it("el detalle del viaje público distingue el timeout, y el viaje no disponible conserva su texto", async () => {
    const container = await render(`/trips/explore/${tripId}`, { get: vi.fn().mockResolvedValue(timeout), joinPublic: vi.fn() });
    expect(alertText(container)).toContain(timeoutText);
    expect(alertText(container)).not.toContain("No pudimos cargar el viaje");

    const gone = await render(`/trips/explore/${tripId}`, { get: vi.fn().mockResolvedValue({ ok: false, error: { kind: "not-found" } }), joinPublic: vi.fn() });
    expect(alertText(gone)).toBe("Este viaje no está disponible para unirse.");
  });

  it("el detalle conserva el texto de siempre con la conexión caída", async () => {
    const container = await render(`/trips/explore/${tripId}`, { get: vi.fn().mockResolvedValue(offline), joinPublic: vi.fn() });
    expect(alertText(container)).toContain("No pudimos cargar el viaje. Intentá nuevamente.");
    expect(alertText(container)).not.toContain("tardó demasiado");
  });

  it("la unión distingue el timeout y la deja reintentable", async () => {
    const joinPublic = vi.fn().mockResolvedValue(timeout);
    const container = await render(`/trips/explore/${tripId}`, { get: vi.fn().mockResolvedValue({ ok: true, value: publicTrip }), joinPublic });
    await press(container, "Confirmar unión");
    expect(alertText(container)).toContain(timeoutText);
    expect(alertText(container)).not.toContain("No pudimos confirmar la unión");
    expect([...container.querySelectorAll("button")].some((button) => button.textContent === "Confirmar unión")).toBe(true);
  });

  it("la unión conserva el texto de siempre con la conexión caída", async () => {
    const container = await render(`/trips/explore/${tripId}`, { get: vi.fn().mockResolvedValue({ ok: true, value: publicTrip }), joinPublic: vi.fn().mockResolvedValue(offline) });
    await press(container, "Confirmar unión");
    expect(alertText(container)).toContain("No pudimos confirmar la unión. Intentá nuevamente.");
    expect(alertText(container)).not.toContain("tardó demasiado");
  });
});
