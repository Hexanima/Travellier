// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { itineraryFixture, itineraryId } from "./itinerary-test-fixture.js";
import type { TripItineraryResponse } from "./trip-itinerary-api.js";
import { TripItineraryScreen } from "./TripItineraryScreen.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
beforeEach(() => { window.scrollTo = vi.fn() as never; Element.prototype.scrollIntoView = vi.fn() as never; });

const tripId = itineraryId(1);
const iso = (day: string, hour: number) => `${day}T${String(hour).padStart(2, "0")}:00:00.000Z`;
/** A Trip from the 25th to the 28th of September 2026 (UTC), one activity window. */
function trip(): TripItineraryResponse {
  const base = itineraryFixture() as TripItineraryResponse;
  const destination = base.destinations[0]!;
  const transports: TripItineraryResponse["transports"] = [
    { ...base.transports[0]!, id: itineraryId(100), destinationId: destination.id, direction: "outbound", departureAt: iso("2026-09-25", 8), arrivalAt: iso("2026-09-25", 10), postIds: [] },
    { ...base.transports[1]!, id: itineraryId(101), destinationId: destination.id, direction: "return", departureAt: iso("2026-09-28", 18), arrivalAt: iso("2026-09-28", 20), postIds: [] },
  ];
  const days: TripItineraryResponse["days"] = [{ ...base.days[1]!, id: itineraryId(102), destinationId: destination.id, type: "activity",
    startsAt: iso("2026-09-25", 10), endsAt: iso("2026-09-28", 18), order: 1, items: [] }];
  return { ...base, transports, days, activities: [], posts: [], expenses: [] } as TripItineraryResponse;
}

let where = { search: "", pathname: "" };
function Probe() { const location = useLocation(); where = { search: location.search, pathname: location.pathname }; return null; }
async function render(entry: string, timeZone: string, now: string) {
  const get = vi.fn().mockImplementation(async (id: string) => ({ ok: true, value: { ...structuredClone(trip()), tripId: id } }));
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={[entry]}><Probe />
    <Routes><Route path="/trips/:tripId/itinerary" element={<TripItineraryScreen itinerary={{ get }} timeZone={timeZone} now={() => new Date(now)} />} /></Routes>
  </MemoryRouter>));
  return container;
}
const current = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>(".itinerary-day-chip")]
  .filter((item) => item.getAttribute("aria-current") === "date").map((item) => item.getAttribute("data-day"));
const path = `/trips/${tripId}/itinerary`;

describe("día inicial del itinerario", () => {
  it("abre en hoy cuando el día pertenece al viaje", async () => {
    const container = await render(path, "UTC", "2026-09-27T09:00:00.000Z");
    expect(current(container)).toEqual(["2026-09-27"]);
    expect(where.search).toBe("");
  });

  it("abre en el primer día cuando hoy es anterior al viaje", async () => {
    const container = await render(path, "UTC", "2026-09-01T09:00:00.000Z");
    expect(current(container)).toEqual(["2026-09-25"]);
  });

  it("abre en el primer día cuando hoy es posterior al viaje", async () => {
    const container = await render(path, "UTC", "2026-12-01T09:00:00.000Z");
    expect(current(container)).toEqual(["2026-09-25"]);
  });

  it("un ?day válido manda sobre hoy", async () => {
    const container = await render(`${path}?day=2026-09-26`, "UTC", "2026-09-27T09:00:00.000Z");
    expect(current(container)).toEqual(["2026-09-26"]);
  });

  it("un ?day inválido cae en hoy sin reescribir la URL", async () => {
    const container = await render(`${path}?day=2030-01-01`, "UTC", "2026-09-27T09:00:00.000Z");
    expect(current(container)).toEqual(["2026-09-27"]);
    expect(where.search).toBe("?day=2030-01-01");
  });

  it("el mismo instante resuelve días locales distintos según la zona", async () => {
    const utc = await render(path, "UTC", "2026-09-28T02:00:00.000Z");
    expect(current(utc)).toEqual(["2026-09-28"]);
    const local = await render(path, "America/Argentina/Buenos_Aires", "2026-09-28T02:00:00.000Z");
    expect(current(local)).toEqual(["2026-09-27"]);
  });
});
