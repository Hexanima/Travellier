// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { itineraryFixture, itineraryId } from "./itinerary-test-fixture.js";
import type { TripItineraryResponse } from "./trip-itinerary-api.js";
import type { ActivityInput } from "./trip-activity-api.js";
import { TripItineraryScreen } from "./TripItineraryScreen.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
async function render(value = itineraryFixture() as TripItineraryResponse, timeZone = "America/Argentina/Buenos_Aires") {
  const getItinerary = vi.fn().mockImplementation(async () => ({ ok: true, value: structuredClone(value) }));
  const create = vi.fn().mockImplementation(async (_tripId, input: ActivityInput) => {
    const saved = { ...(itineraryFixture() as TripItineraryResponse).activities[0], ...input, id: itineraryId(30), postIds: [] };
    value.activities.push(saved); return { ok: true, value: saved };
  });
  const get = vi.fn().mockImplementation(async (_tripId, id) => ({ ok: true, value: value.activities.find((a) => a.id === id) }));
  const update = vi.fn().mockImplementation(async (_tripId, id, input) => {
    const activity = value.activities.find((a) => a.id === id)!; Object.assign(activity, input); return { ok: true, value: { ...activity } };
  });
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={[`/trips/${value.tripId}/itinerary`]}>
    <Routes><Route path="/trips/:tripId/itinerary" element={<TripItineraryScreen itinerary={{ get: getItinerary }} activities={{ create, get, update }} timeZone={timeZone} />} /></Routes>
  </MemoryRouter>));
  return { container, create, get, update, getItinerary, value };
}
const button = (container: HTMLElement, label: string) => {
  const result = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent === label || item.getAttribute("aria-label") === label);
  expect(result, `Button ${label}`).toBeDefined(); return result!;
};
const click = async (container: HTMLElement, label: string) => act(async () => button(container, label).click());
const field = async (container: HTMLElement, name: string, value: string) => {
  const element = container.querySelector<HTMLInputElement>(`[name="${name}"]`); expect(element).not.toBeNull();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value); element!.dispatchEvent(new Event("input", { bubbles: true })); });
};
const save = async (container: HTMLElement) => act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

describe("itinerary activity flows", () => {
  it("creates from an enabled band and displays the saved activity chronologically", async () => {
    const { container, create, getItinerary } = await render();
    expect(container.querySelectorAll('[data-itinerary-kind="transit_out"] button,[data-itinerary-kind="transit_return"] button')).toHaveLength(0);
    await click(container, "Crear actividad");
    await field(container, "title", "Nueva actividad"); await field(container, "time", "10:30"); await save(container);
    expect(create).toHaveBeenCalledOnce(); expect(getItinerary).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(Array.from(container.querySelectorAll('[data-itinerary-kind="activity"] [data-itinerary-item]')).map((item) => item.getAttribute("data-itinerary-item")))
      .toEqual([8, 10, 30, 9].map(itineraryId));
    expect(container.textContent).toContain("Actividad guardada");
  });
  it("creates from an empty band", async () => {
    const fixture = itineraryFixture() as TripItineraryResponse; fixture.activities = []; fixture.posts = []; fixture.days.forEach((d) => { d.items = d.items.filter((i) => i.kind === "transport"); });
    const { container, create } = await render(fixture);
    await click(container, "Crear actividad"); await field(container, "title", "Primera actividad"); await field(container, "time", "09:00"); await save(container);
    expect(create).toHaveBeenCalledOnce(); expect(container.textContent).toContain("Primera actividad");
  });
  it("uses the canonical UTC day when one local creation band merges two dates", async () => {
    const fixture = itineraryFixture() as TripItineraryResponse;
    const first = { ...fixture.days[1], startsAt: "2026-09-25T20:00:00.000Z", endsAt: "2026-09-26T00:00:00.000Z", items: [] };
    const next = { ...first, id: itineraryId(40), date: "2026-09-26T00:00:00.000Z", startsAt: first.endsAt, endsAt: "2026-09-26T02:00:00.000Z", order: 2 };
    fixture.days = [first, next]; fixture.activities = []; fixture.posts = []; fixture.transports = [];
    const { container, create } = await render(fixture);
    expect(Array.from(container.querySelectorAll("button")).filter((b) => b.textContent === "Crear actividad")).toHaveLength(1);
    await click(container, "Crear actividad"); await field(container, "title", "Después de cenar"); await field(container, "time", "22:00"); await save(container);
    expect(create).toHaveBeenCalledWith(fixture.tripId, expect.objectContaining({ dayId: next.id, scheduledAt: "2026-09-26T01:00:00.000Z" }));
    expect(container.querySelector('[data-itinerary-date="2026-09-25"]')?.textContent).toContain("Después de cenar");
  });
  it("cancels without writing and restores focus to the trigger", async () => {
    const { container, create } = await render(); const trigger = button(container, "Crear actividad"); trigger.focus();
    await click(container, "Crear actividad"); await click(container, "Cerrar");
    expect(container.querySelector('[role="dialog"]')).toBeNull(); expect(create).not.toHaveBeenCalled(); expect(document.activeElement).toBe(trigger);
  });
  it("opens detail, edits, and reorders without duplicating associated posts", async () => {
    const fixture = itineraryFixture() as TripItineraryResponse; fixture.activities[0].mapsUrl = "https://maps.app.goo.gl/example";
    fixture.posts[0].activityId = fixture.activities[0].id; fixture.activities[0].postIds = [fixture.posts[0].id];
    const { container, get, update } = await render(fixture);
    await click(container, "Paseo por el centro");
    expect(get).toHaveBeenCalledWith(fixture.tripId, itineraryId(8));
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("Confirmada");
    expect(container.querySelector('[role="dialog"] a[href="https://maps.app.goo.gl/example"]')).not.toBeNull();
    await click(container, "Editar actividad"); await field(container, "title", "Paseo nocturno"); await field(container, "time", "14:00"); await save(container);
    expect(update).toHaveBeenCalledWith(fixture.tripId, itineraryId(8), { title: "Paseo nocturno", scheduledAt: "2026-09-25T17:00:00.000Z" });
    expect(container.querySelectorAll(`[data-itinerary-post="${itineraryId(10)}"]`)).toHaveLength(1);
    expect(Array.from(container.querySelectorAll('[data-itinerary-kind="activity"] [data-itinerary-item]')).map((i) => i.getAttribute("data-itinerary-item"))).toEqual([itineraryId(9), itineraryId(8)]);
  });
  it("shows saved content even if reloading fails and retries only the GET", async () => {
    const { container, create, getItinerary } = await render();
    getItinerary.mockResolvedValueOnce({ ok: false, error: { kind: "network" } });
    await click(container, "Crear actividad"); await field(container, "title", "Guardada"); await field(container, "time", "10:30"); await save(container);
    expect(container.textContent).toContain("Guardada"); expect(container.textContent).toContain("No pudimos actualizar el itinerario");
    await click(container, "Actualizar itinerario");
    expect(create).toHaveBeenCalledOnce(); expect(getItinerary).toHaveBeenCalledTimes(3);
    expect(container.textContent).not.toContain("No pudimos actualizar el itinerario");
  });
  it.each(["not-found", "forbidden", "unauthorized", "network"])("handles %s while loading detail", async (kind) => {
    const { container, get } = await render(); get.mockResolvedValue({ ok: false, error: { kind } });
    await click(container, "Paseo por el centro");
    expect(container.querySelector('[role="dialog"] [role="alert"]')).not.toBeNull();
    expect(container.querySelector('[role="dialog"]')?.textContent).not.toContain("Editar actividad");
    if (kind === "network") { get.mockResolvedValue({ ok: true, value: itineraryFixture().activities[0] }); await click(container, "Reintentar"); expect(container.textContent).toContain("Editar actividad"); }
    if (kind === "unauthorized") expect(container.querySelector('[role="dialog"] a[href="/login"]')).not.toBeNull();
  });
  it("does not render unsafe stored Maps links as actionable URLs", async () => {
    const fixture = itineraryFixture() as TripItineraryResponse; fixture.activities[0].mapsUrl = "javascript:alert(1)";
    const { container } = await render(fixture); await click(container, "Paseo por el centro");
    expect(container.querySelector('[role="dialog"] a[href^="javascript:"]')).toBeNull();
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("Vínculo de Maps no válido");
  });
  it("ignores a detail response arriving after the modal closes", async () => {
    let resolve!: (value: unknown) => void;
    const { container, get } = await render(); get.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    await click(container, "Paseo por el centro"); await click(container, "Cerrar"); await click(container, "Visita al museo");
    await act(async () => resolve({ ok: true, value: itineraryFixture().activities[0] }));
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("Visita al museo");
    expect(container.querySelector('[role="dialog"]')?.textContent).not.toContain("Paseo por el centro");
  });
});
