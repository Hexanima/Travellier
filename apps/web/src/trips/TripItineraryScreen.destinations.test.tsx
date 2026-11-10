// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation, useNavigate, type NavigateFunction } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { itineraryFixture, itineraryId } from "./itinerary-test-fixture.js";
import type { TripItineraryResponse } from "./trip-itinerary-api.js";
import { TripItineraryScreen } from "./TripItineraryScreen.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
let scrollTo: ReturnType<typeof vi.fn>, scrollIntoView: ReturnType<typeof vi.fn>;
beforeEach(() => { scrollTo = vi.fn(); window.scrollTo = scrollTo as never; scrollIntoView = vi.fn(); Element.prototype.scrollIntoView = scrollIntoView as never; });

const tripId = itineraryId(1);
const A = itineraryId(2), B = itineraryId(3), C = itineraryId(4);
const iso = (day: string, hour: number) => `${day}T${String(hour).padStart(2, "0")}:00:00.000Z`;
type Stop = { id: string; name: string; order: number; out?: string; back?: string };
/** Local fixture (the shared one is untouched): one activity window per complete stop, derived from its transports. */
function trip(stops: Stop[]): TripItineraryResponse {
  const base = itineraryFixture() as TripItineraryResponse;
  const destinations = stops.map((s) => ({ ...base.destinations[0]!, id: s.id, name: s.name, order: s.order }));
  const transports: TripItineraryResponse["transports"] = [];
  const days: TripItineraryResponse["days"] = [];
  let n = 100;
  for (const s of stops) {
    if (s.out) transports.push({ ...base.transports[0]!, id: itineraryId(n++), destinationId: s.id, direction: "outbound", departureAt: new Date(Date.parse(s.out) - 3600_000).toISOString(), arrivalAt: s.out, postIds: [] });
    if (s.back) transports.push({ ...base.transports[1]!, id: itineraryId(n++), destinationId: s.id, direction: "return", departureAt: s.back, arrivalAt: new Date(Date.parse(s.back) + 3600_000).toISOString(), postIds: [] });
    if (s.out && s.back) days.push({ ...base.days[1]!, id: itineraryId(n++), destinationId: s.id, type: "activity", startsAt: s.out, endsAt: s.back, order: 1, items: [] });
  }
  return { ...base, destinations, transports, days, activities: [], posts: [], expenses: [] } as TripItineraryResponse;
}
// A: 25 to 28 (18:00Z); B: 28 (19:00Z) to Oct 1; C: only the outbound transport.
const standard = (): TripItineraryResponse => trip([
  { id: A, name: "Córdoba", order: 1, out: iso("2026-09-25", 10), back: iso("2026-09-28", 18) },
  { id: B, name: "Mendoza", order: 2, out: iso("2026-09-28", 19), back: iso("2026-10-01", 12) },
  { id: C, name: "Salta", order: 3, out: iso("2026-10-02", 10) }]);
// Arrival at B at 02:00Z of the 29th: the 29th in UTC, still the 28th in Buenos Aires.
const shifted = (): TripItineraryResponse => trip([
  { id: A, name: "Córdoba", order: 1, out: iso("2026-09-25", 10), back: iso("2026-09-29", 1) },
  { id: B, name: "Mendoza", order: 2, out: iso("2026-09-29", 2), back: iso("2026-10-01", 12) }]);

let go: NavigateFunction = () => undefined;
let where = { pathname: "", search: "", key: "" };
function Probe() { go = useNavigate(); const l = useLocation(); where = { pathname: l.pathname, search: l.search, key: l.key }; return null; }
async function render(entry = `/trips/${tripId}/itinerary`, timeZone = "UTC", value = standard()) {
  const get = vi.fn().mockImplementation(async (id: string) => ({ ok: true, value: { ...structuredClone(value), tripId: id } }));
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={["/trips", entry]} initialIndex={1}><Probe />
    <Routes><Route path="/trips" element={<p>mis viajes</p>} />
      <Route path="/trips/:tripId/itinerary" element={<TripItineraryScreen itinerary={{ get }} timeZone={timeZone} />} /></Routes>
  </MemoryRouter>));
  return container;
}
const chips = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>(".itinerary-day-chip")];
const chip = (c: HTMLElement, date: string) => chips(c).find((item) => item.getAttribute("data-day") === date)!;
const shownDates = (c: HTMLElement) => [...c.querySelectorAll("[data-itinerary-date]")].map((n) => n.getAttribute("data-itinerary-date"));
const currentChip = (c: HTMLElement) => chips(c).filter((item) => item.getAttribute("aria-current") === "date").map((item) => item.getAttribute("data-day"));
const banner = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;
const dialog = (c: HTMLElement) => c.querySelector<HTMLElement>('[role="dialog"]');
const stop = (c: HTMLElement, name: string) => [...c.querySelectorAll<HTMLButtonElement>("button.destination-picker__stop")].find((b) => b.textContent!.includes(name))!;
const press = (el: HTMLElement) => act(async () => el.click());
const param = (name: string) => new URLSearchParams(where.search).get(name);
const escape = () => act(async () => { dialog(document.body)!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });

describe.each(["UTC", "America/Argentina/Buenos_Aires"])("itinerary destination selector (%s)", (zone) => {
  it("the banner names the destination of the day and opens the selector", async () => {
    const c = await render(`/trips/${tripId}/itinerary`, zone);
    expect(banner(c).textContent).toBe("Destino: Córdoba · Ver destinos");
    expect(dialog(c)).toBeNull();
    await press(banner(c));
    expect(dialog(c)!.textContent).toContain("Destinos del viaje");
    expect([...c.querySelectorAll("button.destination-picker__stop")].map((b) => b.getAttribute("aria-current"))).toEqual(["true", null, null]);
    expect(where.search).toBe("");
  });
  it("shows the destination of another day", async () => {
    const c = await render(`/trips/${tripId}/itinerary?day=2026-09-30`, zone);
    expect(banner(c).textContent).toBe("Destino: Mendoza · Ver destinos");
  });
  it("choosing a complete destination goes to its first day and keeps the date visible in the strip", async () => {
    const c = await render(`/trips/${tripId}/itinerary`, zone);
    await press(banner(c)); scrollIntoView.mockClear();
    await press(stop(c, "Mendoza"));
    expect(param("destination")).toBe(B); expect(param("day")).toBe("2026-09-28");
    expect(shownDates(c)).toEqual(["2026-09-28"]);
    expect(currentChip(c)).toEqual(["2026-09-28"]);
    expect(scrollIntoView.mock.contexts).toContain(chip(c, "2026-09-28"));
    expect(scrollTo).not.toHaveBeenCalled();
    expect(dialog(c)).toBeNull();
    expect(banner(c).textContent).toContain("Mendoza");
    await act(async () => go(-1)); // replaced entry: Back leaves the itinerary
    expect(where.pathname).toBe("/trips");
  });
  it("choosing a destination whose first day is already the current one still reveals that chip", async () => {
    const c = await render(`/trips/${tripId}/itinerary?day=2026-09-25`, zone);
    await press(banner(c)); scrollIntoView.mockClear();
    await press(stop(c, "Córdoba"));
    expect(param("destination")).toBe(A); expect(param("day")).toBe("2026-09-25");
    expect(scrollIntoView.mock.contexts).toContain(chip(c, "2026-09-25"));
    expect(dialog(c)).toBeNull();
  });
  it("the chosen destination survives on a shared date and on taps inside its range, and is cleared outside it", async () => {
    const c = await render(`/trips/${tripId}/itinerary`, zone);
    await press(banner(c)); await press(stop(c, "Mendoza"));
    expect(banner(c).textContent).toContain("Mendoza"); // 28th is shared with Córdoba
    await press(chip(c, "2026-09-30"));
    expect(param("destination")).toBe(B);
    await press(chip(c, "2026-09-28"));
    expect(param("destination")).toBe(B); expect(banner(c).textContent).toContain("Mendoza");
    await press(chip(c, "2026-09-26"));
    expect(param("destination")).toBeNull(); expect(param("day")).toBe("2026-09-26");
    expect(banner(c).textContent).toContain("Córdoba");
    // Without an explicit choice, the shared date belongs to the first by order.
    await press(chip(c, "2026-09-28"));
    expect(banner(c).textContent).toContain("Córdoba");
  });
  it("tapping a shared date keeps the Córdoba choice and still shows every segment of the date", async () => {
    const c = await render(`/trips/${tripId}/itinerary?destination=${A}&day=2026-09-26`, zone);
    await press(chip(c, "2026-09-28"));
    expect(param("destination")).toBe(A);
    expect(c.querySelectorAll(".itinerary-band").length).toBeGreaterThanOrEqual(2);
  });
  it("closing with Escape or X changes neither the URL, the day nor the scroll", async () => {
    const c = await render(`/trips/${tripId}/itinerary?day=2026-09-27`, zone);
    const key = where.key;
    scrollIntoView.mockClear(); // a restored day reveals its chip once on load
    await press(banner(c)); await escape();
    expect(dialog(c)).toBeNull();
    await press(banner(c)); await press(c.querySelector<HTMLElement>('button[aria-label="Cerrar"]')!);
    expect(dialog(c)).toBeNull();
    expect(where.key).toBe(key); expect(where.search).toBe("?day=2026-09-27");
    expect(shownDates(c)).toEqual(["2026-09-27"]);
    expect(scrollTo).not.toHaveBeenCalled(); expect(scrollIntoView).not.toHaveBeenCalled();
  });
  it("an incomplete destination is disabled with its reason and neither navigates nor invents a date", async () => {
    const c = await render(`/trips/${tripId}/itinerary`, zone);
    await press(banner(c));
    const salta = stop(c, "Salta");
    expect(salta.disabled).toBe(true);
    expect(salta.textContent).toContain("Falta configurar la salida");
    const key = where.key;
    await press(salta);
    expect(where.key).toBe(key); expect(where.search).toBe("");
    expect(chips(c).map((item) => item.getAttribute("data-day"))).not.toContain("2026-10-02");
    expect(dialog(c)).not.toBeNull();
  });
  it("an invalid or foreign ?destination is ignored without rewriting the URL", async () => {
    for (const bad of ["zzz", itineraryId(55)]) {
      const c = await render(`/trips/${tripId}/itinerary?destination=${bad}`, zone);
      expect(banner(c).textContent, bad).toContain("Córdoba");
      expect(where.search, bad).toBe(`?destination=${bad}`);
      await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren();
    }
  });
  it("opening and closing another dialog in the URL keeps destination and day (T98 round trip)", async () => {
    const c = await render(`/trips/${tripId}/itinerary?destination=${B}&day=2026-09-29`, zone);
    await act(async () => go(`/trips/${tripId}/itinerary?destination=${B}&day=2026-09-29&activity=${itineraryId(9)}`, { replace: true }));
    await act(async () => go(`/trips/${tripId}/itinerary?destination=${B}&day=2026-09-29`, { replace: true }));
    expect(shownDates(c)).toEqual(["2026-09-29"]);
    expect(banner(c).textContent).toContain("Mendoza");
  });
  it("arrival and departure on the same local day", async () => {
    const same = trip([{ id: A, name: "Córdoba", order: 1, out: iso("2026-09-25", 12), back: iso("2026-09-25", 15) }]);
    const c = await render(`/trips/${tripId}/itinerary`, zone, same);
    expect(banner(c).textContent).toBe("Destino: Córdoba · Ver destinos"); // a single destination also has the banner
    await press(banner(c)); await press(stop(c, "Córdoba"));
    expect(param("day")).toBe("2026-09-25");
    expect(shownDates(c)).toEqual(["2026-09-25"]);
  });
});

describe("itinerary destination selector across time zones", () => {
  it("the first day is the local date of the arrival", async () => {
    const utc = await render(`/trips/${tripId}/itinerary`, "UTC", shifted());
    await press(banner(utc)); await press(stop(utc, "Mendoza"));
    expect(param("day")).toBe("2026-09-29");
    await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren();
    const ba = await render(`/trips/${tripId}/itinerary`, "America/Argentina/Buenos_Aires", shifted());
    await press(banner(ba)); await press(stop(ba, "Mendoza"));
    expect(param("day")).toBe("2026-09-28");
    expect(shownDates(ba)).toEqual(["2026-09-28"]);
  });
});
