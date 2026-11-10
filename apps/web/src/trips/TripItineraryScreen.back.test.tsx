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
beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); window.scrollTo = vi.fn(); });

const T = itineraryId(1), A = itineraryId(8), TR = itineraryId(6);
const itinerary = `/trips/${T}/itinerary`;
let go: NavigateFunction = () => undefined;
let here = { path: "", state: null as unknown, key: "" };
function Spy() { go = useNavigate(); const l = useLocation(); here = { path: `${l.pathname}${l.search}`, state: l.state, key: l.key }; return null; }

type Entry = string | { pathname: string; search?: string; state?: unknown };
async function mount(entries: Entry[] = ["/trips", itinerary], activityApi: { remove?: () => Promise<unknown> } = {}) {
  const value = itineraryFixture() as TripItineraryResponse;
  const getItinerary = vi.fn().mockImplementation(async () => ({ ok: true, value: structuredClone(value) }));
  const get = vi.fn().mockImplementation(async (_t: string, id: string) => ({ ok: true, value: value.activities.find((a) => a.id === id) }));
  const update = vi.fn().mockImplementation(async (_t: string, id: string, input: object) => {
    const activity = value.activities.find((a) => a.id === id)!; Object.assign(activity, input); return { ok: true, value: { ...activity } };
  });
  const remove = vi.fn().mockImplementation(activityApi.remove ?? (async () => ({ ok: true, value: undefined })));
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={entries as never} initialIndex={entries.length - 1}><Spy />
    <Routes><Route path="/trips" element={<p data-list>mis viajes</p>} />
      <Route path="/trips/:tripId/itinerary" element={<TripItineraryScreen itinerary={{ get: getItinerary }} timeZone="UTC"
        activities={{ get, update, remove: remove as never, create: vi.fn() as never }} />} /></Routes></MemoryRouter>));
  return { container, getItinerary, update, remove };
}
const click = async (element: Element | null | undefined) => { expect(element).toBeTruthy(); await act(async () => element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))); };
const byText = (scope: ParentNode, text: string) => Array.from(scope.querySelectorAll("button")).find((b) => b.textContent === text || b.getAttribute("aria-label") === text);
const openActivity = (container: HTMLElement) => click(container.querySelector(`[data-itinerary-item="${A}"] button.activity-title`));
const openTransport = (container: HTMLElement) => click(container.querySelector(`[data-itinerary-item="${TR}"] button.transport-title`));
const dialogOpen = () => document.querySelector(".activity-dialog, .transport-dialog") !== null;
const back = () => act(async () => go(-1));
const flagged = () => (here.state as { dialogPushed?: boolean } | null)?.dialogPushed === true;

describe("itinerary: Back with a dialog open", () => {
  it("opening an activity pushes an entry marked dialogPushed; Back closes the dialog on the same itinerary and then leaves it", async () => {
    const { container } = await mount([ "/trips", `${itinerary}?day=2026-09-25`]);
    await openActivity(container);
    expect(here.path).toBe(`${itinerary}?day=2026-09-25&activity=${A}`);
    expect(flagged()).toBe(true);
    expect(dialogOpen()).toBe(true);
    await back();
    expect(here.path).toBe(`${itinerary}?day=2026-09-25`);
    expect(dialogOpen()).toBe(false);
    expect(container.querySelector(`[data-itinerary-item="${A}"]`)).not.toBeNull();
    await back();
    expect(here.path).toBe("/trips");
  });
  it("the X pops the entry it pushed: no duplicate entries remain", async () => {
    const { container } = await mount();
    await openActivity(container);
    await click(byText(document, "Cerrar"));
    expect(here.path).toBe(itinerary);
    expect(dialogOpen()).toBe(false);
    await back();
    expect(here.path).toBe("/trips"); // a single Back leaves the itinerary
  });
  it("saving an edit pops the dialog entry", async () => {
    const { container, update } = await mount();
    await openActivity(container);
    await click(byText(document, "Editar actividad"));
    const time = document.querySelector<HTMLInputElement>('[name="time"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(time, "13:00"); time.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(update).toHaveBeenCalledOnce();
    expect(here.path).toBe(itinerary);
    expect(dialogOpen()).toBe(false);
    await back();
    expect(here.path).toBe("/trips");
  });
  it("removing the activity pops the dialog entry once (a second close must not leave the itinerary)", async () => {
    const { container, remove } = await mount();
    await openActivity(container);
    await click(byText(document, "Eliminar actividad"));
    await click(byText(document, "Eliminar definitivamente"));
    expect(remove).toHaveBeenCalledOnce();
    expect(here.path).toBe(itinerary);
    expect(dialogOpen()).toBe(false);
    await back();
    expect(here.path).toBe("/trips");
  });
  it("a transport detail works the same way", async () => {
    const { container } = await mount();
    await openTransport(container);
    expect(here.path).toBe(`${itinerary}?transport=${TR}`);
    expect(flagged()).toBe(true);
    await back();
    expect(here.path).toBe(itinerary);
    expect(dialogOpen()).toBe(false);
    await openTransport(container);
    await click(byText(document, "Cerrar"));
    expect(here.path).toBe(itinerary);
    await back();
    expect(here.path).toBe("/trips");
  });
  it("opening from another entry state keeps its other state (origin) but never copies «no way back»", async () => {
    const origin = { path: "/notifications", label: "avisos" };
    const { container } = await mount(["/trips", { pathname: itinerary, state: { origin, noBack: true } }]);
    await openActivity(container);
    expect(here.state).toEqual({ origin, dialogPushed: true });
  });
  it("a dialog opened by a deep link has no mark: closing replaces the entry and Back leaves the itinerary", async () => {
    await mount(["/trips", `${itinerary}?activity=${A}`]);
    expect(dialogOpen()).toBe(true);
    expect(flagged()).toBe(false);
    await click(byText(document, "Cerrar"));
    expect(here.path).toBe(itinerary);
    expect(dialogOpen()).toBe(false);
    await back();
    expect(here.path).toBe("/trips");
  });
  it("a deep-linked transport that no longer exists is cleaned by replacing, with no extra Back needed", async () => {
    await mount(["/trips", `${itinerary}?transport=${itineraryId(999)}`]);
    expect(here.path).toBe(itinerary);
    await back();
    expect(here.path).toBe("/trips");
  });
  it("a pushed dialog whose activity disappears pops its entry once", async () => {
    const { container, getItinerary } = await mount();
    await openActivity(container);
    const gone = itineraryFixture() as TripItineraryResponse;
    gone.activities = gone.activities.filter((a) => a.id !== A);
    gone.days.forEach((d) => { d.items = d.items.filter((i) => i.id !== A); });
    getItinerary.mockResolvedValue({ ok: true, value: gone });
    await act(async () => go(`${itinerary}?activity=${itineraryId(777)}`, { replace: true, state: { dialogPushed: true } }));
    expect(here.path).toBe(itinerary);
    await back();
    expect(here.path).toBe("/trips");
  });
});
