// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useNavigate, type NavigateFunction } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.js";
import { itineraryId } from "./trips/itinerary-test-fixture.js";
import type { GalleryPhoto } from "./trips/trip-gallery-api.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); vi.unstubAllGlobals(); });
const storage = () => ({ read: vi.fn().mockResolvedValue({ accessToken: "old", refreshToken: "refresh" }), save: vi.fn().mockResolvedValue(undefined), clear: vi.fn().mockResolvedValue(undefined) });
const auth = { refresh: vi.fn().mockResolvedValue({ ok: true, value: { accessToken: "access", refreshToken: "refresh" } }) };
const tripId = itineraryId(1);
const me = itineraryId(20);
const base = `/trips/${tripId}/memories`;
const photo = (n: number): GalleryPhoto => ({ id: itineraryId(n), postId: itineraryId(500 + n), order: 0, uploadedAt: "2026-11-10T10:00:00.000Z", uploaderId: me,
  url: `https://s3.test/${n}?sig=x`, expiresAtMs: Date.parse("2100-01-01T00:00:00.000Z"),
  post: { createdAt: "2026-11-10T09:00:00.000Z", authorId: me, rootActivityId: null, rootTransportId: null } });
const detailOf = (id: string) => ({ ok: true, value: { post: { id, tripId, authorId: me, description: "Recuerdo", mapsUrl: null, activityId: null, parentPostId: null, transportId: null, createdAt: "2026-11-10T09:00:00.000Z" },
  parent: null, children: [], rootActivityId: null } });
const members = { list: vi.fn().mockResolvedValue({ ok: true, value: { currentUserId: me, members: [] } }) };
const props = (over: Partial<ComponentProps<typeof App>> = {}): ComponentProps<typeof App> => ({ auth, sessionStorage: storage(), members,
  posts: { list: vi.fn().mockResolvedValue({ ok: true, value: [] }), get: vi.fn().mockImplementation(async (_trip: string, id: string) => detailOf(id)) },
  gallery: { list: vi.fn().mockResolvedValue({ ok: true, value: { photos: [photo(3), photo(2)], nextCursor: null } }) }, ...over });
let go: NavigateFunction = () => undefined;
function Nav() { go = useNavigate(); return null; }
type Entry = string | { pathname: string; state?: unknown };
async function render(entry: Entry | Entry[], app: ComponentProps<typeof App>) {
  const entries = Array.isArray(entry) ? entry : [entry];
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}><Nav /><App {...app} /></MemoryRouter>));
  return container;
}
// Inside the Trip shell the Trip name is the h1 and the screen heading an h2; outside it the screen heading is the h1.
const title = (container: HTMLElement) => (container.querySelector(".trip-shell-header") ? container.querySelector("main h2") : container.querySelector("h1"))?.textContent;
const dialog = () => document.querySelector('[role="dialog"]');
const closeViewer = () => click(document.querySelector('[aria-label="Cerrar"]'));
const click = async (element: Element | null | undefined) => { expect(element).toBeTruthy(); await act(async () => element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }))); };
const named = (selector: string, text: string, root: ParentNode = document) => Array.from(root.querySelectorAll(selector)).find((item) => item.textContent === text);
const thumb = (container: HTMLElement, n: number) => container.querySelector(`[data-photo="${itineraryId(n)}"] button`);

describe("App gallery integration", () => {
  it("goes from the diary to the gallery, opens the viewer and the memory, and back to the same photo without asking again", async () => {
    const app = props();
    const container = await render(base, app);
    await click(named("button", "Fotos", container));
    expect(container.querySelector("main h2")?.textContent).toBe("Fotos");
    expect(Array.from(container.querySelectorAll("ul.photo-grid > li")).map((item) => item.getAttribute("data-photo"))).toEqual([itineraryId(3), itineraryId(2)]);
    await click(thumb(container, 2));
    expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe("Foto 2 de 2");
    await click(named("a", "Ver recuerdo"));
    expect(app.posts!.get).toHaveBeenCalledWith(tripId, itineraryId(502));
    expect(container.querySelector("h1")?.textContent).toBe("Recuerdo");
    await click(named("button", "Volver", container));
    expect(container.querySelector("main h2")?.textContent).toBe("Fotos");
    expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe("Foto 2 de 2");
    expect(Array.from(container.querySelectorAll("ul.photo-grid > li"))).toHaveLength(2);
    expect(app.gallery!.list).toHaveBeenCalledTimes(1);
    await click(document.querySelector('[aria-label="Cerrar"]'));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(thumb(container, 2));
  });
  it("opens a memory by deep link with origin photos and goes back to the gallery", async () => {
    const app = props();
    const origin = { path: `${base}/photos`, label: "fotos", anchor: `data-photo=${itineraryId(2)}`, scrollY: 0 };
    const container = await render({ pathname: `${base}/${itineraryId(502)}`, state: { origin } }, app);
    expect(container.querySelector("h1")?.textContent).toBe("Recuerdo");
    await click(named("a", "Volver a las fotos", container));
    expect(container.querySelector("main h2")?.textContent).toBe("Fotos");
    expect(Array.from(container.querySelectorAll("ul.photo-grid > li"))).toHaveLength(2);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(app.gallery!.list).toHaveBeenCalledTimes(1);
  });
  it("reopens the viewer on the photo when the origin came from it", async () => {
    const app = props();
    const origin = { path: `${base}/photos`, label: "fotos", anchor: `data-photo=${itineraryId(2)}`, scrollY: 0, viewer: true };
    const container = await render({ pathname: `${base}/${itineraryId(502)}`, state: { origin } }, app);
    await click(named("a", "Volver a las fotos", container));
    expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe("Foto 2 de 2");
  });
  it("grid, viewer, close: one entry back to the grid and then out of the Trip (the tabs replace the entry), with no loop", async () => {
    const container = await render(["/trips", base], props());
    await click(named("button", "Fotos", container));
    await click(thumb(container, 2));
    expect(dialog()).not.toBeNull();
    await closeViewer();
    expect(dialog()).toBeNull();
    expect(title(container)).toBe("Fotos");
    await act(async () => go(-1));
    expect(title(container)).not.toBe("Fotos");
    expect(container.querySelector('[role=tablist][aria-label="Secciones del viaje"]')).toBeNull(); // Back from the Fotos tab leaves to Mis viajes, not to the Posts tab
  });
  it("grid, viewer, «Ver recuerdo», back, viewer reopened, close: lands on the grid", async () => {
    const container = await render(["/trips", base], props());
    await click(named("button", "Fotos", container));
    await click(thumb(container, 2));
    await click(named("a", "Ver recuerdo"));
    await click(named("button", "Volver", container));
    expect(dialog()).not.toBeNull();
    await closeViewer();
    expect(dialog()).toBeNull();
    expect(title(container)).toBe("Fotos");
    await act(async () => go(-1));
    expect(title(container)).not.toBe("Fotos");
    expect(title(container)).not.toBe("Recuerdo");
  });
  it("deep link detail with the viewer origin: «Volver a las fotos», viewer, close stays on the grid and not on the detail", async () => {
    const origin = { path: `${base}/photos`, label: "fotos", anchor: `data-photo=${itineraryId(2)}`, scrollY: 0, viewer: true };
    const container = await render({ pathname: `${base}/${itineraryId(502)}`, state: { origin } }, props());
    await click(named("a", "Volver a las fotos", container));
    expect(dialog()).not.toBeNull();
    await closeViewer();
    expect(dialog()).toBeNull();
    expect(title(container)).toBe("Fotos");
    expect(Array.from(container.querySelectorAll("ul.photo-grid > li"))).toHaveLength(2);
    // The history is [detail, grid]: nothing extra was pushed by closing.
    await act(async () => go(-1));
    expect(title(container)).toBe("Recuerdo");
    await act(async () => go(-1));
    expect(title(container)).toBe("Recuerdo");
    await act(async () => go(1));
    expect(title(container)).toBe("Fotos");
    expect(dialog()).toBeNull();
  });
  it("deep link detail without history: «Volver» reopens the viewer and closing it stays on the grid", async () => {
    const origin = { path: `${base}/photos`, label: "fotos", anchor: `data-photo=${itineraryId(2)}`, scrollY: 0, viewer: true };
    const container = await render({ pathname: `${base}/${itineraryId(502)}`, state: { origin } }, props());
    await click(named("button", "Volver", container));
    expect(dialog()?.querySelector("h2")?.textContent).toBe("Foto 2 de 2");
    await closeViewer();
    expect(dialog()).toBeNull();
    expect(title(container)).toBe("Fotos");
    await act(async () => go(-1));
    expect(title(container)).toBe("Recuerdo");
    await act(async () => go(1));
    expect(title(container)).toBe("Fotos");
    expect(dialog()).toBeNull();
  });
  it("does not take the static photos route as a post id", async () => {
    const app = props();
    const container = await render(`${base}/photos`, app);
    expect(container.querySelector("main h2")?.textContent).toBe("Fotos");
    expect(app.posts!.get).not.toHaveBeenCalled();
    expect(app.gallery!.list).toHaveBeenCalledWith(tripId, {});
  });
  it("without a wired gallery falls back to a server error with a retry", async () => {
    const container = await render(`${base}/photos`, props({ gallery: undefined }));
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(container.textContent).toContain("No pudimos cargar las fotos");
    await click(named("button", "Reintentar", container));
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
  });
});
