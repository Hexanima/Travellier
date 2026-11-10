// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useNavigate, type NavigateFunction } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GalleryProvider, useGalleryPages, type GalleryFilter, type GalleryPages } from "./use-gallery.js";
import { itineraryId } from "./itinerary-test-fixture.js";
import type { GalleryPage, GalleryPhoto } from "./trip-gallery-api.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); vi.restoreAllMocks(); });
const tripId = itineraryId(1);
const path = `/trips/${tripId}/memories/photos`;
const NOW = Date.parse("2026-11-10T12:00:00.000Z");
const photo = (n: number, url = `u${n}`, expiresAtMs = NOW + 300_000): GalleryPhoto => ({ id: itineraryId(n), postId: itineraryId(500 + n), order: 0, uploadedAt: "2026-11-10T10:00:00.000Z",
  uploaderId: itineraryId(600), url, expiresAtMs, post: { createdAt: "2026-11-10T09:00:00.000Z", authorId: itineraryId(600), rootActivityId: null, rootTransportId: null } });
const page = (photos: GalleryPhoto[], nextCursor: string | null): { ok: true; value: GalleryPage } => ({ ok: true, value: { photos, nextCursor } });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
const fail = (kind: string) => ({ ok: false as const, error: { kind } });

let api: GalleryPages;
let go: NavigateFunction = () => undefined;
function Probe({ filter, reuse }: { filter?: GalleryFilter; reuse?: boolean }) { api = useGalleryPages(filter, reuse === undefined ? undefined : { reuse }); return <p>{api.photos.length}</p>; }
function Nav() { go = useNavigate(); return null; }
async function mount(list: ReturnType<typeof vi.fn>, options: { state?: unknown; now?: () => number; filter?: GalleryFilter; reuse?: boolean } = {}) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  const now = options.now ?? (() => NOW);
  await act(async () => root.render(<MemoryRouter initialEntries={[{ pathname: path, state: options.state }]}><Nav />
    <GalleryProvider list={list as never} now={now}><Routes>
      <Route path="/trips/:tripId/memories/photos" element={<Probe filter={options.filter} reuse={options.reuse} />} />
      <Route path="/elsewhere" element={<p>otra</p>} />
    </Routes></GalleryProvider></MemoryRouter>));
  return container;
}
const flush = () => act(async () => { await Promise.resolve(); });
const ids = () => api.photos.map((item) => item.id);
const urls = () => api.photos.map((item) => item.url);
/** A fake `list` that records calls and the highest number of requests in flight at once. */
const tracked = (answer: (cursor: string | undefined, call: number) => Promise<unknown> | unknown) => {
  const state = { inFlight: 0, max: 0 };
  const list = vi.fn().mockImplementation(async (_trip: string, query: { cursor?: string }) => {
    state.inFlight += 1; state.max = Math.max(state.max, state.inFlight);
    try { return await answer(query.cursor, list.mock.calls.length); } finally { state.inFlight -= 1; }
  });
  return { list, state };
};

describe("useGalleryPages", () => {
  it("loads the first page keeping the server order and asks with the filter", async () => {
    const list = vi.fn().mockResolvedValue(page([photo(3), photo(2), photo(1)], "c1"));
    await mount(list, { filter: { activityId: itineraryId(8) } });
    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith(tripId, { activityId: itineraryId(8) });
    expect(ids()).toEqual([itineraryId(3), itineraryId(2), itineraryId(1)]);
    expect(api.phase).toBe("idle");
    expect(api.hasMore).toBe(true);
  });
  it("passes only the trip when there is no filter", async () => {
    const list = vi.fn().mockResolvedValue(page([], null));
    await mount(list);
    expect(list).toHaveBeenCalledWith(tripId, {});
    expect(api.hasMore).toBe(false);
    expect(api.photos).toEqual([]);
  });
  it("answers a double «Cargar más» with a single request and appends without repeating ids, in order", async () => {
    const second = deferred<unknown>();
    const list = vi.fn().mockResolvedValueOnce(page([photo(5), photo(4)], "c1")).mockReturnValueOnce(second.promise);
    await mount(list);
    await act(async () => { api.loadMore(); api.loadMore(); });
    await act(async () => { api.loadMore(); });
    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenLastCalledWith(tripId, { cursor: "c1" });
    expect(api.phase).toBe("more-loading");
    await act(async () => second.resolve(page([photo(4, "dup"), photo(3), photo(2)], null)));
    expect(ids()).toEqual([itineraryId(5), itineraryId(4), itineraryId(3), itineraryId(2)]);
    expect(urls()).toEqual(["u5", "u4", "u3", "u2"]);
    expect(api.hasMore).toBe(false);
    await act(async () => api.loadMore());
    expect(list).toHaveBeenCalledTimes(2);
  });
  it("keeps the loaded pages when page 2 fails and retries with the same cursor", async () => {
    const list = vi.fn().mockResolvedValueOnce(page([photo(5)], "c1")).mockResolvedValueOnce(fail("network")).mockResolvedValueOnce(page([photo(4)], null));
    await mount(list);
    await act(async () => api.loadMore());
    expect(api.phase).toBe("more-error");
    expect(api.error).toEqual({ kind: "network" });
    expect(ids()).toEqual([itineraryId(5)]);
    await act(async () => api.retry());
    expect(list).toHaveBeenNthCalledWith(3, tripId, { cursor: "c1" });
    expect(ids()).toEqual([itineraryId(5), itineraryId(4)]);
    expect(api.phase).toBe("idle");
  });
  it("treats a thrown request as a network failure", async () => {
    const list = vi.fn().mockRejectedValue(new Error("boom"));
    await mount(list);
    expect(api.phase).toBe("initial-error");
    expect(api.error).toEqual({ kind: "network" });
  });
  it("retries a failed first page", async () => {
    const list = vi.fn().mockResolvedValueOnce(fail("server")).mockResolvedValueOnce(page([photo(1)], null));
    await mount(list);
    expect(api.phase).toBe("initial-error");
    await act(async () => api.retry());
    expect(ids()).toEqual([itineraryId(1)]);
  });
  it("drops a late answer whose cursor is no longer the current one", async () => {
    const late = deferred<unknown>();
    const list = vi.fn().mockResolvedValueOnce(page([photo(5)], "c1")).mockReturnValueOnce(late.promise).mockResolvedValueOnce(page([photo(9)], "n1"));
    await mount(list);
    await act(async () => api.loadMore());
    await act(async () => api.restart());
    await act(async () => late.resolve(page([photo(4)], null)));
    await flush();
    expect(ids()).toEqual([itineraryId(9)]);
    expect(api.hasMore).toBe(true);
    expect(list).toHaveBeenCalledTimes(3);
  });
  it("reuses the snapshot only when coming back with a restore or an open photo, and a fresh entry asks page 1 again", async () => {
    const list = vi.fn().mockResolvedValue(page([photo(5)], "c1"));
    await mount(list);
    await act(async () => go("/elsewhere"));
    await act(async () => go(path));
    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenLastCalledWith(tripId, {});
    await act(async () => go("/elsewhere"));
    await act(async () => go(path, { state: { photo: itineraryId(5) } }));
    expect(list).toHaveBeenCalledTimes(2);
    expect(ids()).toEqual([itineraryId(5)]);
    expect(api.phase).toBe("idle");
    await act(async () => go("/elsewhere"));
    await act(async () => go(path, { state: { restore: { anchor: `data-photo=${itineraryId(5)}`, scrollY: 3, panel: "photos" } } }));
    expect(list).toHaveBeenCalledTimes(2);
  });
  it("with reuse:false it asks page 1 again even when coming back with a restore or an open photo; the default keeps reusing", async () => {
    const filter = { activityId: itineraryId(8) };
    const list = vi.fn().mockResolvedValue(page([photo(5)], "c1"));
    await mount(list, { filter, reuse: false });
    expect(list).toHaveBeenCalledTimes(1);
    await act(async () => go("/elsewhere"));
    await act(async () => go(path, { state: { photo: itineraryId(5) } }));
    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenLastCalledWith(tripId, filter);
    await act(async () => go("/elsewhere"));
    await act(async () => go(path, { state: { restore: { anchor: `data-photo=${itineraryId(5)}`, scrollY: 3 } } }));
    expect(list).toHaveBeenCalledTimes(3);
    expect(api.phase).toBe("idle");
  });
  it("an activity filter with the default option still reuses its snapshot when coming back with an open photo", async () => {
    const filter = { activityId: itineraryId(8) };
    const list = vi.fn().mockResolvedValue(page([photo(5)], null));
    await mount(list, { filter });
    await act(async () => go("/elsewhere"));
    await act(async () => go(path, { state: { photo: itineraryId(5) } }));
    expect(list).toHaveBeenCalledTimes(1);
    expect(ids()).toEqual([itineraryId(5)]);
  });
  it("shows the snapshot and then refreshes only the expired pages, each with its own cursor, one after another", async () => {
    let clock = NOW;
    const shown: string[][] = [];
    const { list, state } = tracked(async (cursor) => {
      await Promise.resolve();
      if (list.mock.calls.length === 3) shown.push(urls());
      if (cursor === undefined && list.mock.calls.length === 1) return page([photo(5, "a5", NOW + 300_000), photo(4, "a4", NOW + 300_000)], "c1");
      if (cursor === "c1" && list.mock.calls.length === 2) return page([photo(3, "a3", NOW + 100_000)], "c2");
      if (cursor === undefined) return page([photo(5, "b5", clock + 300_000), photo(4, "b4", clock + 300_000), photo(99, "intruder", clock + 300_000)], "other");
      return page([photo(3, "b3", clock + 300_000)], null);
    });
    await mount(list, { now: () => clock });
    await act(async () => api.loadMore());
    expect(list).toHaveBeenCalledTimes(2);
    await act(async () => go("/elsewhere"));
    clock = NOW + 280_000; // page 1 (expires at +300 s) is inside the 30 s margin, page 2 (+100 s) already expired
    await act(async () => go(path, { state: { photo: itineraryId(5) } }));
    await flush(); await flush(); await flush(); await flush();
    expect(list.mock.calls.slice(2).map((call) => call[1])).toEqual([{}, { cursor: "c1" }]);
    expect(state.max).toBe(1);
    expect(shown).toEqual([["a5", "a4", "a3"]]);
    expect(ids()).toEqual([itineraryId(5), itineraryId(4), itineraryId(3)]);
    expect(urls()).toEqual(["b5", "b4", "b3"]);
    expect(api.hasMore).toBe(true);
    await act(async () => api.loadMore());
    expect(list).toHaveBeenLastCalledWith(tripId, { cursor: "c2" });
  });
  it("refreshing page 1 with a photo less and an intruder leaves a coherent state: no duplicates and no expired url kept", async () => {
    let clock = NOW;
    const { list } = tracked(async (cursor, call) => {
      await Promise.resolve();
      if (call === 1) return page([photo(5, "a5", NOW + 300_000), photo(4, "a4", NOW + 300_000), photo(3, "a3", NOW + 300_000)], "c1");
      if (call === 2) return page([photo(2, "a2", NOW + 900_000)], null);
      if (cursor === undefined) return page([photo(99, "intruder", clock + 300_000), photo(5, "b5", clock + 300_000), photo(4, "b4", clock + 300_000)], "other");
      return page([photo(2, "b2", clock + 300_000)], null);
    });
    await mount(list, { now: () => clock });
    await act(async () => api.loadMore());
    await act(async () => go("/elsewhere"));
    clock = NOW + 280_000;
    await act(async () => go(path, { state: { photo: itineraryId(5) } }));
    await flush(); await flush(); await flush();
    expect(ids()).toEqual([itineraryId(5), itineraryId(4), itineraryId(2)]);
    expect(new Set(ids()).size).toBe(ids().length);
    expect(urls()).toEqual(["b5", "b4", "a2"]);
    expect(api.hasMore).toBe(false);
    // The shortened page 1 is no longer stale because of the photo that left: a second return refreshes nothing.
    const calls = list.mock.calls.length;
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await flush();
    expect(list.mock.calls.length).toBe(calls);
  });
  it("marks the photo as failed when the refresh gives back the same url, instead of staying silently broken", async () => {
    const refresh = deferred<unknown>();
    const list = vi.fn().mockResolvedValueOnce(page([photo(5, "same")], null)).mockReturnValueOnce(refresh.promise);
    await mount(list);
    await act(async () => { api.imageError(itineraryId(5)); api.imageError(itineraryId(5)); });
    expect(api.failed.size).toBe(0);
    await act(async () => refresh.resolve(page([photo(5, "same")], null)));
    await flush();
    expect(list).toHaveBeenCalledTimes(2);
    expect([...api.failed]).toEqual([itineraryId(5)]);
    await act(async () => api.imageError(itineraryId(5)));
    expect([...api.failed]).toEqual([itineraryId(5)]);
    expect(list).toHaveBeenCalledTimes(2);
  });
  it("marks the photo as failed when its refresh fails", async () => {
    const list = vi.fn().mockResolvedValueOnce(page([photo(5, "a5")], null)).mockResolvedValueOnce(fail("network"));
    await mount(list);
    await act(async () => api.imageError(itineraryId(5)));
    await flush();
    expect(api.refreshFailed).toBe(true);
    expect([...api.failed]).toEqual([itineraryId(5)]);
  });
  it("«Reintentar» on a failed image forces a real refresh even when the url did not change, and fails again if it still does not load", async () => {
    const list = vi.fn().mockResolvedValue(page([photo(5, "same")], null));
    await mount(list);
    await act(async () => api.imageError(itineraryId(5)));
    await flush();
    expect(api.failed.size).toBe(1);
    await act(async () => api.retryImage(itineraryId(5)));
    expect(api.failed.size).toBe(0);
    await flush();
    expect(list).toHaveBeenCalledTimes(3);
    await act(async () => api.imageError(itineraryId(5)));
    await flush();
    expect(api.failed.size).toBe(1);
    expect(list).toHaveBeenCalledTimes(3);
  });
  it("does not refresh in parallel with «Cargar más»: the refresh waits in the same queue", async () => {
    let clock = NOW;
    const second = deferred<unknown>();
    const { list, state } = tracked((cursor, call) => call === 1 ? page([photo(5, "a5", NOW + 40_000)], "c1") : cursor === "c1" ? second.promise : page([photo(5, "b5", clock + 300_000)], "c1"));
    await mount(list, { now: () => clock });
    await act(async () => api.loadMore());
    expect(list).toHaveBeenCalledTimes(2);
    clock = NOW + 20_000;
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await flush();
    expect(list).toHaveBeenCalledTimes(2);
    expect(state.max).toBe(1);
    await act(async () => second.resolve(page([photo(4, "a4", clock + 300_000)], null)));
    await flush(); await flush();
    expect(list).toHaveBeenCalledTimes(3);
    expect(list).toHaveBeenLastCalledWith(tripId, {});
    expect(state.max).toBe(1);
    expect(urls()).toEqual(["b5", "a4"]);
  });
  it("refreshes expired pages when the window gets the focus again", async () => {
    let clock = NOW;
    const list = vi.fn().mockImplementation(async () => page([photo(5, `u${list.mock.calls.length}`, clock + 300_000)], null));
    await mount(list, { now: () => clock });
    clock = NOW + 100_000;
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(list).toHaveBeenCalledTimes(1);
    clock = NOW + 280_000;
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await flush();
    expect(list).toHaveBeenCalledTimes(2);
    expect(urls()).toEqual(["u2"]);
  });
  it("keeps the old urls and offers a retry when a refresh fails", async () => {
    let clock = NOW;
    const list = vi.fn().mockResolvedValueOnce(page([photo(5, "a5", NOW + 300_000)], null)).mockResolvedValueOnce(fail("server")).mockResolvedValueOnce(page([photo(5, "b5", NOW + 900_000)], null));
    await mount(list, { now: () => clock });
    clock = NOW + 290_000;
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await flush();
    expect(api.refreshFailed).toBe(true);
    expect(urls()).toEqual(["a5"]);
    await act(async () => api.retryRefresh());
    await flush();
    expect(api.refreshFailed).toBe(false);
    expect(urls()).toEqual(["b5"]);
  });
  it("answers an image error with one bounded refresh and then a placeholder", async () => {
    let clock = NOW;
    const list = vi.fn().mockResolvedValueOnce(page([photo(5, "a5"), photo(4, "a4")], null)).mockResolvedValueOnce(page([photo(5, "b5"), photo(4, "b4")], null));
    await mount(list, { now: () => clock });
    await act(async () => { api.imageError(itineraryId(5)); api.imageError(itineraryId(4)); api.imageError(itineraryId(5)); });
    await flush();
    expect(list).toHaveBeenCalledTimes(2);
    expect(urls()).toEqual(["b5", "b4"]);
    expect(api.failed.size).toBe(0);
    clock += 1_000;
    await act(async () => api.imageError(itineraryId(5)));
    expect(list).toHaveBeenCalledTimes(2);
    expect([...api.failed]).toEqual([itineraryId(5)]);
    await act(async () => api.imageError(itineraryId(4)));
    expect([...api.failed].sort()).toEqual([itineraryId(4), itineraryId(5)].sort());
  });
  it("lets the user retry a failed image, which refreshes its page again", async () => {
    const clock = NOW;
    const list = vi.fn().mockImplementation(async () => page([photo(5, `u${list.mock.calls.length}`)], null));
    await mount(list, { now: () => clock });
    await act(async () => api.imageError(itineraryId(5)));
    await flush();
    await act(async () => api.imageError(itineraryId(5)));
    expect(api.failed.size).toBe(1);
    await act(async () => api.retryImage(itineraryId(5)));
    await flush();
    expect(api.failed.size).toBe(0);
    expect(list).toHaveBeenCalledTimes(3);
    expect(urls()).toEqual(["u3"]);
  });
});
