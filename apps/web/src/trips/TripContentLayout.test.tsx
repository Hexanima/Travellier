// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useNavigate, type NavigateFunction } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoriesLayout } from "./TripMemoriesScreen.js";
import { TripContentLayout } from "./TripContentLayout.js";
import { itineraryId } from "./itinerary-test-fixture.js";
import { useGalleryPages } from "./use-gallery.js";
import { usePostDraft } from "./use-post-drafts.js";
import { useCommentDraft } from "./use-comment-drafts.js";
import type { PostDraft } from "./post-draft.js";
import type { GalleryPhoto } from "./trip-gallery-api.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
const tripId = itineraryId(1), otherTripId = itineraryId(2), postId = itineraryId(30), activityId = itineraryId(8);
const photo: GalleryPhoto = { id: itineraryId(40), postId, order: 0, uploadedAt: "2026-03-10T10:00:00.000Z", uploaderId: itineraryId(600), url: "https://s3.test/40",
  expiresAtMs: Date.parse("2026-03-10T11:00:00.000Z"), post: { createdAt: "2026-03-10T09:00:00.000Z", authorId: itineraryId(600), rootActivityId: activityId, rootTransportId: null } };

let go: NavigateFunction = () => undefined;
function Nav() { go = useNavigate(); return null; }
function Itinerary() { const gallery = useGalleryPages({ activityId }); return <p data-itinerary>{gallery.phase}:{gallery.photos.length}</p>; }
function Photos() { const gallery = useGalleryPages(); return <p data-photos>{gallery.phase}:{gallery.photos.length}</p>; }
async function mount(list: ReturnType<typeof vi.fn>, withGallery = true, start = `/trips/${tripId}/itinerary`, trips?: { get: ReturnType<typeof vi.fn> }) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  const props = withGallery ? { gallery: { list: list as never, now: () => 0 } } : {};
  await act(async () => root.render(<MemoryRouter initialEntries={[start]}><Nav /><Routes>
    <Route element={<TripContentLayout {...props} trips={trips as never} />}>
      <Route path="/trips/:tripId/itinerary" element={<Itinerary />} />
      <Route path="/trips/:tripId/memories" element={<MemoriesLayout />}>
        <Route path="photos" element={<Photos />} />
        <Route path=":postId" element={<p data-detail>detalle</p>} />
      </Route>
    </Route>
  </Routes></MemoryRouter>));
  return container;
}
const text = (container: HTMLElement, name: string) => container.querySelector(`[data-${name}]`)?.textContent;

describe("TripContentLayout", () => {
  it("shares the gallery snapshots between the itinerary and memories/*: going to a memory and coming back reuses the loaded page", async () => {
    const list = vi.fn().mockResolvedValue({ ok: true, value: { photos: [photo], nextCursor: null } });
    const container = await mount(list);
    expect(text(container, "itinerary")).toBe("idle:1");
    expect(list).toHaveBeenCalledTimes(1);
    await act(async () => go(`/trips/${tripId}/memories/${postId}`));
    expect(text(container, "detail")).toBe("detalle");
    await act(async () => go(`/trips/${tripId}/itinerary`, { state: { photo: photo.id } }));
    expect(text(container, "itinerary")).toBe("idle:1");
    expect(list).toHaveBeenCalledTimes(1); // the snapshot survived the trip through memories/:id
  });
  it("one provider serves both routes: the itinerary snapshot is also visible from the photos route of the same trip (own filter, own key)", async () => {
    const list = vi.fn().mockResolvedValue({ ok: true, value: { photos: [photo], nextCursor: null } });
    const container = await mount(list);
    await act(async () => go(`/trips/${tripId}/memories/photos`));
    expect(text(container, "photos")).toBe("idle:1");
    expect(list).toHaveBeenCalledTimes(2); // another filter (the whole Trip) is another entry: it is requested, not borrowed
    expect(list).toHaveBeenLastCalledWith(tripId, {});
  });
  it("drops the snapshots when moving to another trip", async () => {
    const list = vi.fn().mockResolvedValue({ ok: true, value: { photos: [photo], nextCursor: null } });
    const container = await mount(list);
    await act(async () => go(`/trips/${otherTripId}/memories/${postId}`));
    await act(async () => go(`/trips/${tripId}/itinerary`, { state: { photo: photo.id } }));
    expect(text(container, "itinerary")).toBe("idle:1");
    expect(list).toHaveBeenCalledTimes(2); // not reused: the provider is keyed by trip
  });
  it("asks the Trip name once and shares it between the root screens (shell heading); a detail has no heading", async () => {
    const get = vi.fn().mockResolvedValue({ ok: true, value: { id: tripId, kind: "member", name: "Patagonia" } });
    const container = await mount(vi.fn().mockResolvedValue({ ok: true, value: { photos: [], nextCursor: null } }), true, `/trips/${tripId}/itinerary`, { get });
    expect(container.querySelector("h1")?.textContent).toBe("Patagonia");
    await act(async () => go(`/trips/${tripId}/memories/photos`));
    expect(container.querySelector("h1")?.textContent).toBe("Patagonia");
    await act(async () => go(`/trips/${tripId}/memories/${postId}`));
    expect(container.querySelector("h1")).toBeNull();
    expect(get).toHaveBeenCalledTimes(1);
  });
  it("without a gallery configuration it only renders the child routes", async () => {
    const container = await mount(vi.fn(), false, `/trips/${tripId}/memories/${postId}`);
    await act(async () => go(`/trips/${tripId}/memories/${postId}`));
    expect(text(container, "detail")).toBe("detalle");
  });
});

describe("TripContentLayout drafts", () => {
  const edited = (description: string): PostDraft => ({ values: { description, mapsUrl: "" }, extras: { link: null, transportId: null, newActivity: null, photos: [],
    expense: null, split: { payments: null, shares: null }, removePhotoIds: ["p1"], removeExpense: true } });
  // Stand-ins for the composer (`new`, `edit:<id>`), the detail comment field and the journal; the real shell is in between, so the Outlet changes place.
  function Composer({ name }: { name: string }) {
    const handle = usePostDraft(name);
    return <div data-composer={name}><output data-text>{handle.draft ? handle.draft.values.description : "none"}</output>
      <output data-extras>{handle.draft ? `${handle.draft.extras.removePhotoIds.join(",")}|${handle.draft.extras.removeExpense}` : "none"}</output>
      <output data-blobs>{handle.blobs.ids().join(",") || "none"}</output>
      <button type="button" data-action="write" onClick={() => { handle.setDraft(edited(`texto ${name}`)); handle.blobs.set("foto", new Blob(["x"])); }}>write</button>
      <button type="button" data-action="publish" onClick={handle.clear}>publish</button></div>;
  }
  function Comment() {
    const handle = useCommentDraft("new:post");
    return <div data-comment><output data-text>{handle.text ?? "none"}</output>
      <button type="button" data-action="write" onClick={() => handle.setText("comentario a medias")}>write</button>
      <button type="button" data-action="publish" onClick={handle.clear}>publish</button></div>;
  }
  async function open(start: string) {
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container); roots.push(root);
    await act(async () => root.render(<MemoryRouter initialEntries={[start]}><Nav /><Routes>
      <Route path="/trips/:tripId/config" element={<p data-config>config</p>} />
      <Route element={<TripContentLayout />}>
        <Route path="/trips/:tripId/members" element={<p data-members>grupo</p>} />
        <Route path="/trips/:tripId/memories" element={<MemoriesLayout />}>
          <Route index element={<p data-journal>diario</p>} />
          <Route path="new" element={<Composer name="new" />} />
          <Route path="e/edit" element={<Composer name="edit:e" />} />
          <Route path=":postId" element={<Comment />} />
        </Route>
      </Route>
    </Routes></MemoryRouter>));
    return container;
  }
  const click = (container: HTMLElement, selector: string) => act(async () => { container.querySelector<HTMLElement>(selector)?.click(); });
  const memories = (path = "") => `/trips/${tripId}/memories${path}`;
  const shown = (container: HTMLElement, selector: string) => container.querySelector(`${selector} [data-text]`)?.textContent;

  it("keeps the memory draft, with its photo binaries, when going to the journal and back", async () => {
    const container = await open(memories("/new"));
    await click(container, '[data-composer] [data-action="write"]');
    await act(async () => go(memories()));
    expect(container.querySelector("[data-journal]")).not.toBeNull();
    await act(async () => go(memories("/new")));
    expect(shown(container, "[data-composer]")).toBe("texto new");
    expect(container.querySelector("[data-composer] [data-blobs]")?.textContent).toBe("foto");
  });
  it("keeps an edit draft (removePhotoIds and removeExpense) across the journal", async () => {
    const container = await open(memories("/e/edit"));
    await click(container, '[data-composer] [data-action="write"]');
    await act(async () => go(memories()));
    await act(async () => go(memories("/e/edit")));
    expect(shown(container, "[data-composer]")).toBe("texto edit:e");
    expect(container.querySelector("[data-composer] [data-extras]")?.textContent).toBe("p1|true");
  });
  it("keeps the comment draft when going from the detail to the journal and back", async () => {
    const container = await open(memories(`/${postId}`));
    await click(container, '[data-comment] [data-action="write"]');
    await act(async () => go(memories()));
    await act(async () => go(memories(`/${postId}`)));
    expect(shown(container, "[data-comment]")).toBe("comentario a medias");
  });
  it("keeps the drafts when visiting another screen of the same Trip under the layout", async () => {
    const container = await open(memories("/new"));
    await click(container, '[data-composer] [data-action="write"]');
    await act(async () => go(`/trips/${tripId}/members`));
    await act(async () => go(memories("/new")));
    expect(shown(container, "[data-composer]")).toBe("texto new");
  });
  it("discards the drafts when publishing (clear)", async () => {
    const container = await open(memories("/new"));
    await click(container, '[data-composer] [data-action="write"]');
    await click(container, '[data-composer] [data-action="publish"]');
    expect(shown(container, "[data-composer]")).toBe("none");
    expect(container.querySelector("[data-composer] [data-blobs]")?.textContent).toBe("none");
    await act(async () => go(memories(`/${postId}`)));
    await click(container, '[data-comment] [data-action="write"]');
    await click(container, '[data-comment] [data-action="publish"]');
    expect(shown(container, "[data-comment]")).toBe("none");
  });
  it("discards the drafts (and their binaries) when moving to another Trip", async () => {
    const container = await open(memories("/new"));
    await click(container, '[data-composer] [data-action="write"]');
    await act(async () => go(`/trips/${otherTripId}/memories/new`));
    expect(shown(container, "[data-composer]")).toBe("none");
    expect(container.querySelector("[data-composer] [data-blobs]")?.textContent).toBe("none");
    await act(async () => go(memories("/new")));
    expect(shown(container, "[data-composer]")).toBe("none");
  });
  it("discards the drafts when leaving the Trip routes and coming back", async () => {
    const container = await open(memories("/new"));
    await click(container, '[data-composer] [data-action="write"]');
    await act(async () => go(`/trips/${tripId}/config`));
    expect(container.querySelector("[data-config]")).not.toBeNull();
    await act(async () => go(memories("/new")));
    expect(shown(container, "[data-composer]")).toBe("none");
  });
});
