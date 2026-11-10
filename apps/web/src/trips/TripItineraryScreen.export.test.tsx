// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { itineraryFixture, itineraryId } from "./itinerary-test-fixture.js";
import type { TripItineraryApi, TripItineraryResponse } from "./trip-itinerary-api.js";
import type { TripManagementApi } from "./trip-management-api.js";
import { TripItineraryScreen } from "./TripItineraryScreen.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
const fixture = () => itineraryFixture() as TripItineraryResponse;
type Props = { tripName?: string; trips?: Pick<TripManagementApi, "get"> };
async function render(get: TripItineraryApi["get"], props: Props = {}) {
  const download = vi.fn(() => ({ ok: true as const }));
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={[`/trips/${itineraryId(1)}/itinerary`]}>
    <Routes><Route path="/trips/:tripId/itinerary" element={<TripItineraryScreen itinerary={{ get }} timeZone="America/Argentina/Buenos_Aires" {...props}
      icsExport={{ download, now: () => new Date("2026-11-10T12:34:56.000Z") }} />} /></Routes>
  </MemoryRouter>));
  return { container, download };
}
const exportButton = (container: HTMLElement) => Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "Exportar a calendario (.ics)");
const clickExport = async (container: HTMLElement) => act(async () => { exportButton(container)!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });

describe("itinerary screen .ics export", () => {
  it("offers the export (with the static-copy notice) once the itinerary is loaded", async () => {
    const { container } = await render(vi.fn().mockResolvedValue({ ok: true, value: fixture() }), { tripName: "Viaje a Córdoba" });
    expect(exportButton(container)).toBeDefined();
    expect(container.textContent).toContain("El archivo es una copia estática");
  });
  it("does not offer it while loading or when the itinerary fails to load", async () => {
    const pending = await render(vi.fn(() => new Promise<never>(() => undefined)));
    expect(exportButton(pending.container)).toBeUndefined();
    const failed = await render(vi.fn().mockResolvedValue({ ok: false, error: { kind: "network" } }));
    expect(exportButton(failed.container)).toBeUndefined();
    expect(failed.container.textContent).not.toContain("copia estática");
  });
  it("exports the loaded itinerary under the given Trip name without asking for it again", async () => {
    const get = vi.fn().mockResolvedValue({ ok: false, error: { kind: "network" } });
    const { container, download } = await render(vi.fn().mockResolvedValue({ ok: true, value: fixture() }), { tripName: "Viaje a Córdoba", trips: { get } });
    await clickExport(container);
    expect(download).toHaveBeenCalledTimes(1);
    const [text, name] = download.mock.calls[0] as unknown as [string, string];
    expect(name).toBe("travellier-viaje-a-cordoba.ics");
    expect(text).toContain("X-WR-CALNAME:Viaje a Córdoba");
    expect(text).toContain("SUMMARY:Paseo por el centro");
    expect(get).not.toHaveBeenCalled();
    expect(container.querySelector('[role="status"]')?.textContent).toMatch(/^Se generó la exportación el .*Si no aparece el archivo, probá de nuevo\.$/);
  });
  it("asks the Trip name only when exporting, and falls back to a fixed name if that fails", async () => {
    const get = vi.fn().mockResolvedValue({ ok: true, value: { id: itineraryId(1), name: "Nombre del viaje" } });
    const ok = await render(vi.fn().mockResolvedValue({ ok: true, value: fixture() }), { trips: { get } });
    expect(get).not.toHaveBeenCalled();
    await clickExport(ok.container);
    expect(get).toHaveBeenCalledExactlyOnceWith(itineraryId(1));
    expect((ok.download.mock.calls[0] as unknown as [string])[0]).toContain("X-WR-CALNAME:Nombre del viaje");

    const failing = vi.fn().mockResolvedValue({ ok: false, error: { kind: "network" } });
    const fallback = await render(vi.fn().mockResolvedValue({ ok: true, value: fixture() }), { trips: { get: failing } });
    await clickExport(fallback.container);
    expect((fallback.download.mock.calls[0] as unknown as [string])[0]).toContain("X-WR-CALNAME:Viaje Travellier");
    expect(fallback.container.querySelector('[role="alert"]')).toBeNull();
  });
});
