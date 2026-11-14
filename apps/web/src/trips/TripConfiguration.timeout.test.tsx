// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TripConfigurationScreen } from "./TripConfigurationScreen.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tripId = "507f191e810c19729de860ea";
const me = "507f1f77bcf86cd799439011";
const timeoutText = "La conexión tardó demasiado. Intentá nuevamente.";
const listing = { ok: true, value: { currentUserId: me, ownerId: me, members: [
  { id: "m1", userId: me, name: "Yo", role: "admin", isOwner: true, joinedAt: "2026-09-24T12:00:00.000Z" },
] } };
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });

async function mount(get: ReturnType<typeof vi.fn>) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={[`/trips/${tripId}/config`]}><Routes>
    <Route path="/trips/:tripId/config" element={<TripConfigurationScreen trips={{ get, updateConfiguration: vi.fn() } as never}
      members={{ list: vi.fn().mockResolvedValue(listing) } as never} />} />
  </Routes></MemoryRouter>));
  return container;
}
const alertText = (container: Element) => container.querySelector('[role="alert"]')?.textContent ?? "";

describe("Configuración del viaje: el timeout se distingue de la conexión caída (T150)", () => {
  it("la carga muestra el texto del timeout y conserva el reintento", async () => {
    const trip = { kind: "member", id: tripId, name: "Patagonia", description: null, primaryDestination: { name: "Bariloche" }, visibility: "private", expenseMode: "register" };
    const get = vi.fn().mockResolvedValueOnce({ ok: false, error: { kind: "network", code: "TimeoutError" } }).mockResolvedValueOnce({ ok: true, value: trip });
    const container = await mount(get);
    expect(alertText(container)).toContain(timeoutText);
    expect(alertText(container)).not.toContain("No pudimos cargar la configuración");
    await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent === "Reintentar")?.click());
    expect(container.querySelector('[name="expenseMode"]')).not.toBeNull();
  });

  it("la carga conserva el texto de siempre con la conexión caída, y el viaje inexistente el suyo", async () => {
    const container = await mount(vi.fn().mockResolvedValue({ ok: false, error: { kind: "network", code: "NetworkError" } }));
    expect(alertText(container)).toContain("No pudimos cargar la configuración.");
    expect(alertText(container)).not.toContain("tardó demasiado");

    const missing = await mount(vi.fn().mockResolvedValue({ ok: false, error: { kind: "not-found" } }));
    expect(alertText(missing)).toBe("No encontramos este viaje.");
  });
});
