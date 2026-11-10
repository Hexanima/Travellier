// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Link, MemoryRouter, Route, Routes, useLocation, useNavigate, type NavigateFunction } from "react-router-dom";
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
const at = (day: number, hour: number) => `2026-09-${day}T${String(hour).padStart(2, "0")}:00:00.000Z`;
/** Four local days (25 to 28 in UTC): outbound transit on the 25th, an activity window until the 28th and the return on the 28th. «Cena» is at 01:00Z of the 28th (the 27th in Buenos Aires). */
function multiDay(): TripItineraryResponse {
  const value = itineraryFixture() as TripItineraryResponse;
  value.days[0]!.startsAt = at(25, 8); value.days[0]!.endsAt = at(25, 10);
  value.days[1]!.startsAt = at(25, 10); value.days[1]!.endsAt = at(28, 18);
  value.days[2]!.startsAt = at(28, 18); value.days[2]!.endsAt = at(28, 20);
  value.transports[0]!.departureAt = at(25, 8); value.transports[0]!.arrivalAt = at(25, 10);
  value.transports[1]!.departureAt = at(28, 18); value.transports[1]!.arrivalAt = at(28, 20);
  value.activities[0]!.scheduledAt = at(25, 12);
  value.activities[1]!.scheduledAt = at(26, 14);
  value.activities.push({ ...value.activities[0]!, id: itineraryId(70), title: "Cena de despedida", scheduledAt: at(28, 1) });
  value.days[1]!.items = value.activities.map((activity) => ({ kind: "activity", id: activity.id, at: activity.scheduledAt }));
  return value;
}
let go: NavigateFunction = () => undefined;
let where = { pathname: "", search: "", key: "" };
function Probe() { go = useNavigate(); const l = useLocation(); where = { pathname: l.pathname, search: l.search, key: l.key }; return null; }
async function render(entry = `/trips/${tripId}/itinerary`, timeZone = "UTC", value = multiDay()) {
  const get = vi.fn().mockImplementation(async (id: string) => ({ ok: true, value: { ...structuredClone(value), tripId: id } }));
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={["/trips", entry]} initialIndex={1}><Probe />
    <Link to={`/trips/${itineraryId(99)}/itinerary`}>Otro viaje</Link>
    <Routes><Route path="/trips" element={<p>mis viajes</p>} />
      <Route path="/trips/:tripId/itinerary" element={<TripItineraryScreen itinerary={{ get }} timeZone={timeZone} />} /></Routes>
  </MemoryRouter>));
  return { container, get };
}
const chips = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>(".itinerary-day-chip")];
const shownDates = (c: HTMLElement) => [...c.querySelectorAll("[data-itinerary-date]")].map((n) => n.getAttribute("data-itinerary-date"));
const current = (c: HTMLElement) => chips(c).filter((chip) => chip.getAttribute("aria-current") === "date").map((chip) => chip.getAttribute("data-day"));
const press = (el: HTMLElement) => act(async () => el.click());
const chip = (c: HTMLElement, date: string) => chips(c).find((item) => item.getAttribute("data-day") === date)!;

describe("itinerary: one day at a time with a date strip", () => {
  it("shows only the first day by default, with one chip per day and no URL rewrite", async () => {
    const { container } = await render();
    expect(shownDates(container)).toEqual(["2026-09-25"]);
    expect(chips(container).map((item) => item.getAttribute("data-day"))).toEqual(["2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28"]);
    expect(current(container)).toEqual(["2026-09-25"]);
    expect(container.querySelector("nav[aria-label='Días del viaje']")).not.toBeNull();
    expect(where.search).toBe("");
    expect(container.textContent).toContain("Paseo por el centro");
    expect(container.textContent).not.toContain("Visita al museo");
  });
  it("restores the day of the URL; an invalid or unknown one falls back to the first day without rewriting the URL", async () => {
    expect(shownDates((await render(`/trips/${tripId}/itinerary?day=2026-09-27`)).container)).toEqual(["2026-09-27"]);
    for (const bad of ["zzz", "2026-9-27", "2026-12-01", "2026-09-27x", "2026-02-31"]) {
      await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren();
      const { container } = await render(`/trips/${tripId}/itinerary?day=${bad}`);
      expect(shownDates(container), bad).toEqual(["2026-09-25"]);
      expect(current(container), bad).toEqual(["2026-09-25"]);
      expect(where.search, bad).toBe(`?day=${bad}`);
    }
  });
  it("changing day replaces the URL, keeps reading position and focus, and keeps the same strip nodes", async () => {
    const { container } = await render();
    const strip = container.querySelector(".itinerary-day-strip");
    const before = chips(container);
    const target = chip(container, "2026-09-26");
    target.focus();
    await press(target);
    expect(where.search).toBe("?day=2026-09-26");
    expect(shownDates(container)).toEqual(["2026-09-26"]);
    expect(current(container)).toEqual(["2026-09-26"]);
    expect(container.textContent).toContain("Visita al museo");
    expect(container.textContent).not.toContain("Paseo por el centro");
    expect(scrollTo).not.toHaveBeenCalled();
    expect(container.querySelector(".itinerary-day-strip")).toBe(strip);
    expect(chips(container)).toEqual(before);
    expect(document.activeElement).toBe(target);
    expect(scrollIntoView).not.toHaveBeenCalled(); // a tap does not move the strip under the finger
    await act(async () => go(-1)); // the entry was replaced: Back leaves the itinerary
    expect(where.pathname).toBe("/trips");
  });
  it("pressing the selected day does nothing: no navigation, no scroll", async () => {
    const { container } = await render(`/trips/${tripId}/itinerary?day=2026-09-27`);
    const key = where.key;
    await press(chip(container, "2026-09-27"));
    expect(where.key).toBe(key);
    expect(where.search).toBe("?day=2026-09-27");
    expect(scrollTo).not.toHaveBeenCalled();
    expect(shownDates(container)).toEqual(["2026-09-27"]);
  });
  it("a selection that changes from outside a tap brings its chip into view", async () => {
    const { container } = await render();
    scrollIntoView.mockClear();
    await act(async () => go(`/trips/${tripId}/itinerary?day=2026-09-28`, { replace: true }));
    expect(current(container)).toEqual(["2026-09-28"]);
    expect(scrollIntoView.mock.contexts).toContain(chip(container, "2026-09-28"));
  });
  it("keeps the day when other parameters change (a dialog opened and closed in the URL)", async () => {
    const { container } = await render(`/trips/${tripId}/itinerary?day=2026-09-26`);
    await act(async () => go(`/trips/${tripId}/itinerary?day=2026-09-26&activity=${itineraryId(9)}`, { replace: true }));
    expect(shownDates(container)).toEqual(["2026-09-26"]);
    await act(async () => go(`/trips/${tripId}/itinerary?day=2026-09-26`, { replace: true }));
    expect(shownDates(container)).toEqual(["2026-09-26"]);
    expect(current(container)).toEqual(["2026-09-26"]);
  });
  it("another Trip starts again from its first day", async () => {
    const { container, get } = await render(`/trips/${tripId}/itinerary?day=2026-09-27`);
    expect(shownDates(container)).toEqual(["2026-09-27"]);
    await act(async () => (Array.from(container.querySelectorAll("a")).find((a) => a.textContent === "Otro viaje") as HTMLElement).click());
    expect(get).toHaveBeenLastCalledWith(itineraryId(99));
    expect(shownDates(container)).toEqual(["2026-09-25"]);
    expect(current(container)).toEqual(["2026-09-25"]);
  });
  it("has no strip without days", async () => {
    const empty = multiDay(); empty.days = []; empty.activities = []; empty.posts = []; empty.transports = [];
    const { container } = await render(undefined, "UTC", empty);
    expect(container.querySelector(".itinerary-day-strip")).toBeNull();
  });
  it("places the days by the local calendar: the same instant is another day in UTC and in Buenos Aires", async () => {
    const utc = await render(`/trips/${tripId}/itinerary?day=2026-09-28`, "UTC");
    expect(utc.container.textContent).toContain("Cena de despedida");
    await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren();
    const ba = await render(`/trips/${tripId}/itinerary?day=2026-09-28`, "America/Argentina/Buenos_Aires");
    expect(ba.container.textContent).not.toContain("Cena de despedida");
    await press(chip(ba.container, "2026-09-27"));
    expect(ba.container.textContent).toContain("Cena de despedida");
  });
});
