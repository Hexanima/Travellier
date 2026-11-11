// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { itineraryFixture, itineraryId } from "./itinerary-test-fixture.js";
import type { TripItineraryResponse } from "./trip-itinerary-api.js";
import type { ParticipationResponse } from "./trip-participation-api.js";
import { TripRefreshProvider, useRefreshNow } from "./trip-refresh.js";
import { TripItineraryScreen } from "./TripItineraryScreen.js";
import { GalleryProvider } from "./use-gallery.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); window.scrollTo = vi.fn(); });

const T = itineraryId(1), A = itineraryId(8), me = itineraryId(20);
const at = (day: number, hour: number) => `2026-09-${day}T${String(hour).padStart(2, "0")}:00:00.000Z`;
type Result = { ok: true; value: TripItineraryResponse } | { ok: false; error: { kind: string } };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
/** Four local days (25 to 28 in UTC). */
function multiDay(): TripItineraryResponse {
  const value = itineraryFixture() as TripItineraryResponse;
  value.days[0]!.startsAt = at(25, 8); value.days[0]!.endsAt = at(25, 10);
  value.days[1]!.startsAt = at(25, 10); value.days[1]!.endsAt = at(28, 18);
  value.days[2]!.startsAt = at(28, 18); value.days[2]!.endsAt = at(28, 20);
  value.transports[0]!.departureAt = at(25, 8); value.transports[0]!.arrivalAt = at(25, 10);
  value.transports[1]!.departureAt = at(28, 18); value.transports[1]!.arrivalAt = at(28, 20);
  value.activities[1]!.scheduledAt = at(26, 14);
  value.days[1]!.items = value.activities.map((activity) => ({ kind: "activity", id: activity.id, at: activity.scheduledAt }));
  return value;
}
const withNewActivity = (value: TripItineraryResponse): TripItineraryResponse => {
  const next = structuredClone(value);
  next.activities.push({ ...next.activities[0]!, id: itineraryId(71), title: "Cena nueva", scheduledAt: at(25, 16) });
  next.days[1]!.items.push({ kind: "activity", id: itineraryId(71), at: at(25, 16) });
  return next;
};
const pendingMark: ParticipationResponse = { id: itineraryId(50), tripId: T, activityId: A, userId: me, status: "pending", updatedAt: "2026-09-25T12:00:00.000Z",
  decisionRequired: { reason: "schedule_conflict", changedFields: ["scheduledAt"], changedAt: "2026-09-25T13:00:00.000Z" } };
const going: ParticipationResponse = { ...pendingMark, status: "going", decisionRequired: undefined };

let where = { pathname: "", search: "" };
function Spy() { const l = useLocation(); where = { pathname: l.pathname, search: l.search }; return null; }
function RefreshButton() { const refresh = useRefreshNow(); return <button type="button" data-refresh onClick={() => void refresh()}>Refrescar ahora</button>; }
type Options = { entry?: string; results?: (() => Promise<Result> | Result)[]; participation?: () => ParticipationResponse | null; withMembers?: boolean; list?: ReturnType<typeof vi.fn> };
async function mount(options: Options = {}) {
  const results = options.results ?? [() => ({ ok: true, value: multiDay() })];
  const get = vi.fn().mockImplementation(async () => results[Math.min(get.mock.calls.length - 1, results.length - 1)]!());
  const participationGet = vi.fn().mockImplementation(async (_t: string, id: string) => ({ ok: true, value: id === A ? (options.participation?.() ?? going) : null }));
  const getActivity = vi.fn().mockImplementation(async (_t: string, id: string) => ({ ok: true, value: multiDay().activities.find((a) => a.id === id) }));
  const list = options.list ?? vi.fn(async () => ({ ok: true, value: { photos: [], nextCursor: null } }));
  const members = { list: vi.fn(async () => ({ ok: true, value: { currentUserId: me, members: [] } })) };
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={[options.entry ?? `/trips/${T}/itinerary`]}><Spy />
    <Routes>
      <Route path="/trips" element={<p data-gone>MIS VIAJES</p>} />
      <Route path="/trips/:tripId/itinerary" element={<TripRefreshProvider tripId={T}><GalleryProvider list={list as never} now={() => 0}>
        <RefreshButton />
        <TripItineraryScreen itinerary={{ get }} timeZone="UTC" participations={{ get: participationGet, set: vi.fn() as never }}
          activities={{ get: getActivity, create: vi.fn() as never, update: vi.fn() as never, remove: vi.fn() as never }} {...(options.withMembers ? { members: members as never } : {})} />
      </GalleryProvider></TripRefreshProvider>} />
    </Routes></MemoryRouter>));
  return { container, get, participationGet, getActivity, list };
}
const refresh = () => act(async () => { document.querySelector<HTMLElement>("[data-refresh]")!.click(); });
const click = (element: Element | null | undefined) => act(async () => { expect(element).toBeTruthy(); (element as HTMLElement).click(); });
const text = () => document.body.textContent ?? "";
const buttons = () => Array.from(document.querySelectorAll<HTMLButtonElement>("button.activity-create, button.activity-title, button.transport-title"));

describe("itinerary: silent refresh", () => {
  it("does not show «Actualizando…», does not disable the buttons and brings the new activity while keeping the day", async () => {
    const gate = deferred<Result>();
    let call = 0;
    const { container } = await mount({ entry: `/trips/${T}/itinerary?day=2026-09-26`, results: [() => ({ ok: true, value: multiDay() }), () => { call += 1; return gate.promise; }] });
    expect(buttons().length).toBeGreaterThan(0);
    await refresh();
    expect(call).toBe(1);
    expect(text()).not.toContain("Actualizando itinerario");
    expect(buttons().every((button) => !button.disabled)).toBe(true);
    await act(async () => gate.resolve({ ok: true, value: withNewActivity(multiDay()) }));
    expect(where.search).toBe("?day=2026-09-26");
    expect(container.querySelector("[data-itinerary-date]")!.getAttribute("data-itinerary-date")).toBe("2026-09-26");
    await click(container.querySelector('[data-day="2026-09-25"]'));
    expect(text()).toContain("Cena nueva");
  });

  it("keeps the activity detail open and does not ask for its detail again", async () => {
    const { getActivity } = await mount({ entry: `/trips/${T}/itinerary?activity=${A}`, results: [() => ({ ok: true, value: multiDay() }), () => ({ ok: true, value: withNewActivity(multiDay()) })] });
    const dialog = document.querySelector(".activity-dialog");
    expect(dialog).not.toBeNull();
    const asked = getActivity.mock.calls.length;
    await refresh();
    expect(document.querySelector(".activity-dialog")).toBe(dialog);
    expect(where.search).toBe(`?activity=${A}`);
    expect(getActivity.mock.calls.length).toBe(asked);
  });

  it("does not interrupt a creation dialog: same node, same typed text", async () => {
    await mount({ results: [() => ({ ok: true, value: multiDay() }), () => ({ ok: true, value: withNewActivity(multiDay()) })] });
    await click(document.querySelector("button.activity-create"));
    const title = document.querySelector<HTMLInputElement>('input[name="title"]')!;
    await act(async () => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; setter.call(title, "Mi borrador"); title.dispatchEvent(new Event("input", { bubbles: true })); });
    await refresh();
    expect(document.querySelector('input[name="title"]')).toBe(title);
    expect(title.value).toBe("Mi borrador");
    await click(Array.from(document.querySelectorAll<HTMLElement>('.activity-dialog button[aria-label="Cerrar"]'))[0]);
    expect(text()).toContain("Cena nueva");
  });

  it("a network or server failure with data shows no banner, no loading and keeps what was there", async () => {
    await mount({ results: [() => ({ ok: true, value: multiDay() }), () => ({ ok: false, error: { kind: "network" } }), () => ({ ok: false, error: { kind: "server" } })] });
    await refresh(); await refresh();
    expect(text()).not.toContain("No pudimos actualizar el itinerario");
    expect(text()).not.toContain("Actualizando itinerario");
    expect(text()).not.toContain("No pudimos cargar");
    expect(text()).toContain("Paseo por el centro");
  });

  it("a session failure does not wipe the data nor navigate (the http client already handles it)", async () => {
    await mount({ results: [() => ({ ok: true, value: multiDay() }), () => ({ ok: false, error: { kind: "unauthorized" } })] });
    await refresh();
    expect(document.querySelector("[data-gone]")).toBeNull();
    expect(text()).toContain("Paseo por el centro");
  });

  it.each(["forbidden", "not-found"])("%s leads to Mis viajes without leaving Trip data on screen", async (kind) => {
    await mount({ results: [() => ({ ok: true, value: multiDay() }), () => ({ ok: false, error: { kind } })] });
    await refresh();
    expect(document.querySelector("[data-gone]")).not.toBeNull();
    expect(where.pathname).toBe("/trips");
    expect(text()).not.toContain("Paseo por el centro");
  });

  it("when the selected day disappears the first day is shown without breaking", async () => {
    const shorter = multiDay();
    shorter.days[1]!.endsAt = at(26, 18); shorter.days[2]!.startsAt = at(26, 18); shorter.days[2]!.endsAt = at(26, 20);
    shorter.transports[1]!.departureAt = at(26, 18); shorter.transports[1]!.arrivalAt = at(26, 20);
    const { container } = await mount({ entry: `/trips/${T}/itinerary?day=2026-09-28`, results: [() => ({ ok: true, value: multiDay() }), () => ({ ok: true, value: shorter })] });
    expect(container.querySelector("[data-itinerary-date]")!.getAttribute("data-itinerary-date")).toBe("2026-09-28");
    await refresh();
    expect(container.querySelector("[data-itinerary-date]")!.getAttribute("data-itinerary-date")).toBe("2026-09-25");
    expect(container.querySelector('[data-day="2026-09-28"]')).toBeNull();
  });

  it("the answer and the «Modificado» mark are refreshed in the same cycle", async () => {
    let next: ParticipationResponse = going;
    const { container, participationGet } = await mount({ participation: () => next, results: [() => ({ ok: true, value: multiDay() }), () => ({ ok: true, value: multiDay() })] });
    expect(container.textContent).not.toContain("Modificado");
    const before = participationGet.mock.calls.length;
    next = pendingMark;
    await refresh();
    expect(participationGet.mock.calls.length).toBeGreaterThan(before);
    expect(container.textContent).toContain("Modificado");
  });

  it("an activity that appears in a refresh asks for its participation only once", async () => {
    const { participationGet } = await mount({ results: [() => ({ ok: true, value: multiDay() }), () => ({ ok: true, value: withNewActivity(multiDay()) })] });
    const asked = (id: string) => participationGet.mock.calls.filter((call) => call[1] === id).length;
    expect(asked(itineraryId(71))).toBe(0);
    await refresh();
    expect(asked(itineraryId(71))).toBe(1);
  });

  it("an activity removed by the server while its detail is open follows the existing «ya no existe» flow", async () => {
    const without = multiDay();
    without.activities = without.activities.filter((a) => a.id !== A);
    without.days[1]!.items = without.days[1]!.items.filter((item) => item.id !== A);
    await mount({ entry: `/trips/${T}/itinerary?activity=${A}`, results: [() => ({ ok: true, value: multiDay() }), () => ({ ok: true, value: without })] });
    await refresh();
    expect(document.querySelector(".activity-dialog")).toBeNull();
    expect(text()).toContain("La actividad ya no existe.");
    expect(where.search).toBe("");
  });

  it("an identical answer replaces nothing: the rendered nodes stay", async () => {
    const { container } = await mount({ results: [() => ({ ok: true, value: multiDay() }), () => ({ ok: true, value: multiDay() })] });
    const item = container.querySelector(`[data-itinerary-item="${A}"]`);
    await refresh();
    expect(container.querySelector(`[data-itinerary-item="${A}"]`)).toBe(item);
  });

  it("replacing the itinerary does not restart the photos of the open detail", async () => {
    const list = vi.fn(async () => ({ ok: true, value: { photos: [], nextCursor: null } }));
    await mount({ entry: `/trips/${T}/itinerary?activity=${A}&tab=photos`, withMembers: true, list,
      results: [() => ({ ok: true, value: multiDay() }), () => ({ ok: true, value: withNewActivity(multiDay()) })] });
    const asked = list.mock.calls.length;
    expect(asked).toBeGreaterThan(0);
    await refresh();
    expect(list.mock.calls.length).toBe(asked);
    expect(document.querySelector(".activity-dialog")).not.toBeNull();
  });

  it("without data the first load error is still shown (a refresh is not a retry that hides it)", async () => {
    await mount({ results: [() => ({ ok: false, error: { kind: "network" } })] });
    await refresh();
    expect(text()).toContain("No pudimos cargar el itinerario");
  });

  it("does not start a second request while one is in flight", async () => {
    const gate = deferred<Result>();
    const { get } = await mount({ results: [() => ({ ok: true, value: multiDay() }), () => gate.promise] });
    await refresh(); await refresh();
    expect(get).toHaveBeenCalledTimes(2);
    await act(async () => gate.resolve({ ok: true, value: multiDay() }));
  });
});
