// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TransportDialog } from "./TransportDialog.js";
import { itineraryFixture, itineraryId } from "./itinerary-test-fixture.js";
import type { TripItineraryResponse } from "./trip-itinerary-api.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
const BA = "America/Argentina/Buenos_Aires";
const T = itineraryId(6);

const build = (patch: Record<string, unknown> = {}, departureAt = "2026-09-25T22:30:00.123Z", arrivalAt = "2026-09-26T05:15:00.456Z") => {
  const itinerary = itineraryFixture() as TripItineraryResponse;
  itinerary.posts = []; itinerary.unplacedPosts = []; itinerary.activities = [];
  itinerary.days = [{ ...itinerary.days[0]!, startsAt: departureAt, endsAt: arrivalAt, items: [{ kind: "transport", id: T, at: departureAt }] }];
  itinerary.transports = [{ ...itinerary.transports[0]!, departureAt, arrivalAt, ...patch } as TripItineraryResponse["transports"][number]];
  return itinerary;
};
async function mount(itinerary: TripItineraryResponse, options: { timeZone?: string; onClose?: () => void; withMemories?: boolean } = {}) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  const trigger = document.createElement("button"); trigger.textContent = "Abrir"; document.body.append(trigger); trigger.focus();
  function Host() {
    const [open, setOpen] = useState(true);
    return open ? <TransportDialog transport={itinerary.transports[0]!} itinerary={itinerary} timeZone={options.timeZone ?? BA}
      onClose={() => { options.onClose?.(); setOpen(false); }} memories={options.withMemories ? <p>MEMORIAS</p> : undefined} /> : null;
  }
  await act(async () => root.render(<Host />));
  return { container, trigger };
}
const text = () => document.querySelector('[role="dialog"]')?.textContent ?? "";
const times = () => Array.from(document.querySelectorAll("time")).map((item) => item.getAttribute("datetime"));

describe("TransportDialog", () => {
  it("shows type, origin to destination, exact ISO instants and the zone", async () => {
    await mount(build());
    expect(document.querySelector("h3")!.textContent).toBe("Auto");
    expect(text()).toContain("Buenos Aires → Córdoba");
    expect(times()).toContain("2026-09-25T22:30:00.123Z");
    expect(times()).toContain("2026-09-26T05:15:00.456Z");
    expect(text()).toContain(`Horarios en ${BA}`);
    expect(text()).toContain("19:30");
    expect(text()).toContain("02:15");
    expect(text()).not.toContain("Invalid");
  });
  it("lists one row per local day without inventing hours on intermediate days", async () => {
    await mount(build({}, "2026-09-25T10:00:00.000Z", "2026-09-28T09:00:00.000Z"), { timeZone: "UTC" });
    const rows = Array.from(document.querySelectorAll("[data-transport-day]"));
    expect(rows.map((row) => row.getAttribute("data-transport-day"))).toEqual(["2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28"]);
    expect(rows[0]!.textContent).toContain("Salida");
    expect(rows[1]!.textContent).toContain("En tránsito");
    expect(rows[1]!.querySelector("time")).toBeNull();
    expect(rows[3]!.textContent).toContain("Llegada");
    expect(document.querySelector('[aria-label="Por día local"], section[aria-labelledby]')).not.toBeNull();
  });
  it("shows the steps of a local bus with a precise time, a legacy clock and a missing time", async () => {
    await mount(build({ type: "bus_local", details: { steps: [
      { line: "60", fromStop: "Terminal", toStop: "Centro", estimatedAt: "2026-09-25T22:45:00.000Z" },
      { line: "29", fromStop: "Centro", toStop: "Hotel", estimatedTime: "07:45" },
      { line: "5", fromStop: "Hotel", toStop: "Plaza" },
    ] } }));
    const steps = Array.from(document.querySelectorAll("[data-transport-step]"));
    expect(steps).toHaveLength(3);
    expect(steps[0]!.textContent).toContain("Línea 60");
    expect(steps[0]!.textContent).toContain("Terminal → Centro");
    expect(steps[0]!.querySelector("time")!.getAttribute("datetime")).toBe("2026-09-25T22:45:00.000Z");
    expect(steps[0]!.textContent).toContain("19:45");
    expect(steps[1]!.textContent).toContain("07:45");
    expect(steps[1]!.textContent).toContain("Sin fecha ni zona horaria");
    expect(steps[1]!.querySelector("time")).toBeNull();
    expect(steps[2]!.textContent).toContain("Sin horario");
    expect(text()).not.toContain("Invalid");
  });
  it("shows airline, flight, company and terminal only when they have content", async () => {
    await mount(build({ type: "flight", details: { airline: "Aerolíneas", flightNumber: "  " } }));
    expect(text()).toContain("Aerolíneas");
    expect(text()).not.toContain("Vuelo");
    await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren();
    await mount(build({ type: "bus_long", details: { company: "Flecha", terminal: null } }));
    expect(text()).toContain("Flecha");
    expect(text()).not.toContain("Terminal");
    await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren();
    await mount(build({ type: "other", details: {} }));
    expect(document.querySelector("dl")).toBeNull();
  });
  it("shows the cost per person with its currency", async () => {
    await mount(build({ costPerPerson: 1234.5, costCurrency: "USD" }));
    expect(document.querySelector("[data-transport-cost]")?.textContent).toBe("Costo por persona: USD 1.234,50");
    expect(text()).not.toContain("Moneda sin indicar");
  });
  it("shows a previous cost without currency as the plain amount, flagged, with the way to fix it", async () => {
    await mount(build({ costPerPerson: 80, costCurrency: null }));
    expect(document.querySelector("[data-transport-cost]")?.textContent).toContain("Costo por persona: 80,00");
    expect(text()).toContain("Moneda sin indicar");
    expect(text()).toContain("Editá el transporte para elegir la moneda");
  });
  it("shows nothing about cost when the transport has none", async () => {
    await mount(build({ costPerPerson: null, costCurrency: null }));
    expect(document.querySelector("[data-transport-cost]")).toBeNull();
    expect(text()).not.toContain("Costo");
    expect(text()).not.toContain("Moneda sin indicar");
  });
  it("moves the focus to the heading on open, has no alert, and returns the focus to the trigger on close", async () => {
    const onClose = vi.fn();
    const { trigger } = await mount(build(), { onClose });
    expect(document.activeElement).toBe(document.querySelector("h3"));
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(0);
    await act(async () => (document.querySelector('[aria-label="Cerrar"]') as HTMLButtonElement).click());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  it("renders the memories slot when given and just the detail without it", async () => {
    await mount(build(), { withMemories: true });
    expect(text()).toContain("MEMORIAS");
    await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren();
    await mount(build());
    expect(text()).not.toContain("MEMORIAS");
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(0);
    expect(text()).toContain("Por día local");
  });
});
