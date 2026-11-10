// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation, useNavigate, type NavigateFunction } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { itineraryFixture, itineraryId, linkPost } from "./itinerary-test-fixture.js";
import { canGoBack, originHref, readOrigin, type PostOrigin } from "./post-origin.js";
import { TripItineraryScreen } from "./TripItineraryScreen.js";
import { GalleryProvider } from "./use-gallery.js";
import type { GalleryPage, GalleryPhoto } from "./trip-gallery-api.js";
import type { TripItineraryResponse } from "./trip-itinerary-api.js";

// Lets a test defer «navigate(-1)» (as BrowserRouter does: history.go is asynchronous) to reproduce the window between the close and the popstate.
const gate = vi.hoisted(() => ({ defer: false, back: [] as (() => void)[] }));
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => {
    const navigate = actual.useNavigate();
    return ((...args: unknown[]) => {
      if (gate.defer && args[0] === -1) gate.back.push(() => (navigate as (delta: number) => void)(-1));
      else (navigate as (...rest: unknown[]) => void)(...args);
    }) as NavigateFunction;
  } };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { gate.defer = false; gate.back.length = 0; await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); vi.restoreAllMocks(); });
beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); window.scrollTo = vi.fn(); });

const T = itineraryId(1), A = itineraryId(8), B = itineraryId(9), ROOT = itineraryId(20), CHILD = itineraryId(21), me = itineraryId(600);
const NOW = Date.parse("2026-09-25T12:00:00.000Z");
const itineraryPath = `/trips/${T}/itinerary`;
const memoriesPath = `/trips/${T}/memories`;

/** The itinerary with a chain (root -> child) hanging from activity A, or from B once it was relinked there. */
function itinerary(root: string = A): TripItineraryResponse {
  const base = itineraryFixture() as unknown as TripItineraryResponse;
  const make = (id: number, hour: number, description: string) => ({ ...structuredClone(base.posts[0]!), id: itineraryId(id), description, createdAt: `2026-09-25T${hour}:00:00.123Z`, expense: null });
  base.posts = [...base.posts, linkPost(make(20, 13, "Raíz del recuerdo"), { activityId: root }),
    linkPost(make(21, 14, "Hija del recuerdo"), { parentPostId: ROOT, rootPostId: ROOT, rootActivityId: root })];
  return base;
}
const detached = (): TripItineraryResponse => {
  const base = itinerary();
  base.activities = base.activities.filter((a) => a.id !== A);
  base.posts = base.posts.map((p) => p.id === ROOT || p.id === CHILD ? linkPost(p as never, { parentPostId: p.id === CHILD ? ROOT : null, rootPostId: ROOT, rootActivityId: null }) as never : p);
  return base;
};
const photo = (n: number, postId: string): GalleryPhoto => ({ id: itineraryId(n), postId, order: 0, uploadedAt: "2026-09-25T13:30:00.000Z", uploaderId: me,
  url: `https://s3.test/${n}?sig=SECRET${n}`, expiresAtMs: NOW + 300_000, post: { createdAt: "2026-09-25T14:00:00.123Z", authorId: me, rootActivityId: A, rootTransportId: null } });
const page = (photos: GalleryPhoto[]): { ok: true; value: GalleryPage } => ({ ok: true, value: { photos, nextCursor: null } });
const chainPhotos = () => page([photo(32, CHILD), photo(31, ROOT)]);
const members = { list: vi.fn() };

/** What the post detail does when going back: a step back with history, or the origin (with its restore data) without it. Mirrors PostDetailScreen. */
const restoreOf = (origin: PostOrigin) => {
  if (origin.anchor === undefined || origin.scrollY === undefined) return undefined;
  const photoId = origin.viewer && origin.anchor.startsWith("data-photo=") ? origin.anchor.slice("data-photo=".length) : undefined;
  return { ...(photoId ? { photo: photoId } : {}), restore: { anchor: origin.anchor, scrollY: origin.scrollY } };
};
function Detail() {
  const location = useLocation();
  const navigate = useNavigate();
  const origin = readOrigin(location.state, T);
  return <div><p data-detail>DETALLE</p><p data-origin>{JSON.stringify(origin)}</p>
    <button type="button" onClick={() => { if (canGoBack(location)) navigate(-1); else navigate(originHref(origin), { state: restoreOf(origin) }); }}>Volver</button></div>;
}
function Probe() { const location = useLocation(); return <p data-probe>{JSON.stringify({ pathname: location.pathname, search: location.search, state: location.state })}</p>; }
let here = "";
let go: ReturnType<typeof useNavigate> = () => undefined;
function Spy() { const location = useLocation(); here = `${location.pathname}${location.search}`; go = useNavigate(); return null; }
function Back() { const navigate = useNavigate(); return <button type="button" data-testid="atras" onClick={() => navigate(-1)}>atras</button>; }

type Entry = string | { pathname: string; search?: string; state?: unknown };
type Options = { entries?: Entry[]; index?: number; itineraries?: unknown[]; galleries?: unknown[]; withMembers?: boolean };
async function mount(options: Options = {}) {
  const itineraries = options.itineraries ?? [{ ok: true, value: itinerary() }];
  const getItinerary = vi.fn().mockImplementation(async () => structuredClone(itineraries[Math.min(getItinerary.mock.calls.length - 1, itineraries.length - 1)]));
  const galleries = options.galleries ?? [chainPhotos()];
  const list = vi.fn().mockImplementation(async () => galleries[Math.min(list.mock.calls.length - 1, galleries.length - 1)]);
  members.list.mockReset().mockResolvedValue({ ok: true, value: { currentUserId: me, members: [{ id: itineraryId(900), userId: me, name: "Yo", role: "admin", joinedAt: "2026-09-01T10:00:00.000Z" }] } });
  const getActivity = vi.fn().mockImplementation(async (_t: string, id: string) => ({ ok: true, value: itinerary().activities.find((a) => a.id === id) }));
  const remove = vi.fn(async () => ({ ok: true as const, value: undefined }));
  const entries = options.entries ?? [itineraryPath];
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={entries} initialIndex={options.index ?? entries.length - 1}><Spy /><Back />
    <GalleryProvider list={list as never} now={() => NOW}><Routes>
      <Route path="/trips/:tripId/itinerary" element={<TripItineraryScreen itinerary={{ get: getItinerary }} timeZone="UTC"
        activities={{ get: getActivity, remove, create: vi.fn() as never, update: vi.fn() as never }} {...(options.withMembers === false ? {} : { members: members as never })} />} />
      <Route path="/trips/:tripId/memories" element={<p>DIARIO</p>} />
      <Route path="/trips/:tripId/memories/new" element={<Probe />} />
      <Route path="/trips/:tripId/memories/:postId" element={<Detail />} />
    </Routes></GalleryProvider></MemoryRouter>));
  return { container, getItinerary, list, getActivity, remove };
}
const click = async (element: Element | null | undefined) => { expect(element).toBeTruthy(); await act(async () => element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))); };
const byText = (scope: ParentNode, selector: string, text: string) => Array.from(scope.querySelectorAll(selector)).find((item) => item.textContent === text);
const openActivity = (container: HTMLElement) => click(container.querySelector(`[data-itinerary-item="${A}"] button.activity-title`));
const tab = (name: "memories" | "photos") => document.getElementById(`activity-tab-${name}`) as HTMLButtonElement | null;
const rows = () => Array.from(document.querySelectorAll("[data-memory]")).map((item) => item.getAttribute("data-memory"));
const photoRows = () => Array.from(document.querySelectorAll("ul.photo-grid li")).map((item) => item.getAttribute("data-photo"));
const closeDialog = () => click(Array.from(document.querySelectorAll('.activity-dialog button[aria-label="Cerrar"]'))[0]);
const flush = async () => { for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve(); }); };
const statuses = () => Array.from(document.querySelectorAll('[role="status"]')).map((item) => item.textContent ?? "");

describe("activity dialog in the URL", () => {
  it("opening the activity sets ?activity=<id> by replacing the entry, so Back leaves the itinerary as before", async () => {
    const { container } = await mount({ entries: [memoriesPath, itineraryPath] });
    await openActivity(container);
    expect(here).toBe(`${itineraryPath}?activity=${A}`);
    expect(document.querySelector(".activity-dialog")).not.toBeNull();
    expect(tab("memories")!.getAttribute("aria-selected")).toBe("true");
    await click(document.querySelector('[data-testid="atras"]'));
    expect(here).toBe(memoriesPath);
  });
  it("changing the tab sets &tab= by replacing the entry", async () => {
    const { container } = await mount({ entries: [memoriesPath, itineraryPath] });
    await openActivity(container);
    await click(tab("photos"));
    expect(here).toBe(`${itineraryPath}?activity=${A}&tab=photos`);
    expect(tab("photos")!.getAttribute("aria-selected")).toBe("true");
    await click(tab("memories"));
    expect(here).toBe(`${itineraryPath}?activity=${A}&tab=memories`);
    await click(document.querySelector('[data-testid="atras"]'));
    expect(here).toBe(memoriesPath);
  });
  it("closing the dialog clears activity and tab, by replacing the entry", async () => {
    const { container } = await mount({ entries: [memoriesPath, itineraryPath] });
    await openActivity(container);
    await click(tab("photos"));
    await closeDialog();
    expect(here).toBe(itineraryPath);
    expect(document.querySelector(".activity-dialog")).toBeNull();
    await click(document.querySelector('[data-testid="atras"]'));
    expect(here).toBe(memoriesPath);
  });
  it("reloading with the URL opens the dialog in the right tab", async () => {
    await mount({ entries: [`${itineraryPath}?activity=${A}&tab=photos`] });
    await flush();
    expect(document.querySelector(".activity-dialog")).not.toBeNull();
    expect(tab("photos")!.getAttribute("aria-selected")).toBe("true");
    expect(photoRows()).toEqual([itineraryId(32), itineraryId(31)]);
  });
  it("an invalid tab opens Recuerdos and an invalid activity opens nothing", async () => {
    await mount({ entries: [`${itineraryPath}?activity=${A}&tab=otra`] });
    await flush();
    expect(tab("memories")!.getAttribute("aria-selected")).toBe("true");
    await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren();
    const { getItinerary } = await mount({ entries: [`${itineraryPath}?activity=nope`] });
    await flush();
    expect(document.querySelector(".activity-dialog")).toBeNull();
    expect(getItinerary).toHaveBeenCalledTimes(1);
  });
  it("lists the chain of the activity in Recuerdos and its images in Fotos", async () => {
    const { container } = await mount();
    await openActivity(container);
    await flush();
    expect(rows()).toEqual([CHILD, ROOT]);
    await click(tab("photos"));
    expect(photoRows()).toEqual([itineraryId(32), itineraryId(31)]);
  });
  it("removing the activity clears the URL, refreshes, and the memories are not deleted", async () => {
    const { container, getItinerary } = await mount({ itineraries: [{ ok: true, value: itinerary() }, { ok: true, value: detached() }] });
    await openActivity(container);
    await click(byText(document, "button", "Eliminar actividad"));
    await click(byText(document, "button", "Eliminar definitivamente"));
    await flush();
    expect(here).toBe(itineraryPath);
    expect(getItinerary).toHaveBeenCalledTimes(2);
    expect(statuses()).toContain("Actividad eliminada.");
    expect(document.querySelector(".activity-dialog")).toBeNull();
    // The memories were not deleted: the refreshed itinerary still lists them, now independent of the removed activity.
    expect(container.querySelector(`[data-itinerary-post="${ROOT}"]`)?.textContent).toContain("Raíz del recuerdo");
    expect(container.querySelector(`[data-itinerary-post="${CHILD}"]`)?.textContent).toContain("Hija del recuerdo");
    expect(container.querySelector(`[data-itinerary-item="${A}"]`)).toBeNull();
  });
  it("without members the dialog has no memories nor tabs and everything else works", async () => {
    const { container } = await mount({ withMembers: false });
    await openActivity(container);
    expect(document.querySelector(".activity-dialog")).not.toBeNull();
    expect(document.querySelector('[role="tablist"]')).toBeNull();
    expect(here).toBe(`${itineraryPath}?activity=${A}`);
  });
});

describe("an activity that does not exist anymore", () => {
  it("shows «La actividad ya no existe.», clears the URL before refreshing and refreshes once, without a loop", async () => {
    const missing = itineraryId(77);
    const { getItinerary } = await mount({ entries: [`${itineraryPath}?activity=${missing}&tab=photos`] });
    await flush();
    expect(here).toBe(itineraryPath);
    expect(statuses()).toContain("La actividad ya no existe.");
    expect(getItinerary).toHaveBeenCalledTimes(2);
    await flush();
    expect(getItinerary).toHaveBeenCalledTimes(2);
    expect(document.querySelector(".activity-dialog")).toBeNull();
  });
  it("a 404 of the gallery goes through the same path", async () => {
    const { container, getItinerary } = await mount({ galleries: [{ ok: false, error: { kind: "not-found" } }] });
    await openActivity(container);
    await flush();
    expect(here).toBe(itineraryPath);
    expect(statuses()).toContain("La actividad ya no existe.");
    expect(getItinerary).toHaveBeenCalledTimes(2);
  });
});

describe("opening a memory and coming back", () => {
  it("restores the dialog, the tab and the focus on the memory with a step back", async () => {
    const { container } = await mount();
    await openActivity(container);
    await flush();
    await click(document.querySelector(`[data-memory="${ROOT}"] a`));
    expect(document.querySelector("[data-detail]")).not.toBeNull();
    expect(JSON.parse(document.querySelector("[data-origin]")!.textContent!)).toMatchObject({ path: itineraryPath, search: `?activity=${A}`, label: "actividad", anchor: `data-memory=${ROOT}` });
    await click(byText(document, "button", "Volver"));
    await flush();
    expect(here).toBe(`${itineraryPath}?activity=${A}`);
    expect(document.querySelector(".activity-dialog")).not.toBeNull();
    expect(tab("memories")!.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(document.querySelector(`[data-memory="${ROOT}"]`));
    expect(window.scrollTo).not.toHaveBeenCalled(); // the anchor was found: no fallback to the saved scroll
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });
  it("restores the Fotos tab and the thumbnail it came from", async () => {
    await mount({ entries: [`${itineraryPath}?activity=${A}&tab=photos`] });
    await flush();
    await click(document.querySelector(`[data-photo="${itineraryId(31)}"] button`));
    await click(byText(document, "a", "Ver recuerdo"));
    expect(document.querySelector("[data-detail]")).not.toBeNull();
    expect(JSON.parse(document.querySelector("[data-origin]")!.textContent!)).toMatchObject({ search: `?activity=${A}&tab=photos`, label: "actividad", viewer: true, anchor: `data-photo=${itineraryId(31)}` });
    await click(byText(document, "button", "Volver"));
    await flush();
    expect(tab("photos")!.getAttribute("aria-selected")).toBe("true");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });
  it("reopens the photo viewer on the same photo after coming back", async () => {
    const { list } = await mount({ entries: [`${itineraryPath}?activity=${A}&tab=photos`] });
    await flush();
    await click(document.querySelector(`[data-photo="${itineraryId(31)}"] button`));
    expect(document.querySelector('[role="dialog"][aria-labelledby]:not(.activity-dialog [role="dialog"])')).not.toBeNull();
    await click(byText(document, "a", "Ver recuerdo"));
    await click(byText(document, "button", "Volver"));
    await flush();
    expect(list).toHaveBeenCalledTimes(2); // page 1 is asked again on return: no stale snapshot
    const viewer = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) => item.textContent?.includes("Foto 2 de 2"));
    expect(viewer).toBeDefined();
    expect(viewer!.closest(".activity-dialog")).toBeNull();
    expect(viewer!.querySelector("img")!.getAttribute("src")).toContain("/31?");
  });
  it("without history it rebuilds the dialog from the origin and keeps the focus on the memory", async () => {
    const origin: PostOrigin = { path: itineraryPath, search: `?activity=${A}&tab=memories`, label: "actividad", anchor: `data-memory=${ROOT}`, scrollY: 0 };
    await mount({ entries: [{ pathname: `/trips/${T}/memories/${ROOT}`, state: { origin } }] });
    await click(byText(document, "button", "Volver"));
    await flush();
    expect(here).toBe(`${itineraryPath}?activity=${A}&tab=memories`);
    expect(document.querySelector(".activity-dialog")).not.toBeNull();
    expect(document.activeElement).toBe(document.querySelector(`[data-memory="${ROOT}"]`));
    expect(window.scrollTo).not.toHaveBeenCalled(); // the anchor was found: no fallback to the saved scroll
  });
  it("without history it also reopens the viewer from the origin of a photo", async () => {
    const origin: PostOrigin = { path: itineraryPath, search: `?activity=${A}&tab=photos`, label: "actividad", anchor: `data-photo=${itineraryId(31)}`, scrollY: 0, viewer: true };
    await mount({ entries: [{ pathname: `/trips/${T}/memories/${ROOT}`, state: { origin } }] });
    await click(byText(document, "button", "Volver"));
    await flush();
    expect(tab("photos")!.getAttribute("aria-selected")).toBe("true");
    expect(Array.from(document.querySelectorAll('[role="dialog"]')).some((item) => item.textContent?.includes("Foto 2 de 2"))).toBe(true);
  });
  it("a photo that is no longer on page 1 on return closes the viewer without an error", async () => {
    await mount({ entries: [`${itineraryPath}?activity=${A}&tab=photos`], galleries: [chainPhotos(), page([photo(32, CHILD)])] });
    await flush();
    await click(document.querySelector(`[data-photo="${itineraryId(31)}"] button`));
    await click(byText(document, "a", "Ver recuerdo"));
    await click(byText(document, "button", "Volver"));
    await flush();
    expect(photoRows()).toEqual([itineraryId(32)]);
    expect(Array.from(document.querySelectorAll('[role="dialog"]')).some((item) => item.textContent?.includes("Foto "))).toBe(false);
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(0);
    expect(here).toBe(`${itineraryPath}?activity=${A}&tab=photos`);
  });
});

describe("the photo viewer inside the dialog", () => {
  const closeViewer = () => Array.from(document.querySelectorAll("button")).find((item) => item.getAttribute("aria-label") === "Cerrar" && !item.closest(".activity-dialog"));
  const viewerOpen = () => Array.from(document.querySelectorAll('[role="dialog"]')).some((item) => item.textContent?.includes("Foto 1 de"));
  it("closes with a single step back on a double «Cerrar» while the history step is still pending, and the dialog stays open", async () => {
    await mount({ entries: [`${itineraryPath}?activity=${A}&tab=photos`] });
    await flush();
    await click(document.querySelector(`[data-photo="${itineraryId(32)}"] button`));
    expect(viewerOpen()).toBe(true);
    gate.defer = true;
    await act(async () => { closeViewer()!.click(); closeViewer()!.click(); });
    expect(gate.back).toHaveLength(1);
    await act(async () => { gate.back.splice(0).forEach((run) => run()); });
    expect(viewerOpen()).toBe(false);
    expect(here).toBe(`${itineraryPath}?activity=${A}&tab=photos`);
    expect(document.querySelector(".activity-dialog")).not.toBeNull();
    expect(document.activeElement).toBe(document.querySelector(`[data-photo="${itineraryId(32)}"] button`));
  });
  it("Escape closes the viewer only, not the dialog", async () => {
    await mount({ entries: [`${itineraryPath}?activity=${A}&tab=photos`] });
    await flush();
    await click(document.querySelector(`[data-photo="${itineraryId(32)}"] button`));
    await act(async () => { Array.from(document.querySelectorAll('[role="dialog"]')).find((item) => item.textContent?.includes("Foto 1 de"))!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    expect(viewerOpen()).toBe(false);
    expect(document.querySelector(".activity-dialog")).not.toBeNull();
    expect(here).toBe(`${itineraryPath}?activity=${A}&tab=photos`);
  });
});

describe("relink and removal while away", () => {
  it("a memory relinked to another activity while viewing it leaves Recuerdos and Fotos on return, without being deleted", async () => {
    await mount({ itineraries: [{ ok: true, value: itinerary() }, { ok: true, value: itinerary(B) }], galleries: [chainPhotos(), page([])] });
    const container = document.body;
    await click(container.querySelector(`[data-itinerary-item="${A}"] button.activity-title`));
    await flush();
    expect(rows()).toEqual([CHILD, ROOT]);
    await click(document.querySelector(`[data-memory="${ROOT}"] a`));
    await click(byText(document, "button", "Volver"));
    await flush();
    expect(rows()).toEqual([]);
    expect(document.body.textContent).toContain("Todavía no hay recuerdos de esta actividad");
    await click(tab("photos"));
    expect(photoRows()).toEqual([]);
    expect(document.body.textContent).toContain("Todavía no hay fotos de esta actividad");
    // The content is still in the itinerary (now under the other activity): nothing was deleted.
    expect(document.querySelector(`[data-itinerary-post="${ROOT}"]`)).not.toBeNull();
  });
});

describe("«Compartir un recuerdo»", () => {
  it("opens the composer with the activity and comes back to the same dialog", async () => {
    const { container } = await mount({ entries: [memoriesPath, itineraryPath] });
    await openActivity(container);
    await flush();
    await click(byText(document, "a", "Compartir un recuerdo"));
    const probe = JSON.parse(document.querySelector("[data-probe]")!.textContent!);
    expect(probe.pathname).toBe(`${memoriesPath}/new`);
    expect(probe.search).toBe(`?activityId=${A}`);
    expect(probe.state.activityLabel).toBe("Paseo por el centro");
    expect(probe.state.origin).toMatchObject({ path: itineraryPath, search: `?activity=${A}`, label: "actividad" });
    await act(async () => go(-1));
    await flush();
    expect(here).toBe(`${itineraryPath}?activity=${A}`);
    expect(document.querySelector(".activity-dialog")).not.toBeNull();
  });
  it("is available in both tabs", async () => {
    const { container } = await mount();
    await openActivity(container);
    expect(byText(document, "a", "Compartir un recuerdo")).toBeDefined();
    await click(tab("photos"));
    expect(byText(document, "a", "Compartir un recuerdo")).toBeDefined();
  });
});
