// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TripsListScreen } from "./TripScreens.js";
import type { TripListItem, TripManagementApi } from "./trip-management-api.js";
import { resetRememberedFilter } from "./trips-filter-memory.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.parse("2026-10-10T12:00:00.000Z");
const mk = (id: string, name: string, startAt: string | null, endAt: string | null): TripListItem =>
  ({ id, name, description: null, primaryDestination: { name: "Destino" }, startAt, endAt });
const future = mk("507f191e810c19729de86001", "Futuro", "2026-12-01T10:00:00.000Z", "2026-12-09T10:00:00.000Z");
const past = mk("507f191e810c19729de86002", "Terminado", "2026-09-01T10:00:00.000Z", "2026-09-09T10:00:00.000Z");
const undated = mk("507f191e810c19729de86003", "Sin fechas", null, null);
const roots: ReturnType<typeof createRoot>[] = [];

afterEach(async () => {
  resetRememberedFilter();
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  document.body.replaceChildren();
});

type List = TripManagementApi["list"];
async function renderTrips(list: List, now: () => number = () => NOW) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(
    <MemoryRouter initialEntries={["/trips"]}>
      <Routes><Route path="/trips" element={<TripsListScreen trips={{ list }} onLocalLogout={async () => undefined} now={now} />} /></Routes>
    </MemoryRouter>,
  ));
  return container;
}
const ok = (value: TripListItem[]) => vi.fn<List>().mockResolvedValue({ ok: true, value });
const tab = (container: HTMLElement, label: string) => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((el) => el.textContent === label)!;
const select = async (container: HTMLElement, label: string) => { await act(async () => tab(container, label).click()); };
const names = (container: HTMLElement) => [...container.querySelectorAll(".trips-item h2")].map((el) => el.textContent);

describe("Trips list tabs", () => {
  it("opens on Activos and does not show the finished Trip", async () => {
    const list = ok([future, past, undated]);
    const container = await renderTrips(list);
    expect(tab(container, "Activos").getAttribute("aria-selected")).toBe("true");
    expect(tab(container, "Finalizados").getAttribute("aria-selected")).toBe("false");
    expect(names(container)).toEqual(["Futuro", "Sin fechas"]);
    expect(container.textContent).not.toContain("Terminado");
  });

  it("shows the finished Trips in Finalizados and only asks the list once, never the itineraries", async () => {
    const list = ok([future, past, undated]);
    const container = await renderTrips(list);
    await select(container, "Finalizados");
    expect(names(container)).toEqual(["Terminado"]);
    expect(list).toHaveBeenCalledOnce();
  });

  it("keeps Trips with incomplete dates in Activos", async () => {
    const container = await renderTrips(ok([mk("a1", "Solo inicio", "2026-09-01T10:00:00.000Z", null), mk("a2", "Solo fin", null, "2026-12-01T10:00:00.000Z")]));
    expect(names(container)).toEqual(["Solo inicio", "Solo fin"]);
  });

  it("never duplicates a Trip returned twice", async () => {
    const container = await renderTrips(ok([future, { ...future }, past, past]));
    expect(names(container)).toEqual(["Futuro"]);
    await select(container, "Finalizados");
    expect(names(container)).toEqual(["Terminado"]);
  });

  it("shows a per-tab empty state when there are Trips in the other tab", async () => {
    const onlyPast = await renderTrips(ok([past]));
    expect(onlyPast.textContent).toContain("No tenés viajes activos");
    expect(onlyPast.querySelector('a[href="/trips/new"]')).not.toBeNull();
    expect(onlyPast.textContent).not.toContain("Todavía no tenés viajes");
    const onlyFuture = await renderTrips(ok([future]));
    await select(onlyFuture, "Finalizados");
    expect(onlyFuture.textContent).toContain("Todavía no tenés viajes finalizados");
  });

  it("without any Trip keeps the first-Trip empty state and Finalizados says there are none finished", async () => {
    const container = await renderTrips(ok([]));
    expect(container.textContent).toContain("Todavía no tenés viajes");
    expect(container.textContent).toContain("Crear mi primer viaje");
    await select(container, "Finalizados");
    expect(container.textContent).toContain("Todavía no tenés viajes finalizados");
  });

  it("shows the loading state inside the tabs and then the Trips", async () => {
    let resolve!: (value: Awaited<ReturnType<List>>) => void;
    const list = vi.fn<List>().mockReturnValue(new Promise((r) => { resolve = r; }));
    const container = await renderTrips(list);
    expect(container.textContent).toContain("Cargando viajes…");
    expect(container.querySelector('[role="tabpanel"]')?.textContent).toContain("Cargando viajes…");
    await act(async () => resolve({ ok: true, value: [future] }));
    expect(container.textContent).not.toContain("Cargando viajes…");
    expect(names(container)).toEqual(["Futuro"]);
  });

  it("shows the error with Retry inside the selected tab", async () => {
    const list = vi.fn<List>().mockResolvedValueOnce({ ok: false, error: { kind: "network" } }).mockResolvedValueOnce({ ok: true, value: [future, past] });
    const container = await renderTrips(list);
    await select(container, "Finalizados");
    expect(container.querySelector('[role="tabpanel"] [role="alert"]')?.textContent).toContain("No pudimos cargar tus viajes");
    await act(async () => [...container.querySelectorAll("button")].find((b) => b.textContent === "Reintentar")!.click());
    expect(list).toHaveBeenCalledTimes(2);
    expect(names(container)).toEqual(["Terminado"]);
  });
});
