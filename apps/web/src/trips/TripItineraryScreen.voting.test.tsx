// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { itineraryFixture, itineraryId } from "./itinerary-test-fixture.js";
import type { TripItineraryApi, TripItineraryResponse } from "./trip-itinerary-api.js";
import type { ActivityResponse, TripActivityApi } from "./trip-activity-api.js";
import type { ActivityVoteResponse, TripVoteApi, VoteResponse } from "./trip-vote-api.js";
import type { TripResult } from "./trip-management-api.js";
import { TripItineraryScreen } from "./TripItineraryScreen.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
const vote = (activityId = itineraryId(8), value: VoteResponse["value"] = "up", tripId = itineraryId(1)): VoteResponse => ({
  id: itineraryId(50), tripId, activityId, userId: itineraryId(20), value, createdAt: "2026-09-25T12:00:00.000Z",
});
const fixture = (): TripItineraryResponse => {
  const value = itineraryFixture() as TripItineraryResponse;
  value.votingEnabled = true; value.activities.forEach((a) => { a.status = "proposed"; }); return value;
};
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
type Options = { votes?: Partial<TripVoteApi>; value?: TripItineraryResponse; strict?: boolean;
  getItinerary?: TripItineraryApi["get"]; detail?: (activity: ActivityResponse) => ActivityResponse;
  update?: TripActivityApi["update"] };
async function render(options: Options = {}) {
  const value = options.value ?? fixture();
  const getItinerary = vi.fn(options.getItinerary ?? (async (tripId: string) => ({ ok: true as const, value: { ...structuredClone(value), tripId } })));
  const get = vi.fn<TripVoteApi["get"]>(async (_tripId, id) => ({ ok: true, value: { vote: null, activityStatus: value.activities.find((a) => a.id === id)!.status } }));
  const set = vi.fn<TripVoteApi["set"]>(async (tripId, id, next) => ({ ok: true, value: { vote: vote(id, next, tripId), activityStatus: "voting" } }));
  const votes = { get, set, ...options.votes };
  const getActivity = vi.fn(async (_tripId: string, id: string) => ({ ok: true as const,
    value: options.detail ? options.detail(value.activities.find((a) => a.id === id)!) : value.activities.find((a) => a.id === id)! }));
  const update = vi.fn<TripActivityApi["update"]>(options.update ?? (async () => ({ ok: false, error: { kind: "server" } })));
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  const tree = (itinerary: TripItineraryApi) => <MemoryRouter initialEntries={[`/trips/${value.tripId}/itinerary`]}>
    <Link to={`/trips/${itineraryId(99)}/itinerary`}>Otro viaje</Link>
    <Routes><Route path="/trips/:tripId/itinerary" element={<TripItineraryScreen itinerary={itinerary} votes={votes}
      activities={{ get: getActivity, create: async () => ({ ok: false, error: { kind: "server" } }),
        update }}
      participations={{ get: async () => ({ ok: true, value: null }), set: async (tripId, activityId, status) => ({ ok: true,
        value: { id: itineraryId(70), tripId, activityId, userId: itineraryId(20), status, updatedAt: "2026-09-25T12:00:00.000Z" } }) }}
      timeZone="UTC" />} /></Routes>
  </MemoryRouter>;
  await act(async () => root.render(options.strict ? <StrictMode>{tree({ get: getItinerary })}</StrictMode> : tree({ get: getItinerary })));
  const refresh = async (next: TripItineraryResponse) => act(async () => root.render(tree({ get: async () => ({ ok: true, value: next }) })));
  return { container, root, value, get, set, getItinerary, getActivity, update, refresh };
}
const card = (container: HTMLElement, id = itineraryId(8)) => container.querySelector<HTMLElement>(`[data-itinerary-item="${id}"]`)!;
const voting = (scope: HTMLElement) => {
  const fieldset = scope.querySelector<HTMLElement>('fieldset[aria-label^="Tu voto"]');
  expect(fieldset, "own vote controls").not.toBeNull(); return fieldset!;
};
const button = (scope: HTMLElement, label: string) => {
  const element = Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === label || b.getAttribute("aria-label") === label);
  expect(element, label).toBeDefined(); return element!;
};
const click = async (scope: HTMLElement, label: string) => act(async () => button(scope, label).click());
const selected = (scope: HTMLElement) => voting(scope)?.querySelector('[aria-pressed="true"]')?.textContent;

describe("activity voting in itinerary and detail", () => {
  it("loads absence without creating votes and keeps participation separate", async () => {
    const { container, get, set } = await render();
    expect(voting(card(container))?.textContent).toContain("Todavía no votaste");
    expect(card(container).textContent).toContain("Propuesta");
    expect(card(container).querySelector('fieldset[aria-label^="Tu participación"]')).not.toBeNull();
    expect(get).toHaveBeenCalledTimes(2); expect(set).not.toHaveBeenCalled();
  });
  it.each(["up", "down"] as const)("shows the persisted %s vote", async (value) => {
    const { container } = await render({ votes: { get: async (_tripId, id) => ({ ok: true, value: { vote: vote(id, value), activityStatus: "voting" } }) } });
    expect(selected(card(container))).toBe(value === "up" ? "A favor" : "En contra");
    expect(card(container).textContent).toContain("En votación");
  });
  it.each(["A favor", "En contra"])("emits %s then replaces the own vote without reloading or changing itinerary content", async (label) => {
    const { container, set, getItinerary } = await render();
    const beforePosts = Array.from(container.querySelectorAll("[data-itinerary-post]")).map((el) => el.outerHTML);
    const beforeExpenses = Array.from(container.querySelectorAll("[data-itinerary-expenses]")).map((el) => el.outerHTML);
    const beforeOrder = Array.from(container.querySelectorAll("[data-itinerary-item]")).map((el) => el.getAttribute("data-itinerary-item"));
    await click(voting(card(container)), label); expect(selected(card(container))).toBe(label);
    expect(card(container).textContent).toContain("En votación");
    expect(set).toHaveBeenLastCalledWith(itineraryId(1), itineraryId(8), label === "A favor" ? "up" : "down");
    const opposite = label === "A favor" ? "En contra" : "A favor";
    await click(voting(card(container)), opposite); expect(selected(card(container))).toBe(opposite);
    expect(selected(card(container, itineraryId(9)))).toBeUndefined(); expect(getItinerary).toHaveBeenCalledOnce();
    expect(Array.from(container.querySelectorAll("[data-itinerary-post]")).map((el) => el.outerHTML)).toEqual(beforePosts);
    expect(Array.from(container.querySelectorAll("[data-itinerary-expenses]")).map((el) => el.outerHTML)).toEqual(beforeExpenses);
    expect(Array.from(container.querySelectorAll("[data-itinerary-item]")).map((el) => el.getAttribute("data-itinerary-item"))).toEqual(beforeOrder);
    expect(card(container).querySelector('fieldset[aria-label^="Tu participación"] [aria-pressed="true"]')?.textContent).toBe("Sin responder");
  });
  it("shares a vote and status with detail and preserves them after reopening", async () => {
    const { container, get } = await render();
    await click(card(container), "Paseo por el centro");
    let dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    await click(voting(dialog), "A favor");
    expect(dialog.textContent).toContain("En votación"); expect(selected(card(container))).toBe("A favor");
    await click(dialog, "Cerrar"); await click(card(container), "Paseo por el centro");
    dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain("En votación"); expect(selected(dialog)).toBe("A favor");
    expect(get).toHaveBeenCalledTimes(2);
  });
  it.each(["voting", "confirmed"] as const)("preserves the %s status resolved by a vote request when the earlier post-edit itinerary refresh finishes later", async (activityStatus) => {
    const value = fixture();
    const pending = deferred<TripResult<TripItineraryResponse>>();
    const write = vi.fn<TripVoteApi["set"]>(async (tripId, id, next) => activityStatus === "confirmed"
      ? { ok: false, error: { kind: "voting-closed" } }
      : { ok: true, value: { vote: vote(id, next, tripId), activityStatus } });
    const { container, getItinerary, get, set, update } = await render({ value,
      votes: { set: write },
      update: async (_tripId, id, changes) => {
        const activity = value.activities.find((a) => a.id === id)!;
        Object.assign(activity, changes); return { ok: true, value: { ...activity } };
      },
    });
    getItinerary.mockReturnValueOnce(pending.promise);
    await click(card(container), "Paseo por el centro");
    await click(container.querySelector<HTMLElement>('[role="dialog"]')!, "Editar actividad");
    const title = container.querySelector<HTMLInputElement>('[name="title"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, "Paseo editado");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(update).toHaveBeenCalledOnce(); expect(getItinerary).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Actualizando itinerario");
    const earlierSnapshot = structuredClone(value);
    earlierSnapshot.activities[1].description = "Descripción actualizada desde el itinerario";
    await click(voting(card(container)), "A favor");
    const statusLabel = activityStatus === "voting" ? "En votación" : "Confirmada";
    expect(card(container).textContent).toContain(statusLabel);
    await act(async () => pending.resolve({ ok: true, value: earlierSnapshot }));
    expect(card(container).textContent).toContain(statusLabel);
    expect(card(container).textContent).not.toContain("Propuesta");
    if (activityStatus === "confirmed") expect(voting(card(container)).querySelectorAll('[aria-pressed]')).toHaveLength(0);
    else expect(selected(card(container))).toBe("A favor");
    expect(card(container).textContent).toContain("Paseo editado");
    expect(card(container, itineraryId(9)).textContent).toContain("Descripción actualizada desde el itinerario");
    expect(get).toHaveBeenCalledTimes(2); expect(set).not.toHaveBeenCalled(); expect(write).toHaveBeenCalledOnce(); expect(getItinerary).toHaveBeenCalledTimes(2);
    await click(card(container), "Paseo editado");
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain(statusLabel);
    if (activityStatus === "confirmed") expect(voting(dialog).querySelectorAll('[aria-pressed]')).toHaveLength(0);
    else expect(selected(dialog)).toBe("A favor");
  });
  it("hides voting and performs no vote requests when the Trip disables it", async () => {
    const value = fixture(); value.votingEnabled = false;
    const { container, get, set } = await render({ value });
    expect(container.querySelector('fieldset[aria-label^="Tu voto"]')).toBeNull();
    expect(get).not.toHaveBeenCalled(); expect(set).not.toHaveBeenCalled();
    await click(card(container), "Paseo por el centro");
    expect(container.querySelector('[role="dialog"] fieldset[aria-label^="Tu voto"]')).toBeNull();
  });
  it("shows confirmed activity votes as read-only and preserves attendance actions", async () => {
    const value = fixture(); value.activities[0].status = "confirmed";
    const { container, set } = await render({ value, votes: { get: async (_tripId, id) => ({ ok: true,
      value: { vote: vote(id), activityStatus: "confirmed" } }) } });
    expect(voting(card(container))?.textContent).toContain("A favor");
    expect(voting(card(container))?.querySelectorAll('[aria-pressed]')).toHaveLength(0);
    expect(card(container).querySelector('fieldset[aria-label^="Tu participación"] button:not(:disabled)')).not.toBeNull();
    await click(card(container), "Paseo por el centro");
    expect(voting(container.querySelector<HTMLElement>('[role="dialog"]')!)?.querySelectorAll('[aria-pressed]')).toHaveLength(0);
    expect(set).not.toHaveBeenCalled();
  });
  it("closes agenda and detail actions if detail reports a newer confirmed status", async () => {
    const { container, set } = await render({ detail: (a) => ({ ...a, status: "confirmed" }) });
    expect(button(voting(card(container)), "A favor").disabled).toBe(false);
    await click(card(container), "Paseo por el centro");
    expect(card(container).textContent).toContain("Confirmada");
    expect(voting(card(container))?.querySelectorAll('[aria-pressed]')).toHaveLength(0);
    expect(voting(container.querySelector<HTMLElement>('[role="dialog"]')!)?.querySelectorAll('[aria-pressed]')).toHaveLength(0);
    expect(set).not.toHaveBeenCalled();
  });
  it("keeps the prior vote and blocks duplicate writes only for the pending activity", async () => {
    const pending = deferred<TripResult<ActivityVoteResponse & { vote: VoteResponse }>>();
    const write = vi.fn<TripVoteApi["set"]>().mockReturnValueOnce(pending.promise).mockImplementation(async (tripId, id, value) => ({ ok: true, value: { vote: vote(id, value, tripId), activityStatus: "voting" } }));
    const { container } = await render({ votes: { set: write } });
    await click(voting(card(container)), "A favor"); await click(voting(card(container)), "En contra");
    expect(selected(card(container))).toBeUndefined();
    expect(voting(card(container)).querySelectorAll('button[aria-pressed]:not(:disabled)')).toHaveLength(0);
    expect(voting(card(container)).textContent).toContain("Guardando tu voto");
    await click(voting(card(container, itineraryId(9))), "En contra"); expect(write).toHaveBeenCalledTimes(2);
    await act(async () => pending.resolve({ ok: true, value: { vote: vote(), activityStatus: "voting" } }));
    expect(selected(card(container))).toBe("A favor");
    await click(voting(card(container)), "A favor"); expect(write).toHaveBeenCalledTimes(2);
  });
  it("does not treat a pending read as an absent vote", async () => {
    const pending = deferred<TripResult<ActivityVoteResponse>>();
    const { container, set } = await render({ votes: { get: () => pending.promise } });
    expect(voting(card(container))?.textContent).toContain("Cargando tu voto");
    expect(voting(card(container))?.textContent).not.toContain("Todavía no votaste");
    expect(voting(card(container))?.querySelectorAll('[aria-pressed]')).toHaveLength(0); expect(set).not.toHaveBeenCalled();
    await act(async () => pending.resolve({ ok: true, value: { vote: null, activityStatus: "proposed" } }));
    expect(voting(card(container)).textContent).toContain("Todavía no votaste");
  });
  it("retries a failed read without reloading the itinerary", async () => {
    const read = vi.fn<TripVoteApi["get"]>().mockResolvedValueOnce({ ok: false, error: { kind: "network" } }).mockResolvedValue({ ok: true, value: { vote: null, activityStatus: "proposed" } });
    const { container, getItinerary } = await render({ votes: { get: read } });
    expect(voting(card(container))?.querySelector('[role="alert"]')).not.toBeNull();
    await click(voting(card(container)), "Reintentar");
    expect(voting(card(container)).textContent).toContain("Todavía no votaste"); expect(getItinerary).toHaveBeenCalledOnce();
  });
  it.each(["network", "server", "validation"] as const)("preserves the vote and status after a %s write failure", async (kind) => {
    const { container } = await render({ votes: {
      get: async (_tripId, id) => ({ ok: true, value: { vote: vote(id), activityStatus: "voting" } }),
      set: async () => ({ ok: false, error: { kind } }),
    } });
    await click(voting(card(container)), "En contra");
    expect(selected(card(container))).toBe("A favor"); expect(card(container).textContent).toContain("En votación");
    expect(voting(card(container)).querySelector('[role="alert"]')).not.toBeNull();
  });
  it("retries a failed write explicitly", async () => {
    const write = vi.fn<TripVoteApi["set"]>().mockResolvedValueOnce({ ok: false, error: { kind: "network" } })
      .mockResolvedValue({ ok: true, value: { vote: vote(), activityStatus: "voting" } });
    const { container } = await render({ votes: { set: write } });
    await click(voting(card(container)), "A favor"); await click(voting(card(container)), "Reintentar");
    expect(selected(card(container))).toBe("A favor"); expect(write).toHaveBeenCalledTimes(2);
  });
  it.each(["not-found", "forbidden", "unauthorized"] as const)("makes voting unavailable after a %s response", async (kind) => {
    const { container } = await render({ votes: { set: async () => ({ ok: false, error: { kind } }) } });
    await click(voting(card(container)), "A favor");
    expect(voting(card(container)).querySelector('[role="alert"]')).not.toBeNull();
    expect(voting(card(container)).querySelectorAll('button[aria-pressed]:not(:disabled)')).toHaveLength(0);
    expect(voting(card(container)).textContent).not.toContain("Reintentar");
    if (kind === "unauthorized") expect(voting(card(container)).querySelector('a[href="/login"]')).not.toBeNull();
  });
  it("handles rejected operations without changing the vote", async () => {
    const read = vi.fn<TripVoteApi["get"]>().mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValue({ ok: true, value: { vote: null, activityStatus: "proposed" } });
    const { container } = await render({ votes: { get: read, set: async () => { throw new Error("Offline"); } } });
    await click(voting(card(container)), "Reintentar"); await click(voting(card(container)), "A favor");
    expect(selected(card(container))).toBeUndefined(); expect(card(container).textContent).toContain("Propuesta");
    expect(voting(card(container)).querySelector('[role="alert"]')).not.toBeNull();
  });
  it("closes actions and reconciles a voting-closed conflict without retrying the write", async () => {
    const { container, set } = await render({ votes: { set: async () => ({ ok: false, error: { kind: "voting-closed" } }) } });
    await click(voting(card(container)), "A favor");
    expect(card(container).textContent).toContain("Confirmada");
    expect(voting(card(container)).querySelectorAll('[aria-pressed]')).toHaveLength(0);
    expect(voting(card(container)).textContent).not.toContain("Reintentar"); expect(set).not.toHaveBeenCalled();
  });
  it("hides every voting section on voting-disabled and refreshes the Trip configuration", async () => {
    let reads = 0;
    const { container, getItinerary } = await render({ getItinerary: async () => ({ ok: true, value: { ...fixture(), votingEnabled: ++reads === 1 } }),
      votes: { set: async () => ({ ok: false, error: { kind: "voting-disabled" } }) } });
    await click(voting(card(container)), "A favor");
    expect(container.querySelector('fieldset[aria-label^="Tu voto"]')).toBeNull();
    expect(getItinerary).toHaveBeenCalledTimes(2);
  });
  it.each(["read", "write"] as const)("ignores a %s response after changing Trip", async (operation) => {
    const pendingRead = deferred<TripResult<ActivityVoteResponse>>();
    const pendingWrite = deferred<TripResult<ActivityVoteResponse & { vote: VoteResponse }>>();
    const { container } = await render({ votes: {
      get: async (tripId) => tripId === itineraryId(1) && operation === "read" ? pendingRead.promise : { ok: true, value: { vote: null, activityStatus: "proposed" } },
      set: () => pendingWrite.promise,
    } });
    if (operation === "write") await click(voting(card(container)), "A favor");
    await act(async () => container.querySelector<HTMLAnchorElement>('a[href*="000000000000000000000063"]')!.click());
    await act(async () => {
      pendingRead.resolve({ ok: true, value: { vote: vote(), activityStatus: "voting" } });
      pendingWrite.resolve({ ok: true, value: { vote: vote(), activityStatus: "voting" } });
    });
    expect(selected(card(container))).toBeUndefined(); expect(card(container).textContent).toContain("Propuesta");
  });
  it("ignores an in-flight vote when configuration disables voting", async () => {
    const pending = deferred<TripResult<ActivityVoteResponse & { vote: VoteResponse }>>();
    const { container, refresh } = await render({ votes: { set: () => pending.promise } });
    await click(voting(card(container)), "A favor");
    await refresh({ ...fixture(), votingEnabled: false });
    await act(async () => pending.resolve({ ok: true, value: { vote: vote(), activityStatus: "voting" } }));
    expect(container.querySelector('fieldset[aria-label^="Tu voto"]')).toBeNull(); expect(card(container).textContent).toContain("Propuesta");
  });
  it("loads correctly under StrictMode", async () => {
    const { container } = await render({ strict: true });
    expect(voting(card(container))?.textContent).toContain("Todavía no votaste");
  });
});
