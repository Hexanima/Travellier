// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { Link, MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TripsListScreen } from "./TripScreens.js";
import type { TripListItem, TripManagementApi } from "./trip-management-api.js";
import { getRememberedFilter, resetRememberedFilter } from "./trips-filter-memory.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.parse("2026-10-10T12:00:00.000Z");
const mk = (id: string, name: string, endAt: string | null): TripListItem =>
  ({ id, name, description: null, primaryDestination: { name: "Destino" }, startAt: null, endAt });
const trips = [mk("a1", "Futuro", "2026-12-09T10:00:00.000Z"), mk("b2", "Terminado", "2026-09-09T10:00:00.000Z")];
const roots: ReturnType<typeof createRoot>[] = [];

afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  document.body.replaceChildren();
  resetRememberedFilter();
});

let currentLocation = "";
function Probe() { const location = useLocation(); currentLocation = location.pathname + location.search; return null; }
let goBack: () => void = () => undefined;
function BackControl() { const navigate = useNavigate(); goBack = () => navigate(-1); return null; }

async function renderAt(entries: string[], index?: number) {
  const list = vi.fn<TripManagementApi["list"]>().mockResolvedValue({ ok: true, value: trips });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(
    <MemoryRouter initialEntries={entries} {...(index === undefined ? {} : { initialIndex: index })}>
      <Probe /><BackControl />
      <Routes>
        <Route path="/trips" element={<TripsListScreen trips={{ list }} onLocalLogout={async () => undefined} now={() => NOW} />} />
        <Route path="/trips/:id/itinerary" element={<Link to="/trips">Volver a mis viajes</Link>} />
        <Route path="/start" element={<p>Inicio</p>} />
      </Routes>
    </MemoryRouter>,
  ));
  return { container, list };
}
const tab = (container: HTMLElement, label: string) => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((el) => el.textContent === label)!;
const names = (container: HTMLElement) => [...container.querySelectorAll(".trips-item h2")].map((el) => el.textContent);
const click = async (element: Element | undefined) => { await act(async () => (element as HTMLElement).click()); };

describe("Trips list tab in the URL", () => {
  it("opens Finalizados with ?filter=finished", async () => {
    const { container } = await renderAt(["/trips?filter=finished"]);
    expect(tab(container, "Finalizados").getAttribute("aria-selected")).toBe("true");
    expect(names(container)).toEqual(["Terminado"]);
  });

  it.each(["?filter=active", "?filter=other", "?filter=", "?filter=FINISHED", "?x=1"])("falls back to Activos with %s", async (search) => {
    const { container } = await renderAt([`/trips${search}`]);
    expect(tab(container, "Activos").getAttribute("aria-selected")).toBe("true");
    expect(names(container)).toEqual(["Futuro"]);
  });

  it("writes the tab in the URL replacing the entry, without stacking history", async () => {
    const { container } = await renderAt(["/start", "/trips"], 1);
    await click(tab(container, "Finalizados"));
    expect(currentLocation).toBe("/trips?filter=finished");
    await click(tab(container, "Activos"));
    expect(currentLocation).toBe("/trips");
    await click(tab(container, "Finalizados"));
    await act(async () => goBack());
    expect(currentLocation).toBe("/start");
  });

  it("remembers the tab for a later visit without the parameter and does not reload it per tab", async () => {
    const { container, list } = await renderAt(["/trips"]);
    await click(tab(container, "Finalizados"));
    expect(getRememberedFilter()).toBe("finished");
    expect(list).toHaveBeenCalledOnce();
  });

  it("without the parameter uses the remembered tab, e.g. after opening a Trip and using the back link", async () => {
    const { container } = await renderAt(["/trips"]);
    await click(tab(container, "Finalizados"));
    await click(container.querySelector('a[href="/trips/b2/itinerary"]') ?? undefined);
    expect(currentLocation).toBe("/trips/b2/itinerary");
    await click([...container.querySelectorAll("a")].find((a) => a.textContent === "Volver a mis viajes"));
    expect(currentLocation).toBe("/trips");
    expect(tab(container, "Finalizados").getAttribute("aria-selected")).toBe("true");
    expect(names(container)).toEqual(["Terminado"]);
  });

  it("the browser Back from a Trip also returns to the selected tab", async () => {
    const { container } = await renderAt(["/trips"]);
    await click(tab(container, "Finalizados"));
    await click(container.querySelector('a[href="/trips/b2/itinerary"]') ?? undefined);
    await act(async () => goBack());
    expect(currentLocation).toBe("/trips?filter=finished");
    expect(names(container)).toEqual(["Terminado"]);
  });

  it("choosing Activos is remembered too", async () => {
    const { container } = await renderAt(["/trips?filter=finished"]);
    await click(tab(container, "Activos"));
    await click(container.querySelector('a[href="/trips/a1/itinerary"]') ?? undefined);
    await click([...container.querySelectorAll("a")].find((a) => a.textContent === "Volver a mis viajes"));
    expect(tab(container, "Activos").getAttribute("aria-selected")).toBe("true");
  });
});
