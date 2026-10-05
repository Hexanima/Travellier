// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { itineraryFixture, itineraryId } from "./itinerary-test-fixture.js";
import type { TripItineraryResponse } from "./trip-itinerary-api.js";
import type { ParticipationResponse, TripParticipationApi } from "./trip-participation-api.js";
import type { TripResult } from "./trip-management-api.js";
import { TripItineraryScreen } from "./TripItineraryScreen.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
const response = (activityId: string, status: ParticipationResponse["status"] = "going", tripId = itineraryId(1)): ParticipationResponse => ({
  id: itineraryId(50), tripId, activityId, userId: itineraryId(20), status, updatedAt: "2026-09-25T12:00:00.000Z",
});
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
async function render(overrides: Partial<TripParticipationApi> = {}, strict = false) {
  const fixture = itineraryFixture() as TripItineraryResponse;
  const getItinerary = vi.fn().mockImplementation(async (tripId: string) => ({ ok: true, value: { ...structuredClone(fixture), tripId } }));
  const get = vi.fn().mockImplementation(async (_tripId, activityId) => ({ ok: true, value: activityId === itineraryId(8) ? response(activityId) : null }));
  const set = vi.fn().mockImplementation(async (tripId, activityId, status) => ({ ok: true, value: response(activityId, status, tripId) }));
  const getActivity = vi.fn().mockImplementation(async (_tripId, activityId) => ({ ok: true, value: fixture.activities.find((a) => a.id === activityId) }));
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  const screen = <TripItineraryScreen itinerary={{ get: getItinerary }} activities={{ get: getActivity,
    create: async () => ({ ok: false, error: { kind: "server" } }), update: async () => ({ ok: false, error: { kind: "server" } }) }}
    participations={{ get, set, ...overrides }} timeZone="UTC" />;
  const content = <MemoryRouter initialEntries={[`/trips/${fixture.tripId}/itinerary`]}>
    <Link to={`/trips/${itineraryId(99)}/itinerary`}>Otro viaje</Link>
    <Routes><Route path="/trips/:tripId/itinerary" element={screen} /></Routes>
  </MemoryRouter>;
  await act(async () => root.render(strict ? <StrictMode>{content}</StrictMode> : content));
  return { container, root, fixture, get, set, getActivity, getItinerary };
}
const card = (container: HTMLElement, id = itineraryId(8)) => container.querySelector<HTMLElement>(`[data-itinerary-item="${id}"]`)!;
const control = (scope: HTMLElement, label: string) => {
  const element = Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === label || button.getAttribute("aria-label") === label);
  expect(element, label).toBeDefined(); return element!;
};
const click = async (scope: HTMLElement, label: string) => act(async () => control(scope, label).click());
const selected = (scope: HTMLElement) => scope.querySelector('[aria-pressed="true"]')?.textContent;

describe("individual itinerary participation", () => {
  it("shows persisted states and absence, without creating a participation", async () => {
    const { container, get, set, getItinerary } = await render();
    expect(selected(card(container))).toBe("Voy");
    expect(selected(card(container, itineraryId(9)))).toBe("Sin responder");
    expect(card(container).textContent).toContain("Tu participación");
    expect(get).toHaveBeenCalledTimes(2); expect(set).not.toHaveBeenCalled(); expect(getItinerary).toHaveBeenCalledOnce();
  });
  it.each(["going", "not_going", "pending"] as const)("shows persisted %s", async (status) => {
    const { container } = await render({ get: async (_tripId, id) => ({ ok: true, value: response(id, status) }) });
    expect(selected(card(container))).toBe({ going: "Voy", not_going: "No voy", pending: "Sin responder" }[status]);
  });
  it("changes all three states locally and preserves itinerary content and global activity status", async () => {
    const { container, set, getItinerary, fixture } = await render();
    const beforePosts = Array.from(container.querySelectorAll("[data-itinerary-post]")).map((el) => el.outerHTML);
    const beforeExpenses = Array.from(container.querySelectorAll("[data-itinerary-expenses]")).map((el) => el.outerHTML);
    const order = Array.from(container.querySelectorAll("[data-itinerary-item]")).map((el) => el.getAttribute("data-itinerary-item"));
    for (const [label, status] of [["No voy", "not_going"], ["Sin responder", "pending"], ["Voy", "going"]] as const) {
      await click(card(container), label); expect(selected(card(container))).toBe(label);
      expect(set).toHaveBeenLastCalledWith(fixture.tripId, itineraryId(8), status);
      expect(selected(card(container, itineraryId(9)))).toBe("Sin responder");
      expect(card(container).textContent).toContain("Confirmada");
    }
    expect(getItinerary).toHaveBeenCalledOnce();
    expect(Array.from(container.querySelectorAll("[data-itinerary-post]")).map((el) => el.outerHTML)).toEqual(beforePosts);
    expect(Array.from(container.querySelectorAll("[data-itinerary-expenses]")).map((el) => el.outerHTML)).toEqual(beforeExpenses);
    expect(Array.from(container.querySelectorAll("[data-itinerary-item]")).map((el) => el.getAttribute("data-itinerary-item"))).toEqual(order);
  });
  it("shares state with detail and reopening does not reload participation", async () => {
    const { container, get, getItinerary } = await render();
    await click(card(container), "Paseo por el centro");
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(selected(dialog)).toBe("Voy"); await click(dialog, "No voy");
    expect(selected(dialog)).toBe("No voy"); expect(selected(card(container))).toBe("No voy");
    await click(dialog, "Cerrar"); await click(card(container), "Paseo por el centro");
    expect(selected(container.querySelector<HTMLElement>('[role="dialog"]')!)).toBe("No voy");
    expect(get).toHaveBeenCalledTimes(2); expect(getItinerary).toHaveBeenCalledOnce();
  });
  it("blocks duplicate writes only for the pending activity and keeps the previous selection", async () => {
    const pending = deferred<TripResult<ParticipationResponse>>();
    const write = vi.fn().mockReturnValueOnce(pending.promise).mockImplementation(async (tripId, id, status) => ({ ok: true, value: response(id, status, tripId) }));
    const { container } = await render({ set: write });
    await click(card(container), "No voy"); await click(card(container), "Sin responder");
    expect(selected(card(container))).toBe("Voy");
    expect(Array.from(card(container).querySelectorAll<HTMLButtonElement>('[aria-pressed]')).every((button) => button.disabled)).toBe(true);
    await click(card(container, itineraryId(9)), "Voy");
    expect(selected(card(container, itineraryId(9)))).toBe("Voy"); expect(write).toHaveBeenCalledTimes(2);
    await act(async () => pending.resolve({ ok: true, value: response(itineraryId(8), "not_going") }));
    expect(selected(card(container))).toBe("No voy");
  });
  it("does not mistake an in-flight read for an unanswered state", async () => {
    const pending = deferred<TripResult<ParticipationResponse | null>>();
    const { container, set } = await render({ get: () => pending.promise });
    expect(selected(card(container))).toBeUndefined();
    expect(card(container).textContent).toContain("Cargando tu participación"); expect(set).not.toHaveBeenCalled();
    await act(async () => pending.resolve({ ok: true, value: null }));
    expect(selected(card(container))).toBe("Sin responder");
  });
  it("retries a failed read without reloading the itinerary", async () => {
    const read = vi.fn().mockResolvedValueOnce({ ok: false, error: { kind: "network" } }).mockResolvedValue({ ok: true, value: null });
    const { container, getItinerary } = await render({ get: read });
    expect(selected(card(container))).toBeUndefined(); expect(card(container).querySelector('[role="alert"]')).not.toBeNull();
    await click(card(container), "Reintentar"); expect(selected(card(container))).toBe("Sin responder"); expect(getItinerary).toHaveBeenCalledOnce();
  });
  it.each(["network", "server", "validation"] as const)("retains the prior state after a %s write failure", async (kind) => {
    const write = vi.fn().mockResolvedValueOnce({ ok: false, error: { kind } }).mockImplementation(async (tripId, id, status) => ({ ok: true, value: response(id, status, tripId) }));
    const { container, getItinerary } = await render({ set: write });
    await click(card(container), "No voy"); expect(selected(card(container))).toBe("Voy");
    expect(card(container).querySelector('[role="alert"]')).not.toBeNull();
    await click(card(container), "No voy"); expect(selected(card(container))).toBe("No voy"); expect(getItinerary).toHaveBeenCalledOnce();
  });
  it("retries the failed write explicitly", async () => {
    const write = vi.fn().mockResolvedValueOnce({ ok: false, error: { kind: "network" } }).mockResolvedValue({ ok: true, value: response(itineraryId(8), "not_going") });
    const { container } = await render({ set: write });
    await click(card(container), "No voy"); await click(card(container), "Reintentar");
    expect(selected(card(container))).toBe("No voy"); expect(write).toHaveBeenCalledTimes(2);
  });
  it.each(["not-found", "forbidden", "unauthorized"] as const)("shows an unavailable participation for %s", async (kind) => {
    const { container } = await render({ get: async () => ({ ok: false, error: { kind } }) });
    expect(card(container).querySelector('[role="alert"]')).not.toBeNull();
    expect(card(container).querySelectorAll('[aria-pressed]')).toHaveLength(0);
    expect(card(container).textContent).not.toContain("Reintentar");
    if (kind === "unauthorized") expect(card(container).querySelector('a[href="/login"]')).not.toBeNull();
  });
  it.each(["not-found", "forbidden", "unauthorized"] as const)("disables unavailable controls after a %s write", async (kind) => {
    const { container } = await render({ set: async () => ({ ok: false, error: { kind } }) });
    await click(card(container), "No voy");
    expect(card(container).querySelector('[role="alert"]')).not.toBeNull();
    expect(card(container).querySelectorAll('button[aria-pressed]:not(:disabled)')).toHaveLength(0);
  });
  it("catches rejected operations and preserves the previous state", async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValue({ ok: true, value: response(itineraryId(8)) });
    const { container } = await render({ get: read, set: async () => { throw new Error("Offline"); } });
    await click(card(container), "Reintentar"); await click(card(container), "No voy");
    expect(selected(card(container))).toBe("Voy"); expect(card(container).querySelector('[role="alert"]')).not.toBeNull();
  });
  it("ignores a write that finishes after changing Trip", async () => {
    const pending = deferred<TripResult<ParticipationResponse>>();
    const { container } = await render({ get: async () => ({ ok: true, value: null }), set: () => pending.promise });
    await click(card(container), "Voy");
    await act(async () => container.querySelector<HTMLAnchorElement>('a[href*="000000000000000000000063"]')!.click());
    await act(async () => pending.resolve({ ok: true, value: response(itineraryId(8)) }));
    expect(selected(card(container))).toBe("Sin responder");
  });
  it("ignores a read that finishes after changing Trip", async () => {
    const pending = deferred<TripResult<ParticipationResponse | null>>();
    const { container } = await render({ get: async (tripId) => tripId === itineraryId(1) ? pending.promise : { ok: true, value: null } });
    await act(async () => container.querySelector<HTMLAnchorElement>('a[href*="000000000000000000000063"]')!.click());
    await act(async () => pending.resolve({ ok: true, value: response(itineraryId(8)) }));
    expect(selected(card(container))).toBe("Sin responder");
  });
  it("loads participation correctly under StrictMode", async () => {
    const { container } = await render({}, true);
    expect(selected(card(container))).toBe("Voy");
  });
});
