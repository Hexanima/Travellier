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

const T = itineraryId(1), TR = itineraryId(6), TR2 = itineraryId(7), A = itineraryId(8), ROOT = itineraryId(20), CHILD = itineraryId(21), OTHER = itineraryId(22), LATE = itineraryId(23), me = itineraryId(600);
const NOW = Date.parse("2026-09-25T12:00:00.000Z");
const itineraryPath = `/trips/${T}/itinerary`;
const memoriesPath = `/trips/${T}/memories`;

/** Fixture transport TR (outbound) has its own memory (id 11); a chain ROOT -> CHILD hangs from it and one post from the return TR2. */
function itinerary(extra: ((base: TripItineraryResponse) => void) | undefined = undefined): TripItineraryResponse {
  const base = itineraryFixture() as unknown as TripItineraryResponse;
  const make = (id: number, hour: number, description: string) => ({ ...structuredClone(base.posts[0]!), id: itineraryId(id), description, createdAt: `2026-09-25T${hour}:00:00.123Z`, expense: null });
  base.posts = [...base.posts, linkPost(make(20, 11, "Raíz del viaje"), { transportId: TR }),
    linkPost(make(21, 14, "Hija del viaje"), { parentPostId: ROOT, rootPostId: ROOT, rootTransportId: TR }),
    linkPost(make(22, 19, "De la vuelta"), { transportId: TR2 })];
  extra?.(base);
  return base;
}
/** TR crosses midnight (UTC): it is projected in two local days. */
const crossing = (): TripItineraryResponse => itinerary((base) => {
  base.days[0]!.startsAt = "2026-09-25T22:00:00.000Z"; base.days[0]!.endsAt = "2026-09-26T04:00:00.000Z"; base.days[0]!.items = [{ kind: "transport", id: TR, at: "2026-09-25T22:00:00.000Z" }];
  base.transports[0]!.departureAt = "2026-09-25T22:00:00.000Z"; base.transports[0]!.arrivalAt = "2026-09-26T04:00:00.000Z";
  base.days = base.days.filter((day, index) => index === 0 || day.type !== "transit_out");
  base.activities = []; base.days[1]!.items = base.days[1]!.items.filter((item) => item.kind !== "activity");
});
const photo = (n: number, postId: string): GalleryPhoto => ({ id: itineraryId(n), postId, order: 0, uploadedAt: "2026-09-25T13:30:00.000Z", uploaderId: me,
  url: `https://s3.test/${n}?sig=SECRET${n}`, expiresAtMs: NOW + 300_000, post: { createdAt: "2026-09-25T14:00:00.123Z", authorId: me, rootActivityId: null, rootTransportId: TR } });
const page = (photos: GalleryPhoto[]): { ok: true; value: GalleryPage } => ({ ok: true, value: { photos, nextCursor: null } });
const chainPhotos = () => page([photo(32, CHILD), photo(31, ROOT)]);
const members = { list: vi.fn() };

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
type Options = { entries?: Entry[]; itineraries?: unknown[]; galleries?: unknown[]; withMembers?: boolean };
async function mount(options: Options = {}) {
  const itineraries = options.itineraries ?? [{ ok: true, value: itinerary() }];
  const getItinerary = vi.fn().mockImplementation(async () => structuredClone(itineraries[Math.min(getItinerary.mock.calls.length - 1, itineraries.length - 1)]));
  const galleries = options.galleries ?? [chainPhotos()];
  const list = vi.fn().mockImplementation(async () => galleries[Math.min(list.mock.calls.length - 1, galleries.length - 1)]);
  members.list.mockReset().mockResolvedValue({ ok: true, value: { currentUserId: me, members: [{ id: itineraryId(900), userId: me, name: "Yo", role: "admin", joinedAt: "2026-09-01T10:00:00.000Z" }] } });
  const entries = options.entries ?? [itineraryPath];
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}><Spy /><Back />
    <GalleryProvider list={list as never} now={() => NOW}><Routes>
      <Route path="/trips/:tripId/itinerary" element={<TripItineraryScreen itinerary={{ get: getItinerary }} timeZone="UTC"
        activities={{ get: vi.fn(), remove: vi.fn(), create: vi.fn() as never, update: vi.fn() as never }} {...(options.withMembers === false ? {} : { members: members as never })} />} />
      <Route path="/trips/:tripId/memories" element={<p>DIARIO</p>} />
      <Route path="/trips/:tripId/memories/new" element={<Probe />} />
      <Route path="/trips/:tripId/memories/:postId" element={<Detail />} />
    </Routes></GalleryProvider></MemoryRouter>));
  return { container, getItinerary, list };
}
const click = async (element: Element | null | undefined) => { expect(element).toBeTruthy(); await act(async () => element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))); };
const byText = (scope: ParentNode, selector: string, text: string) => Array.from(scope.querySelectorAll(selector)).find((item) => item.textContent === text);
const titleButton = (container: ParentNode, id = TR) => container.querySelector(`[data-itinerary-item="${id}"] button.transport-title`);
const openTransport = (container: HTMLElement) => click(titleButton(container));
const tab = (name: "memories" | "photos") => document.getElementById(`transport-tab-${name}`) as HTMLButtonElement | null;
const rows = () => Array.from(document.querySelectorAll("[data-memory]")).map((item) => item.getAttribute("data-memory"));
const photoRows = () => Array.from(document.querySelectorAll("ul.photo-grid li")).map((item) => item.getAttribute("data-photo"));
const dialogOpen = () => document.querySelector(".transport-dialog") !== null;
const closeDialog = () => click(document.querySelector('.transport-dialog button[aria-label="Cerrar"]'));
const flush = async () => { for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve(); }); };
const statuses = () => Array.from(document.querySelectorAll('[role="status"]')).map((item) => item.textContent ?? "");
const MEMORY_11 = itineraryId(11);

describe("transport dialog in the URL", () => {
  it("opening sets ?transport=<id> by replacing the entry, so Back leaves the itinerary as before", async () => {
    const { container } = await mount({ entries: [memoriesPath, itineraryPath] });
    await openTransport(container);
    expect(here).toBe(`${itineraryPath}?transport=${TR}`);
    expect(dialogOpen()).toBe(true);
    expect(document.querySelector(".transport-dialog h3")!.textContent).toBe("Auto");
    expect(tab("memories")!.getAttribute("aria-selected")).toBe("true");
    await click(document.querySelector('[data-testid="atras"]'));
    expect(here).toBe(memoriesPath);
  });
  it("the title is a button that is disabled while the itinerary refreshes", async () => {
    const { container } = await mount();
    const button = titleButton(container) as HTMLButtonElement;
    expect(button.closest("h4")).not.toBeNull();
    expect(button.disabled).toBe(false);
  });
  it("changing the tab sets &tab= and closing clears transport and tab, both by replacing the entry", async () => {
    const { container } = await mount({ entries: [memoriesPath, itineraryPath] });
    await openTransport(container);
    await click(tab("photos"));
    expect(here).toBe(`${itineraryPath}?transport=${TR}&tab=photos`);
    await click(tab("memories"));
    expect(here).toBe(`${itineraryPath}?transport=${TR}&tab=memories`);
    await click(tab("photos"));
    await closeDialog();
    expect(here).toBe(itineraryPath);
    expect(dialogOpen()).toBe(false);
    await click(document.querySelector('[data-testid="atras"]'));
    expect(here).toBe(memoriesPath);
  });
  it("opening and closing never scrolls", async () => {
    const { container } = await mount();
    await openTransport(container);
    await closeDialog();
    expect(window.scrollTo).not.toHaveBeenCalled();
  });
  it("reloading with the URL opens the dialog in the right tab", async () => {
    await mount({ entries: [`${itineraryPath}?transport=${TR}&tab=photos`] });
    await flush();
    expect(dialogOpen()).toBe(true);
    expect(tab("photos")!.getAttribute("aria-selected")).toBe("true");
    expect(photoRows()).toEqual([itineraryId(32), itineraryId(31)]);
  });
  it("a transport shown in several local days opens the same detail from each", async () => {
    const { container } = await mount({ itineraries: [{ ok: true, value: crossing() }] });
    // One day is shown at a time: the same transport is reached from each day of the strip where it appears.
    const reachedFrom: string[] = [], opened: string[] = [];
    for (const day of Array.from(container.querySelectorAll<HTMLElement>(".itinerary-day-chip"))) {
      await click(day);
      const button = container.querySelector(`[data-itinerary-item="${TR}"] button.transport-title`);
      if (!button) continue;
      reachedFrom.push(day.getAttribute("data-day")!);
      await click(button);
      opened.push(new URLSearchParams(here.split("?")[1]).get("transport")!);
      expect(document.querySelectorAll(".transport-dialog")).toHaveLength(1);
      if (reachedFrom.length < 2) await closeDialog();
    }
    expect(reachedFrom.length).toBeGreaterThan(1);
    expect(new Set(opened)).toEqual(new Set([TR]));
    expect(document.querySelectorAll("[data-transport-day]").length).toBe(2);
  });
  it("an invalid tab opens Recuerdos", async () => {
    await mount({ entries: [`${itineraryPath}?transport=${TR}&tab=otra`] });
    await flush();
    expect(tab("memories")!.getAttribute("aria-selected")).toBe("true");
  });
  it.each([
    ["an invalid id", `?transport=nope`],
    ["an activity together with a transport", `?transport=${TR}&activity=${A}`],
    ["an invalid activity together with a transport", `?transport=${TR}&activity=nope`],
  ])("%s opens nothing and leaves the URL untouched", async (_name, search) => {
    const { getItinerary } = await mount({ entries: [`${itineraryPath}${search}`] });
    await flush();
    expect(dialogOpen()).toBe(false);
    expect(document.querySelector(".activity-dialog")).toBeNull();
    expect(here).toBe(`${itineraryPath}${search}`);
    expect(getItinerary).toHaveBeenCalledTimes(1);
  });
  it("without members the dialog is the detail only: no tabs, no memories", async () => {
    const { container } = await mount({ withMembers: false });
    await openTransport(container);
    expect(dialogOpen()).toBe(true);
    expect(document.querySelector('[role="tablist"]')).toBeNull();
    expect(here).toBe(`${itineraryPath}?transport=${TR}`);
  });
});

describe("memories and photos of the transport", () => {
  it("lists the chain and the memories of this transport only, newest first, and its images in Fotos", async () => {
    const { container, list } = await mount();
    await openTransport(container);
    await flush();
    expect(rows()).toEqual([CHILD, ROOT, MEMORY_11]);
    expect(list).toHaveBeenCalledWith(T, { transportId: TR });
    await click(tab("photos"));
    expect(photoRows()).toEqual([itineraryId(32), itineraryId(31)]);
  });
  it("a memory published after shows up when the itinerary loads again; one of another transport never does", async () => {
    const later = itinerary((base) => { base.posts.push(linkPost({ ...structuredClone(base.posts[0]!), id: LATE, description: "Publicado después", createdAt: "2026-09-25T16:00:00.123Z", expense: null } as never, { transportId: TR }) as never); });
    await mount({ entries: [`${itineraryPath}?transport=${TR}`], itineraries: [{ ok: true, value: itinerary() }] });
    await flush();
    expect(rows()).not.toContain(LATE);
    await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren();
    await mount({ entries: [`${itineraryPath}?transport=${TR}`], itineraries: [{ ok: true, value: later }] });
    await flush();
    expect(rows()).toEqual([LATE, CHILD, ROOT, MEMORY_11]);
    expect(rows()).not.toContain(OTHER);
  });
  it("opening a gallery failure keeps a single alert with Reintentar", async () => {
    const { container, list } = await mount({ galleries: [{ ok: false, error: { kind: "network" } }, chainPhotos()] });
    await openTransport(container);
    await flush();
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(rows()).toEqual([CHILD, ROOT, MEMORY_11]);
    await click(byText(document, "button", "Reintentar"));
    await flush();
    expect(list).toHaveBeenCalledTimes(2);
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(0);
  });
});

describe("a transport that does not exist anymore or an itinerary that is not available", () => {
  it("shows «El transporte ya no existe.», clears the URL before refreshing and refreshes once, without a loop", async () => {
    const missing = itineraryId(77);
    const { getItinerary } = await mount({ entries: [`${itineraryPath}?transport=${missing}&tab=photos`] });
    await flush();
    expect(here).toBe(itineraryPath);
    expect(statuses()).toContain("El transporte ya no existe.");
    expect(getItinerary).toHaveBeenCalledTimes(2);
    await flush();
    expect(getItinerary).toHaveBeenCalledTimes(2);
    expect(dialogOpen()).toBe(false);
  });
  it("a removed transport reached from a refreshed itinerary never opens another resource", async () => {
    const without = itinerary((base) => { base.transports = base.transports.filter((item) => item.id !== TR); });
    const { container, getItinerary } = await mount({ itineraries: [{ ok: true, value: itinerary() }, { ok: true, value: without }], galleries: [{ ok: false, error: { kind: "not-found" } }] });
    await openTransport(container);
    await flush();
    expect(here).toBe(itineraryPath);
    expect(dialogOpen()).toBe(false);
    expect(document.querySelector(".activity-dialog")).toBeNull();
    expect(statuses()).toContain("El transporte ya no existe.");
    expect(getItinerary).toHaveBeenCalledTimes(2);
  });
  it.each(["not-found", "forbidden"])("a %s of the gallery goes through the same path", async (kind) => {
    const { container, getItinerary } = await mount({ galleries: [{ ok: false, error: { kind } }] });
    await openTransport(container);
    await flush();
    expect(here).toBe(itineraryPath);
    expect(statuses()).toContain("El transporte ya no existe.");
    expect(getItinerary).toHaveBeenCalledTimes(2);
    expect(dialogOpen()).toBe(false);
  });
  it.each(["not-found", "forbidden"])("a %s of the itinerary shows it as unavailable and opens no dialog", async (kind) => {
    await mount({ entries: [`${itineraryPath}?transport=${TR}`], itineraries: [{ ok: false, error: { kind } }] });
    await flush();
    expect(document.body.textContent).toContain("Este itinerario no está disponible para tu cuenta.");
    expect(dialogOpen()).toBe(false);
    expect(here).toBe(itineraryPath);
  });
});

describe("opening a memory and coming back", () => {
  it("restores the dialog, the tab and the focus on the memory with a step back", async () => {
    const { container } = await mount();
    await openTransport(container);
    await flush();
    await click(document.querySelector(`[data-memory="${ROOT}"] a`));
    expect(document.querySelector("[data-detail]")).not.toBeNull();
    expect(JSON.parse(document.querySelector("[data-origin]")!.textContent!)).toMatchObject({ path: itineraryPath, search: `?transport=${TR}`, label: "transporte", anchor: `data-memory=${ROOT}` });
    await click(byText(document, "button", "Volver"));
    await flush();
    expect(here).toBe(`${itineraryPath}?transport=${TR}`);
    expect(dialogOpen()).toBe(true);
    expect(tab("memories")!.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(document.querySelector(`[data-memory="${ROOT}"]`));
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });
  it("restores the Fotos tab and the thumbnail it came from", async () => {
    await mount({ entries: [`${itineraryPath}?transport=${TR}&tab=photos`] });
    await flush();
    await click(document.querySelector(`[data-photo="${itineraryId(31)}"] button`));
    await click(byText(document, "a", "Ver recuerdo"));
    expect(JSON.parse(document.querySelector("[data-origin]")!.textContent!)).toMatchObject({ search: `?transport=${TR}&tab=photos`, label: "transporte", viewer: true, anchor: `data-photo=${itineraryId(31)}` });
    await click(byText(document, "button", "Volver"));
    await flush();
    expect(tab("photos")!.getAttribute("aria-selected")).toBe("true");
    expect(Array.from(document.querySelectorAll('[role="dialog"]')).some((item) => item.textContent?.includes("Foto 2 de 2"))).toBe(true);
  });
  it("without history it rebuilds the dialog from the origin and keeps the focus on the memory", async () => {
    const origin: PostOrigin = { path: itineraryPath, search: `?transport=${TR}&tab=memories`, label: "transporte", anchor: `data-memory=${ROOT}`, scrollY: 0 };
    await mount({ entries: [{ pathname: `/trips/${T}/memories/${ROOT}`, state: { origin } }] });
    await click(byText(document, "button", "Volver"));
    await flush();
    expect(here).toBe(`${itineraryPath}?transport=${TR}&tab=memories`);
    expect(dialogOpen()).toBe(true);
    expect(document.activeElement).toBe(document.querySelector(`[data-memory="${ROOT}"]`));
    expect(window.scrollTo).not.toHaveBeenCalled();
  });
});

describe("«Compartir un recuerdo»", () => {
  it("opens the composer with the transport and comes back to the same dialog", async () => {
    const { container } = await mount({ entries: [memoriesPath, itineraryPath] });
    await openTransport(container);
    await flush();
    await click(byText(document, "a", "Compartir un recuerdo"));
    const probe = JSON.parse(document.querySelector("[data-probe]")!.textContent!);
    expect(probe.pathname).toBe(`${memoriesPath}/new`);
    expect(probe.search).toBe(`?transportId=${TR}`);
    expect(probe.state.origin).toMatchObject({ path: itineraryPath, search: `?transport=${TR}`, label: "transporte" });
    await act(async () => go(-1));
    await flush();
    expect(here).toBe(`${itineraryPath}?transport=${TR}`);
    expect(dialogOpen()).toBe(true);
  });
  it("is available in both tabs", async () => {
    const { container } = await mount();
    await openTransport(container);
    expect(byText(document, "a", "Compartir un recuerdo")).toBeDefined();
    await click(tab("photos"));
    expect(byText(document, "a", "Compartir un recuerdo")).toBeDefined();
  });
});
