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
    create: async () => ({ ok: false, error: { kind: "server" } }), update: async () => ({ ok: false, error: { kind: "server" } }), remove: async () => ({ ok: false, error: { kind: "server" } }) }}
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
    expect(selected(card(container, itineraryId(9)))).toBeUndefined();
    expect(card(container, itineraryId(9)).querySelector(".activity-participation-status")!.textContent).toBe("Sin responder");
    expect(card(container, itineraryId(9)).textContent).not.toContain("Modificado");
    expect(card(container).textContent).toContain("Tu participación");
    expect(get).toHaveBeenCalledTimes(2); expect(set).not.toHaveBeenCalled(); expect(getItinerary).toHaveBeenCalledOnce();
  });
  it.each(["going", "not_going"] as const)("shows persisted %s", async (status) => {
    const { container } = await render({ get: async (_tripId, id) => ({ ok: true, value: response(id, status) }) });
    expect(selected(card(container))).toBe({ going: "Voy", not_going: "No voy" }[status]);
  });
  it("shows a persisted pending answer as neutral text with no pressed or disabled button", async () => {
    const { container } = await render({ get: async (_tripId, id) => ({ ok: true, value: response(id, "pending") }) });
    expect(selected(card(container))).toBeUndefined();
    expect(card(container).querySelector(".activity-participation-status")!.textContent).toBe("Sin responder");
    const buttons = Array.from(card(container).querySelectorAll<HTMLButtonElement>("button[aria-pressed]"));
    expect(buttons.map((b) => b.textContent)).toEqual(["Voy", "No voy"]);
    expect(buttons.every((b) => !b.disabled && b.getAttribute("aria-pressed") === "false")).toBe(true);
  });
  it("has no manual 'Sin responder' control", async () => {
    const { container } = await render();
    expect(Array.from(container.querySelectorAll("button")).map((b) => b.textContent)).not.toContain("Sin responder");
  });
  it("changes between the two answers locally, never sending pending, and preserves the itinerary content", async () => {
    const { container, set, getItinerary, fixture } = await render();
    const beforePosts = Array.from(container.querySelectorAll("[data-itinerary-post]")).map((el) => el.outerHTML);
    const beforeExpenses = Array.from(container.querySelectorAll("[data-itinerary-expenses]")).map((el) => el.outerHTML);
    const order = Array.from(container.querySelectorAll("[data-itinerary-item]")).map((el) => el.getAttribute("data-itinerary-item"));
    for (const [label, status] of [["No voy", "not_going"], ["Voy", "going"]] as const) {
      await click(card(container), label); expect(selected(card(container))).toBe(label);
      expect(set).toHaveBeenLastCalledWith(fixture.tripId, itineraryId(8), status);
      expect(selected(card(container, itineraryId(9)))).toBeUndefined();
      expect(card(container).textContent).not.toContain("Confirmada");
    }
    expect(getItinerary).toHaveBeenCalledOnce();
    expect(set.mock.calls.every((call) => call[2] !== "pending")).toBe(true);
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
    await click(card(container), "No voy"); await click(card(container), "No voy");
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
    expect(card(container).querySelector(".activity-participation-status")!.textContent).toBe("Sin responder");
  });
  it("retries a failed read without reloading the itinerary", async () => {
    const read = vi.fn().mockResolvedValueOnce({ ok: false, error: { kind: "network" } }).mockResolvedValue({ ok: true, value: null });
    const { container, getItinerary } = await render({ get: read });
    expect(selected(card(container))).toBeUndefined(); expect(card(container).querySelector('[role="alert"]')).not.toBeNull();
    await click(card(container), "Reintentar"); expect(card(container).querySelector(".activity-participation-status")!.textContent).toBe("Sin responder"); expect(getItinerary).toHaveBeenCalledOnce();
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
    expect(card(container).querySelector(".activity-participation-status")!.textContent).toBe("Sin responder");
  });
  it("ignores a read that finishes after changing Trip", async () => {
    const pending = deferred<TripResult<ParticipationResponse | null>>();
    const { container } = await render({ get: async (tripId) => tripId === itineraryId(1) ? pending.promise : { ok: true, value: null } });
    await act(async () => container.querySelector<HTMLAnchorElement>('a[href*="000000000000000000000063"]')!.click());
    await act(async () => pending.resolve({ ok: true, value: response(itineraryId(8)) }));
    expect(card(container).querySelector(".activity-participation-status")!.textContent).toBe("Sin responder");
  });
  it("loads participation correctly under StrictMode", async () => {
    const { container } = await render({}, true);
    expect(selected(card(container))).toBe("Voy");
  });

  describe("decision required mark", () => {
    const withMark = (changedFields: ("scheduledAt" | "durationMinutes")[] = ["scheduledAt"]): ParticipationResponse => ({ ...response(itineraryId(9), "pending"),
      decisionRequired: { reason: "schedule_conflict", changedFields, changedAt: "2026-09-26T10:30:00.000Z" } });
    const markedGet = (fields?: ("scheduledAt" | "durationMinutes")[]) => async (_tripId: string, id: string) => ({ ok: true as const, value: id === itineraryId(9) ? withMark(fields) : null });
    const modificado = (scope: HTMLElement) => Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === "Modificado");
    it("shows Modificado only to the affected user, with neutral answers", async () => {
      const { container } = await render({ get: markedGet() });
      expect(modificado(card(container, itineraryId(9)))).toBeDefined(); expect(modificado(card(container, itineraryId(8)))).toBeUndefined();
      expect(selected(card(container, itineraryId(9)))).toBeUndefined();
      const buttons = Array.from(card(container, itineraryId(9)).querySelectorAll<HTMLButtonElement>("button[aria-pressed]"));
      expect(buttons.every((b) => !b.disabled)).toBe(true);
    });
    it("never shows Modificado for another user's participation (the read returns null)", async () => {
      const { container } = await render({ get: async () => ({ ok: true, value: null }) });
      expect(container.textContent).not.toContain("Modificado");
    });
    it.each([
      [["scheduledAt"], ["El horario de esta actividad cambió"]],
      [["durationMinutes"], ["La duración de esta actividad cambió"]],
      [["scheduledAt", "durationMinutes"], ["horario", "duración"]],
    ] as const)("explains the changed fields %j and toggling it is local only", async (fields, texts) => {
      const get = vi.fn(markedGet([...fields]));
      const { container, set } = await render({ get });
      const scope = card(container, itineraryId(9));
      const trigger = modificado(scope)!;
      const region = scope.querySelector<HTMLElement>('[role="region"]')!;
      expect(trigger.getAttribute("aria-expanded")).toBe("false"); expect(trigger.getAttribute("aria-controls")).toBe(region.id); expect(region.hidden).toBe(true);
      await act(async () => trigger.click());
      expect(trigger.getAttribute("aria-expanded")).toBe("true"); expect(region.hidden).toBe(false); expect(region.getAttribute("aria-live")).toBe("polite");
      for (const text of texts) expect(region.textContent).toContain(text);
      expect(region.textContent).toContain("Entra en conflicto con otro plan tuyo. Elegí de nuevo si vas o no vas.");
      expect(region.querySelector("time")!.getAttribute("datetime")).toBe("2026-09-26T10:30:00.000Z");
      await act(async () => trigger.click()); await act(async () => trigger.click());
      expect(region.hidden).toBe(false);
      expect(set).not.toHaveBeenCalled(); expect(get).toHaveBeenCalledTimes(2);
      expect(modificado(scope)).toBeDefined();
    });
    it("keeps the mark after reloading from the server", async () => {
      const get = vi.fn(markedGet());
      const first = await render({ get });
      await act(async () => modificado(card(first.container, itineraryId(9)))!.click());
      await act(async () => first.root.unmount());
      const second = await render({ get });
      expect(get.mock.calls.length).toBeGreaterThan(2); expect(modificado(card(second.container, itineraryId(9)))).toBeDefined();
    });
    it("keeps the mark after a failed write", async () => {
      const { container } = await render({ get: markedGet(), set: async () => ({ ok: false, error: { kind: "server" } }) });
      await click(card(container, itineraryId(9)), "Voy");
      expect(modificado(card(container, itineraryId(9)))).toBeDefined(); expect(selected(card(container, itineraryId(9)))).toBeUndefined();
    });
    it("clears the mark only after a saved answer", async () => {
      const { container } = await render({ get: markedGet() });
      await click(card(container, itineraryId(9)), "Voy");
      expect(modificado(card(container, itineraryId(9)))).toBeUndefined(); expect(selected(card(container, itineraryId(9)))).toBe("Voy");
    });
  });

  describe("conflict confirmation", () => {
    const confirmation = { confirmedConflicts: [
      { activityId: itineraryId(8), reason: "overlap", scheduledAt: "2026-09-25T12:00:00.123Z", durationMinutes: 60 },
      { activityId: itineraryId(77), reason: "same_start", scheduledAt: "2026-09-25T14:00:00.123Z", durationMinutes: null }],
    confirmedActivity: { scheduledAt: "2026-09-25T14:00:00.123Z", durationMinutes: null } } as const;
    const conflict = { ok: false as const, error: { kind: "participation-conflict" as const, confirmation: confirmation as never } };
    const conflictSet = (conflicts = 2) => Array.from({ length: conflicts }).reduce<ReturnType<typeof vi.fn>>((mock) => mock.mockResolvedValueOnce(conflict), vi.fn())
      .mockImplementation(async (tripId, id, status) => ({ ok: true, value: response(id, status, tripId) }));
    const titles = (container: HTMLElement) => Array.from(container.querySelectorAll("h2")).filter((h) => h.textContent === "Cambiar de plan");
    const nineBase = async (set = conflictSet()) => ({ ...(await render({ get: async () => ({ ok: true, value: null }), set })), set });
    it("lists every incompatible plan, keeping the current answer when cancelling", async () => {
      const { container, set } = await nineBase();
      await click(card(container, itineraryId(9)), "Voy");
      expect(titles(container)).toHaveLength(1);
      expect(titles(container)[0]!.closest(".participation-conflict-layer"), "stacking proxy: modal mounted in its own layer").not.toBeNull();
      const items = Array.from(container.querySelectorAll("ul.participation-conflict-list li"));
      expect(items).toHaveLength(2);
      expect(items[0]!.textContent).toContain("Paseo por el centro"); expect(items[0]!.textContent).toContain("Se superpone");
      expect(items[1]!.textContent).toContain("Otra actividad"); expect(items[1]!.textContent).toContain("Mismo horario");
      expect(container.textContent).not.toContain(itineraryId(77));
      expect(selected(card(container, itineraryId(9)))).toBeUndefined();
      await click(container, "Conservar mi participación actual");
      expect(titles(container)).toHaveLength(0); expect(set).toHaveBeenCalledTimes(1);
      expect(selected(card(container, itineraryId(9)))).toBeUndefined();
    });
    it("confirming resends the same snapshot, closes the modal and shows the new answer", async () => {
      const { container, set, fixture } = await nineBase(conflictSet(1));
      await click(card(container, itineraryId(9)), "Voy");
      await click(container, "Cambiar de plan");
      expect(set).toHaveBeenCalledTimes(2); expect(set).toHaveBeenLastCalledWith(fixture.tripId, itineraryId(9), "going", confirmation);
      expect(titles(container)).toHaveLength(0); expect(selected(card(container, itineraryId(9)))).toBe("Voy");
    });
    it("asks to review again when the snapshot changed, without writing", async () => {
      const set = vi.fn().mockResolvedValue(conflict);
      const { container } = await nineBase(set);
      await click(card(container, itineraryId(9)), "Voy"); await click(container, "Cambiar de plan");
      expect(set).toHaveBeenCalledTimes(2);
      expect(container.querySelector('[role="alert"]')!.textContent).toContain("Los datos cambiaron");
      expect(selected(card(container, itineraryId(9)))).toBeUndefined();
    });
    it("closes the modal without writing when navigating to another Trip", async () => {
      const { container, set } = await nineBase();
      await click(card(container, itineraryId(9)), "Voy"); expect(titles(container)).toHaveLength(1);
      await act(async () => container.querySelector<HTMLAnchorElement>('a[href*="000000000000000000000063"]')!.click());
      expect(titles(container)).toHaveLength(0); expect(set).toHaveBeenCalledTimes(1);
    });
    it("works from the detail dialog with a single modal and updates the card", async () => {
      const { container, set } = await nineBase();
      await click(card(container, itineraryId(9)), "Visita al museo");
      const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
      await click(dialog, "Voy");
      expect(titles(container)).toHaveLength(1);
      await click(container, "Conservar mi participación actual");
      expect(set).toHaveBeenCalledTimes(1); expect(titles(container)).toHaveLength(0);
      await click(dialog, "Voy"); await click(container, "Cambiar de plan");
      expect(titles(container)).toHaveLength(0); expect(selected(dialog)).toBe("Voy"); expect(selected(card(container, itineraryId(9)))).toBe("Voy");
    });
    it("closes the modal without writing when navigating away from the detail", async () => {
      const { container, set } = await nineBase();
      await click(card(container, itineraryId(9)), "Visita al museo");
      await click(container.querySelector<HTMLElement>('[role="dialog"]')!, "Voy");
      await act(async () => container.querySelector<HTMLAnchorElement>('a[href*="000000000000000000000063"]')!.click());
      expect(titles(container)).toHaveLength(0); expect(set).toHaveBeenCalledTimes(1);
    });
  });
});
