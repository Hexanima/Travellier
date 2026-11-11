// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TripPhotosScreen } from "./TripPhotosScreen.js";
import { GalleryProvider } from "./use-gallery.js";
import { TripRefreshProvider, useRefreshNow } from "./trip-refresh.js";
import { itineraryId } from "./itinerary-test-fixture.js";
import type { GalleryPage, GalleryPhoto } from "./trip-gallery-api.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); vi.useRealTimers(); });
const tripId = itineraryId(1), me = itineraryId(600);
const NOW = Date.parse("2026-11-10T12:00:00.000Z");
const photo = (n: number, sig = "a"): GalleryPhoto => ({ id: itineraryId(n), postId: itineraryId(500 + n), order: 0, uploadedAt: "2026-11-10T01:30:00.000Z", uploaderId: me,
  url: `https://s3.test/${n}?sig=${sig}`, expiresAtMs: NOW + 300_000, post: { createdAt: "2026-11-10T01:00:00.000Z", authorId: me, rootActivityId: null, rootTransportId: null } });
const page = (photos: GalleryPhoto[], nextCursor: string | null): { ok: true; value: GalleryPage } => ({ ok: true, value: { photos, nextCursor } });
const fail = (kind: string) => ({ ok: false as const, error: { kind } });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
const members = { list: vi.fn() };
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  members.list.mockReset().mockResolvedValue({ ok: true, value: { currentUserId: me, members: [{ id: itineraryId(900), userId: me, name: "Yo", role: "admin", joinedAt: "2026-11-01T10:00:00.000Z" }] } });
});

let where = "";
function Spy() { where = useLocation().pathname; return null; }
function RefreshButton() { const refresh = useRefreshNow(); return <button type="button" data-refresh onClick={() => void refresh()}>Refrescar ahora</button>; }
async function mount(list: ReturnType<typeof vi.fn>) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={[`/trips/${tripId}/memories/photos`]}><Spy />
    <Routes>
      <Route path="/trips" element={<p data-gone>MIS VIAJES</p>} />
      <Route path="/trips/:tripId/memories/photos" element={<TripRefreshProvider tripId={tripId}><GalleryProvider list={list as never} now={() => NOW}>
        <RefreshButton /><TripPhotosScreen members={members as never} timeZone="UTC" /></GalleryProvider></TripRefreshProvider>} />
    </Routes></MemoryRouter>));
  return container;
}
const refresh = () => act(async () => { document.querySelector<HTMLElement>("[data-refresh]")!.click(); });
const thumbs = () => Array.from(document.querySelectorAll("ul.photo-grid > li")).map((item) => item.getAttribute("data-photo"));
const sources = () => Array.from(document.querySelectorAll("ul.photo-grid img")).map((item) => item.getAttribute("src"));
const ids = (...numbers: number[]) => numbers.map(itineraryId);
const loadMore = async () => act(async () => { Array.from(document.querySelectorAll("button")).find((item) => item.textContent === "Cargar más")!.click(); });

describe("photos: silent refresh of the first page", () => {
  it("shows the new photo first and keeps the loaded pages", async () => {
    const list = vi.fn().mockResolvedValueOnce(page([photo(3), photo(2)], "c1")).mockResolvedValueOnce(page([photo(1)], null)).mockResolvedValueOnce(page([photo(4), photo(3), photo(2)], "x"));
    await mount(list);
    await loadMore();
    expect(thumbs()).toEqual(ids(3, 2, 1));
    await refresh();
    expect(thumbs()).toEqual(ids(4, 3, 2, 1));
    expect(document.body.textContent).not.toContain("Cargando fotos");
  });

  it("an identical page changes nothing: same nodes and the same signed urls (no image reload)", async () => {
    const list = vi.fn().mockResolvedValueOnce(page([photo(3), photo(2)], null)).mockResolvedValueOnce(page([photo(3, "b"), photo(2, "b")], null));
    await mount(list);
    const node = document.querySelector("ul.photo-grid > li");
    const before = sources();
    await refresh();
    expect(list).toHaveBeenCalledTimes(2);
    expect(document.querySelector("ul.photo-grid > li")).toBe(node);
    expect(sources()).toEqual(before);
  });

  it("a failure with photos on screen is silent and keeps them", async () => {
    const list = vi.fn().mockResolvedValueOnce(page([photo(3)], null)).mockResolvedValueOnce(fail("network"));
    await mount(list);
    await refresh();
    expect(thumbs()).toEqual(ids(3));
    expect(document.body.textContent).not.toContain("No pudimos renovar");
    expect(document.body.textContent).not.toContain("No pudimos cargar");
  });

  it.each(["forbidden", "not-found"])("%s leads to Mis viajes without photos on screen", async (kind) => {
    const list = vi.fn().mockResolvedValueOnce(page([photo(3)], null)).mockResolvedValueOnce(fail(kind));
    await mount(list);
    await refresh();
    expect(where).toBe("/trips");
    expect(document.querySelector("[data-gone]")).not.toBeNull();
    expect(document.querySelector("img")).toBeNull();
  });

  it("a session failure neither navigates nor wipes the photos", async () => {
    const list = vi.fn().mockResolvedValueOnce(page([photo(3)], null)).mockResolvedValueOnce(fail("unauthorized"));
    await mount(list);
    await refresh();
    expect(document.querySelector("[data-gone]")).toBeNull();
    expect(thumbs()).toEqual(ids(3));
  });

  it("does not duplicate requests: a return to the foreground makes one request, not one per listener", async () => {
    const list = vi.fn().mockResolvedValue(page([photo(3)], null));
    await mount(list);
    expect(list).toHaveBeenCalledTimes(1);
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("focus")); });
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("does not repeat a refresh that is still in flight", async () => {
    const gate = deferred<unknown>();
    const list = vi.fn().mockResolvedValueOnce(page([photo(3)], null)).mockReturnValueOnce(gate.promise);
    await mount(list);
    await refresh(); await refresh();
    expect(list).toHaveBeenCalledTimes(2);
    await act(async () => gate.resolve(page([photo(3)], null)));
  });

  it("waits while the photo viewer is open and catches up once when it closes", async () => {
    vi.useFakeTimers();
    const list = vi.fn().mockResolvedValue(page([photo(3)], null));
    await mount(list);
    await act(async () => { document.querySelector<HTMLElement>(`[data-photo="${itineraryId(3)}"] button`)!.click(); });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    const asked = list.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(list.mock.calls.length).toBe(asked);
    await act(async () => { document.querySelector<HTMLElement>('[role="dialog"] button[aria-label="Cerrar"]')!.click(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(list.mock.calls.length).toBe(asked + 1);
  });
});
