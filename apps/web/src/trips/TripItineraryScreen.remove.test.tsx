// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { itineraryFixture, itineraryId, linkPost } from "./itinerary-test-fixture.js";
import type { TripItineraryResponse } from "./trip-itinerary-api.js";
import type { ParticipationResponse, TripParticipationApi } from "./trip-participation-api.js";
import type { TripResult } from "./trip-management-api.js";
import type { TripActivityApi } from "./trip-activity-api.js";
import { TripItineraryScreen } from "./TripItineraryScreen.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); vi.restoreAllMocks(); });

const A = itineraryId(8), B = itineraryId(9), ROOT = itineraryId(20), CHILD = itineraryId(21);
const response = (activityId: string, status: ParticipationResponse["status"] = "going", tripId = itineraryId(1)): ParticipationResponse => ({
  id: itineraryId(50), tripId, activityId, userId: itineraryId(20), status, updatedAt: "2026-09-25T12:00:00.000Z" });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
const ok = { ok: true as const, value: undefined };
const fail = (kind: string): TripResult<void> => ({ ok: false, error: { kind } as never });
const conflictFailure = { ok: false, error: { kind: "participation-conflict", confirmation: { confirmedConflicts: [{ activityId: B, reason: "overlap",
  scheduledAt: "2026-09-25T14:00:00.123Z", durationMinutes: 60 }], confirmedActivity: { scheduledAt: "2026-09-25T12:00:00.123Z", durationMinutes: null } } } } as TripResult<never>;

/** Before: a chain (root -> child) hangs from activity A. After: A is gone and the chain is independent, as the server returns it. */
function fixtures() {
  const before = itineraryFixture() as TripItineraryResponse;
  const make = (id: number, hour: number, description: string) => ({ ...structuredClone(before.posts[0]!), id: itineraryId(id), description,
    createdAt: `2026-09-25T${hour}:00:00.123Z`, expense: null });
  const chain = (linked: boolean) => [
    linkPost(make(20, 13, "Raíz del recuerdo"), linked ? { activityId: A } : {}),
    linkPost(make(21, 14, "Hija del recuerdo"), { parentPostId: ROOT, rootPostId: ROOT, rootActivityId: linked ? A : null }),
  ];
  before.posts = [...before.posts, ...chain(true)];
  before.activities = before.activities.map((a) => a.id === A ? { ...a, postIds: [ROOT, CHILD] } : a);
  const after = structuredClone(before);
  after.activities = after.activities.filter((a) => a.id !== A);
  after.posts = [...before.posts.filter((p) => p.id !== ROOT && p.id !== CHILD), ...chain(false)];
  return { before, after };
}

type Options = { remove?: TripActivityApi["remove"]; participations?: Partial<TripParticipationApi>; refresh?: unknown };
async function render(options: Options = {}) {
  const { before, after } = fixtures();
  const getItinerary = vi.fn().mockImplementation(async (tripId: string) => getItinerary.mock.calls.length > 1
    ? (options.refresh ?? { ok: true, value: { ...structuredClone(after), tripId } }) : { ok: true, value: { ...structuredClone(before), tripId } });
  const get = vi.fn().mockImplementation(async (_t: string, id: string) => ({ ok: true, value: id === A ? response(id) : null }));
  const set = vi.fn().mockImplementation(async (t: string, id: string, status: ParticipationResponse["status"]) => ({ ok: true, value: response(id, status, t) }));
  const getActivity = vi.fn().mockImplementation(async (_t: string, id: string) => ({ ok: true, value: before.activities.find((a) => a.id === id) }));
  const remove = vi.fn(options.remove ?? (async () => ok));
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={[`/trips/${before.tripId}/itinerary`]}>
    <Routes><Route path="/trips/:tripId/itinerary" element={<TripItineraryScreen itinerary={{ get: getItinerary }}
      activities={{ get: getActivity, remove, create: async () => fail("server") as never, update: async () => fail("server") as never }}
      participations={{ get, set, ...options.participations }} timeZone="UTC" />} /></Routes>
  </MemoryRouter>));
  return { container, getItinerary, get, set, remove, tripId: before.tripId };
}
const card = (container: HTMLElement, id = A) => container.querySelector<HTMLElement>(`[data-itinerary-item="${id}"]`);
const dialogs = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>('[role="dialog"]'));
const control = (scope: HTMLElement, label: string) => {
  const element = Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === label || b.getAttribute("aria-label") === label);
  expect(element, label).toBeDefined(); return element!;
};
const click = async (scope: HTMLElement, label: string) => act(async () => control(scope, label).click());
async function openDetail(container: HTMLElement) { await click(card(container)!, "Paseo por el centro"); return dialogs(container)[0]!; }
async function openConfirm(container: HTMLElement) {
  const detail = await openDetail(container);
  await click(detail, "Eliminar actividad");
  return { detail, confirm: dialogs(container)[1]! };
}
const confirmDelete = (confirm: HTMLElement) => click(confirm, "Eliminar definitivamente");
const status = (container: HTMLElement) => Array.from(container.querySelectorAll('[role="status"]')).map((e) => e.textContent);
const postIds = (container: HTMLElement) => Array.from(container.querySelectorAll("[data-itinerary-post]")).map((e) => e.getAttribute("data-itinerary-post")).sort();

describe("activity removal from the itinerary", () => {
  it("offers the removal in the detail and opens the confirmation with focus on Cancelar, sending nothing", async () => {
    const { container, remove } = await render();
    const detail = await openDetail(container);
    expect(control(detail, "Editar actividad")).toBeDefined();
    await click(detail, "Eliminar actividad");
    const confirm = dialogs(container)[1]!;
    expect(confirm.textContent).toContain("Eliminar actividad");
    expect(confirm.textContent).toContain("Paseo por el centro");
    expect(confirm.closest(".activity-confirm-layer"), "stacking proxy: confirmation mounted in its own layer").not.toBeNull();
    expect(document.activeElement).toBe(control(confirm, "Cancelar"));
    expect(remove).not.toHaveBeenCalled();
  });
  it("presents Cancelar and Editar actividad as secondary while the destructive actions keep data-error", async () => {
    const { container } = await render();
    const detail = await openDetail(container);
    expect(control(detail, "Editar actividad").classList.contains("ui-button--secondary")).toBe(true);
    expect(control(detail, "Eliminar actividad").getAttribute("data-error")).toBe("true");
    await click(detail, "Eliminar actividad");
    const confirm = dialogs(container)[1]!;
    expect(control(confirm, "Cancelar").classList.contains("ui-button--secondary")).toBe(true);
    expect(control(confirm, "Eliminar definitivamente").getAttribute("data-error")).toBe("true");
    expect(control(confirm, "Eliminar definitivamente").classList.contains("ui-button--secondary")).toBe(false);
  });
  it("is not offered in the agenda, only in the detail", async () => {
    const { container } = await render();
    expect(Array.from(container.querySelectorAll("button")).map((b) => b.textContent)).not.toContain("Eliminar actividad");
  });
  it("Cancelar closes the confirmation without sending DELETE and keeps the detail and the activity", async () => {
    const { container, remove, getItinerary } = await render();
    const { detail, confirm } = await openConfirm(container);
    await click(confirm, "Cancelar");
    expect(dialogs(container)).toEqual([detail]);
    expect(remove).not.toHaveBeenCalled(); expect(card(container)).not.toBeNull(); expect(getItinerary).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(control(detail, "Eliminar actividad"));
  });
  it("Escape and the close button also cancel without sending DELETE", async () => {
    const { container, remove } = await render();
    const { detail, confirm } = await openConfirm(container);
    await act(async () => { confirm.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(dialogs(container)).toEqual([detail]);
    await click(detail, "Eliminar actividad"); await click(dialogs(container)[1]!, "Cerrar");
    expect(dialogs(container)).toEqual([detail]);
    expect(remove).not.toHaveBeenCalled(); expect(card(container)).not.toBeNull();
  });
  it("sends one DELETE, blocks the double action while pending (even two synchronous clicks) and cannot be closed", async () => {
    const pending = deferred<TripResult<void>>();
    const { container, remove, tripId } = await render({ remove: () => pending.promise });
    const { detail, confirm } = await openConfirm(container);
    await act(async () => { const button = control(confirm, "Eliminar definitivamente"); button.click(); button.click(); });
    expect(remove).toHaveBeenCalledTimes(1); expect(remove).toHaveBeenCalledWith(tripId, A);
    expect(control(confirm, "Eliminando…").disabled).toBe(true);
    expect(confirm.querySelector<HTMLButtonElement>(".ui-modal__close")!.disabled).toBe(true);
    expect(detail.querySelector<HTMLButtonElement>(".ui-modal__close")!.disabled).toBe(true);
    await act(async () => { confirm.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(dialogs(container)).toHaveLength(2);
    await act(async () => pending.resolve(ok));
    expect(remove).toHaveBeenCalledTimes(1);
  });
  it("after success removes the activity, its personal controls and the dialog, announces it and refreshes the context", async () => {
    const { container, remove, getItinerary } = await render();
    expect(card(container)!.textContent).toContain("Tu participación");
    expect(container.querySelectorAll(".activity-participation")).toHaveLength(2);
    const { confirm } = await openConfirm(container);
    await confirmDelete(confirm);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(card(container)).toBeNull();
    expect(container.textContent).not.toContain("Paseo por el centro");
    expect(container.querySelectorAll(".activity-participation")).toHaveLength(1);
    expect(dialogs(container)).toHaveLength(0);
    expect(status(container)).toContain("Actividad eliminada.");
    expect(status(container)).not.toContain("Actividad guardada.");
    expect(getItinerary).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain("Modificado");
  });
  it("keeps memories, chains and posts consultable after the refresh, as independent posts, each once", async () => {
    const { container } = await render();
    const before = postIds(container);
    expect(before).toEqual([itineraryId(10), itineraryId(11), ROOT, CHILD]);
    expect(card(container)!.querySelectorAll("[data-itinerary-post]")).toHaveLength(2);
    const { confirm } = await openConfirm(container);
    await confirmDelete(confirm);
    expect(postIds(container)).toEqual(before);
    expect(card(container)).toBeNull();
    for (const id of [ROOT, CHILD]) expect(container.querySelector(`[data-itinerary-post="${id}"]`)!.closest(`[data-itinerary-item="${A}"]`)).toBeNull();
    expect(container.querySelector(`[data-itinerary-post="${CHILD}"]`)!.textContent).toContain("Relacionado con otro post");
    expect(container.textContent).toContain("Almuerzo junto al río");
  });
  it("keeps the itinerary in place: no remount, no loading state, no scroll jump, focus not lost to the body", async () => {
    const scrollTo = vi.fn(); window.scrollTo = scrollTo as never;
    const { container } = await render();
    const section = container.querySelector("[data-itinerary-date]")!;
    const { confirm } = await openConfirm(container);
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    let calls: unknown[][] = [], contexts: unknown[] = [];
    try { await confirmDelete(confirm); } finally { calls = [...focus.mock.calls]; contexts = [...focus.mock.contexts]; focus.mockRestore(); }
    expect(container.querySelector("[data-itinerary-date]")).toBe(section);
    expect(container.textContent).not.toContain("Cargando itinerario…");
    expect(scrollTo).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(document.body);
    expect(container.contains(document.activeElement)).toBe(true);
    expect(document.activeElement!.textContent).toContain("Actividad eliminada.");
    // Focus moves to the announcement container without scrolling (the only scroll protection).
    const notice = document.activeElement as HTMLElement;
    expect(notice.getAttribute("tabindex")).toBe("-1");
    const noticeCalls = calls.filter((_, i) => contexts[i] === notice);
    expect(noticeCalls).toEqual([[{ preventScroll: true }]]);
  });
  it("disables the removal while a participation write is in flight or a conflict awaits confirmation", async () => {
    const write = deferred<TripResult<ParticipationResponse>>();
    const { container, remove } = await render({ participations: { set: vi.fn(() => write.promise) } });
    const detail = await openDetail(container);
    await click(detail, "No voy");
    expect(control(detail, "Eliminar actividad").disabled).toBe(true);
    await act(async () => write.resolve(conflictFailure));
    expect(container.querySelector(".participation-conflict-layer")).not.toBeNull();
    expect(control(detail, "Eliminar actividad").disabled).toBe(true);
    expect(remove).not.toHaveBeenCalled();
  });
  it("a write still in flight when the activity disappears neither revives its state nor opens the conflict modal", async () => {
    const write = deferred<TripResult<ParticipationResponse>>();
    const pending = deferred<TripResult<void>>();
    const set = vi.fn(() => write.promise);
    const { container } = await render({ remove: () => pending.promise, participations: { set } });
    const { confirm } = await openConfirm(container);
    await confirmDelete(confirm);
    await click(card(container)!, "No voy"); // agenda control behind the dialogs
    expect(set).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(ok));
    await act(async () => write.resolve(conflictFailure));
    expect(container.querySelector(".participation-conflict-layer")).toBeNull();
    expect(dialogs(container)).toHaveLength(0); expect(set).toHaveBeenCalledTimes(1);
  });
  it.each(["network", "server", "validation"])("a %s failure shows an alert, keeps the activity and the confirmation, announces nothing and does not refresh", async (kind) => {
    const { container, getItinerary } = await render({ remove: async () => fail(kind) });
    const { confirm } = await openConfirm(container);
    await confirmDelete(confirm);
    expect(confirm.querySelector('[role="alert"]')!.textContent).toContain("No pudimos eliminar la actividad");
    expect(card(container)).not.toBeNull(); expect(dialogs(container)).toHaveLength(2);
    expect(status(container).join(" ")).not.toContain("eliminada");
    expect(getItinerary).toHaveBeenCalledOnce();
    expect(container.querySelectorAll(".activity-participation")).toHaveLength(3); // agenda A, detail A, agenda B
  });
  it("after a failure the guard is released: a retry sends again and succeeds", async () => {
    const attempts = vi.fn().mockResolvedValueOnce(fail("network")).mockResolvedValue(ok);
    const { container, remove } = await render({ remove: attempts });
    const { confirm } = await openConfirm(container);
    await confirmDelete(confirm);
    expect(confirm.querySelector('[role="alert"]')).not.toBeNull();
    await confirmDelete(confirm);
    expect(remove).toHaveBeenCalledTimes(2); expect(card(container)).toBeNull(); expect(status(container)).toContain("Actividad eliminada.");
  });
  it("a rejected request is a network error and releases the guard", async () => {
    const attempts = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValue(ok);
    const { container, remove, getItinerary } = await render({ remove: attempts });
    const { confirm } = await openConfirm(container);
    await confirmDelete(confirm);
    expect(confirm.querySelector('[role="alert"]')!.textContent).toContain("No pudimos eliminar la actividad");
    expect(card(container)).not.toBeNull(); expect(getItinerary).toHaveBeenCalledOnce();
    await confirmDelete(confirm);
    expect(remove).toHaveBeenCalledTimes(2); expect(card(container)).toBeNull();
  });
  it("an expired session asks to sign in again, keeps the confirmation and announces nothing", async () => {
    const { container, getItinerary } = await render({ remove: async () => fail("unauthorized") });
    const { confirm } = await openConfirm(container);
    await confirmDelete(confirm);
    expect(confirm.querySelector('[role="alert"]')!.textContent).toContain("Tu sesión venció");
    expect(card(container)).not.toBeNull(); expect(status(container).join(" ")).not.toContain("eliminada"); expect(getItinerary).toHaveBeenCalledOnce();
  });
  it.each(["not-found", "forbidden"])("a %s answer says the activity no longer exists, refreshes and never announces an own deletion", async (kind) => {
    const { container, getItinerary } = await render({ remove: async () => fail(kind) });
    const { confirm } = await openConfirm(container);
    await confirmDelete(confirm);
    expect(status(container)).toContain("La actividad ya no existe.");
    expect(status(container).join(" ")).not.toContain("Actividad eliminada.");
    expect(dialogs(container)).toHaveLength(0); expect(card(container)).toBeNull(); expect(getItinerary).toHaveBeenCalledTimes(2);
  });
  it("an expelled member (404) is not told the activity was deleted and sees the unavailable itinerary after the refresh", async () => {
    const { container } = await render({ remove: async () => fail("not-found"), refresh: { ok: false, error: { kind: "not-found" } } });
    const { confirm } = await openConfirm(container);
    await confirmDelete(confirm);
    expect(container.textContent).not.toContain("Actividad eliminada.");
    expect(container.textContent).toContain("Este itinerario no está disponible para tu cuenta.");
  });
  it("any current member can remove: the screen takes no role into account", async () => {
    const { container, remove } = await render();
    const { confirm } = await openConfirm(container);
    await confirmDelete(confirm);
    expect(remove).toHaveBeenCalledOnce(); expect(card(container)).toBeNull();
  });
  it("leaves the other activities untouched and never reads or rewrites participations", async () => {
    const { container, get, set } = await render();
    const other = card(container, B)!.outerHTML;
    const { confirm } = await openConfirm(container);
    await confirmDelete(confirm);
    expect(card(container, B)!.outerHTML).toBe(other);
    expect(set).not.toHaveBeenCalled(); expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls.map((call) => call[1]).sort()).toEqual([A, B]);
  });
  it("while the refresh is still pending only the removed activity is gone: others, their controls and every post are untouched", async () => {
    const refresh = deferred<unknown>();
    const { container } = await render({ refresh: refresh.promise });
    const other = card(container, B)!.outerHTML;
    const posts = postIds(container);
    const section = container.querySelector("[data-itinerary-date]")!;
    const { confirm } = await openConfirm(container);
    await confirmDelete(confirm);
    expect(card(container)).toBeNull();
    expect(container.textContent).toContain("Actualizando itinerario…");
    expect(card(container, B)!.outerHTML.replace(" disabled=\"\"", "")).toBe(other); // the title is disabled while refreshing (existing behavior)
    expect(container.querySelectorAll(".activity-participation")).toHaveLength(1);
    expect(container.querySelectorAll("[data-itinerary-item]").length).toBeGreaterThan(2);
    expect(container.querySelector("[data-itinerary-date]")).toBe(section);
    expect(container.textContent).not.toContain("Cargando itinerario…");
    for (const id of posts.filter((post) => post !== ROOT && post !== CHILD)) expect(container.querySelector(`[data-itinerary-post="${id}"]`)).not.toBeNull();
    await act(async () => refresh.resolve({ ok: true, value: fixtures().after }));
    expect(card(container, B)!.outerHTML).toBe(other);
  });
  it("keeps the local removal and offers a retry when the refresh after a successful removal fails", async () => {
    const { container, getItinerary } = await render({ refresh: { ok: false, error: { kind: "network" } } });
    const { confirm } = await openConfirm(container);
    await confirmDelete(confirm);
    expect(card(container)).toBeNull(); expect(status(container)).toContain("Actividad eliminada.");
    expect(container.textContent).toContain("No pudimos actualizar el itinerario. Los cambios guardados se conservan.");
    expect(getItinerary).toHaveBeenCalledTimes(2);
  });
  it("un timeout al actualizar el itinerario tiene su propio texto y conserva la eliminación local (T150)", async () => {
    const { container } = await render({ refresh: { ok: false, error: { kind: "network", code: "TimeoutError" } } });
    const { confirm } = await openConfirm(container);
    await confirmDelete(confirm);
    expect(card(container)).toBeNull();
    expect(container.textContent).toContain("La conexión tardó demasiado. Intentá nuevamente. Los cambios guardados se conservan.");
    expect(container.textContent).not.toContain("No pudimos actualizar el itinerario");
  });
  it("una conexión caída al actualizar el itinerario conserva el texto de siempre (T150)", async () => {
    const { container } = await render({ refresh: { ok: false, error: { kind: "network", code: "NetworkError" } } });
    const { confirm } = await openConfirm(container);
    await confirmDelete(confirm);
    expect(container.textContent).toContain("No pudimos actualizar el itinerario. Los cambios guardados se conservan.");
    expect(container.textContent).not.toContain("tardó demasiado");
  });
});
