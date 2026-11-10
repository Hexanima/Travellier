// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TripsListScreen } from "./TripScreens.js";
import type { TripListItem, TripManagementApi } from "./trip-management-api.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const START = Date.parse("2026-10-10T12:00:00.000Z");
const mk = (id: string, name: string, endAt: string | null): TripListItem =>
  ({ id, name, description: null, primaryDestination: { name: "Destino" }, startAt: null, endAt });
const isoAt = (offsetMs: number) => new Date(START + offsetMs).toISOString();
const roots: ReturnType<typeof createRoot>[] = [];
const originalTz = process.env.TZ;

beforeEach(() => { vi.useFakeTimers({ now: START }); });
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (originalTz === undefined) delete process.env.TZ; else process.env.TZ = originalTz;
});

type List = TripManagementApi["list"];
async function renderTrips(list: List, now?: () => number) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(
    <MemoryRouter initialEntries={["/trips"]}>
      <Routes><Route path="/trips" element={<TripsListScreen trips={{ list }} onLocalLogout={async () => undefined} {...(now ? { now } : {})} />} /></Routes>
    </MemoryRouter>,
  ));
  return { container, unmount: async () => act(async () => root.unmount()) };
}
const ok = (value: TripListItem[]) => ({ ok: true, value }) as const;
const tab = (container: HTMLElement, label: string) => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((el) => el.textContent === label)!;
const names = (container: HTMLElement) => [...container.querySelectorAll(".trips-item h2")].map((el) => el.textContent);
const advance = async (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const foreground = async (event: "focus" | "visibilitychange") => act(async () => {
  if (event === "focus") window.dispatchEvent(new Event("focus")); else document.dispatchEvent(new Event("visibilitychange"));
});

describe("Trips list clock", () => {
  it("moves a Trip to Finalizados when its limit passes, without reloading and keeping the exact limit active", async () => {
    const list = vi.fn<List>().mockResolvedValue(ok([mk("t1", "Por terminar", isoAt(10_000)), mk("t2", "Largo", isoAt(10 * 86_400_000))]));
    const { container } = await renderTrips(list);
    expect(names(container)).toEqual(["Por terminar", "Largo"]);
    await advance(10_000);
    expect(Date.now()).toBe(START + 10_000);
    expect(names(container)).toEqual(["Por terminar", "Largo"]);
    await advance(1);
    expect(names(container)).toEqual(["Largo"]);
    await act(async () => tab(container, "Finalizados").click());
    expect(names(container)).toEqual(["Por terminar"]);
    expect(list).toHaveBeenCalledOnce();
  });

  it("uses the injected clock for the classification", async () => {
    let clock = START;
    const list = vi.fn<List>().mockResolvedValue(ok([mk("t1", "Viaje", isoAt(0))]));
    const { container } = await renderTrips(list, () => clock);
    expect(names(container)).toEqual(["Viaje"]);
    clock = START + 1;
    await foreground("focus");
    expect(names(container)).toEqual([]);
  });

  it.each(["focus", "visibilitychange"] as const)("reloads silently and reclassifies when coming back to the foreground (%s)", async (event) => {
    const second = ok([mk("t1", "Viaje", isoAt(5_000)), mk("t2", "Nuevo", null)]);
    let resolveSecond!: (value: ReturnType<typeof ok>) => void;
    const list = vi.fn<List>().mockResolvedValueOnce(ok([mk("t1", "Viaje", isoAt(5_000))]))
      .mockReturnValueOnce(new Promise((resolve) => { resolveSecond = resolve; }));
    const { container } = await renderTrips(list);
    vi.setSystemTime(START + 6_000);
    await foreground(event);
    expect(list).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain("Cargando viajes…");
    expect(names(container)).toEqual([]);
    await act(async () => resolveSecond(second));
    expect(names(container)).toEqual(["Nuevo"]);
  });

  it("keeps the previous Trips and shows no error when a silent refresh fails, but still reclassifies", async () => {
    const list = vi.fn<List>().mockResolvedValueOnce(ok([mk("t1", "Viaje", isoAt(5_000))]))
      .mockResolvedValue({ ok: false, error: { kind: "network" } });
    const { container } = await renderTrips(list);
    vi.setSystemTime(START + 4_000);
    await foreground("focus");
    expect(list).toHaveBeenCalledTimes(2);
    expect(names(container)).toEqual(["Viaje"]);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    vi.setSystemTime(START + 6_000);
    await advance(1_500);
    await foreground("visibilitychange");
    expect(list).toHaveBeenCalledTimes(3);
    expect(names(container)).toEqual([]);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("refreshes every 45 seconds while open", async () => {
    const list = vi.fn<List>().mockResolvedValue(ok([mk("t1", "Viaje", null)]));
    await renderTrips(list);
    await advance(44_000);
    expect(list).toHaveBeenCalledTimes(1);
    await advance(1_000);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("an initial error is kept by a silent refresh that also fails and cleared by one that succeeds", async () => {
    const list = vi.fn<List>().mockResolvedValueOnce({ ok: false, error: { kind: "network" } })
      .mockResolvedValueOnce({ ok: false, error: { kind: "network" } }).mockResolvedValueOnce(ok([mk("t1", "Viaje", null)]));
    const { container } = await renderTrips(list);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    await advance(45_000);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    await advance(45_000);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(names(container)).toEqual(["Viaje"]);
  });

  it("clears the limit timer and the interval when unmounting", async () => {
    const list = vi.fn<List>().mockResolvedValue(ok([mk("t1", "Viaje", isoAt(10_000))]));
    const { unmount } = await renderTrips(list);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("schedules no limit timer when nothing can expire", async () => {
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    await renderTrips(vi.fn<List>().mockResolvedValue(ok([mk("t1", "Sin fechas", null), mk("t2", "Pasado", isoAt(-1_000))])));
    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });

  it("caps the limit timer below 2^31 ms and re-evaluates instead of finishing early", async () => {
    const limit = 40 * 86_400_000;
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    const list = vi.fn<List>().mockResolvedValue(ok([mk("t1", "Lejano", isoAt(limit))]));
    const { container } = await renderTrips(list);
    expect(setTimeoutSpy.mock.calls.at(-1)?.[1]).toBe(2 ** 31 - 1);
    act(() => { vi.advanceTimersByTime(2 ** 31 - 1); });
    await advance(0);
    expect(names(container)).toEqual(["Lejano"]);
    const delays = setTimeoutSpy.mock.calls.map((call) => call[1] as number);
    expect(delays.every((delay) => delay <= 2 ** 31 - 1)).toBe(true);
    expect(delays.at(-1)).toBe(limit - (2 ** 31 - 1) + 1);
  });

  it("does not change tab nor classification when the device time zone changes", async () => {
    process.env.TZ = "UTC";
    const list = vi.fn<List>().mockResolvedValue(ok([mk("t1", "Viaje", isoAt(5_000)), mk("t2", "Viejo", isoAt(-5_000))]));
    const { container } = await renderTrips(list);
    expect(names(container)).toEqual(["Viaje"]);
    process.env.TZ = "America/Argentina/Buenos_Aires";
    await foreground("focus");
    expect(tab(container, "Activos").getAttribute("aria-selected")).toBe("true");
    expect(names(container)).toEqual(["Viaje"]);
    await act(async () => tab(container, "Finalizados").click());
    expect(names(container)).toEqual(["Viejo"]);
  });
});
