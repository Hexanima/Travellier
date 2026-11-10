// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TransportMemories } from "./TransportMemories.js";
import { GalleryProvider } from "./use-gallery.js";
import { itineraryId } from "./itinerary-test-fixture.js";
import type { ActivityTab } from "./activity-memories.js";
import type { GalleryPage, GalleryPhoto } from "./trip-gallery-api.js";
import type { ItineraryPostResponse } from "./trip-itinerary-api.js";

const openPost = vi.hoisted(() => vi.fn());
vi.mock("./open-post.js", () => ({ openPostFrom: openPost }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); openPost.mockReset(); vi.restoreAllMocks(); });
const tripId = itineraryId(1), transportId = itineraryId(6), otherTransport = itineraryId(7), activityId = itineraryId(8), me = itineraryId(600);
const NOW = Date.parse("2026-11-10T12:00:00.000Z");

const post = (n: number, createdAt: string, o: { rootTransportId?: string | null; rootActivityId?: string | null; parentPostId?: string | null; description?: string | null } = {}): ItineraryPostResponse => {
  const rootTransportId = o.rootTransportId === undefined ? transportId : o.rootTransportId, rootActivityId = o.rootActivityId ?? null;
  return { id: itineraryId(n), description: o.description === undefined ? `Recuerdo ${n}` : o.description, createdAt,
    context: { parentPostId: o.parentPostId ?? null, rootPostId: itineraryId(n), rootActivityId, rootTransportId,
      placement: rootActivityId ? "activity" : rootTransportId ? "transport" : "independent" } } as unknown as ItineraryPostResponse;
};
const photo = (n: number, forPost: ItineraryPostResponse, order = 0): GalleryPhoto => ({ id: itineraryId(n), postId: forPost.id, order, uploadedAt: "2026-03-10T13:30:00.000Z", uploaderId: me,
  url: `https://s3.test/${n}?sig=SECRET${n}`, expiresAtMs: NOW + 300_000, post: { createdAt: forPost.createdAt, authorId: me, rootActivityId: null, rootTransportId: transportId } });
const page = (photos: GalleryPhoto[], nextCursor: string | null): { ok: true; value: GalleryPage } => ({ ok: true, value: { photos, nextCursor } });
const fail = (kind: string) => ({ ok: false as const, error: { kind } });
const members = { list: vi.fn() };
beforeEach(() => { members.list.mockReset().mockResolvedValue({ ok: true, value: { currentUserId: me, members: [{ id: itineraryId(900), userId: me, name: "Yo", role: "admin", joinedAt: "2026-11-01T10:00:00.000Z" }] } }); });

const p1 = post(11, "2026-03-10T15:00:00.000Z");
const p2 = post(12, "2026-03-10T12:00:00.000Z", { parentPostId: p1.id });
const p3 = post(13, "2020-01-01T09:00:00.000Z", { description: null, rootActivityId: activityId });
const elsewhere = post(14, "2026-03-10T16:00:00.000Z", { rootTransportId: otherTransport });
const independent = post(15, "2026-03-10T17:00:00.000Z", { rootTransportId: null });

type MountOptions = { tab?: ActivityTab; onGone?: () => void; search?: string };
const tabCalls: ActivityTab[] = [];
let here = "";
function Spy() { const location = useLocation(); here = `${location.pathname}${location.search}`; return null; }
function Host({ options }: { options: MountOptions }) {
  const [tab, setTab] = useState<ActivityTab>(options.tab ?? "memories");
  return <TransportMemories tripId={tripId} transportId={transportId} itinerary={{ posts: [p3, p1, elsewhere, independent], unplacedPosts: [p2] }}
    members={members as never} timeZone="UTC" tab={tab} onTab={(next) => { tabCalls.push(next); setTab(next); }} onGone={options.onGone ?? (() => undefined)} onSettled={() => undefined} />;
}
async function mount(list: ReturnType<typeof vi.fn>, options: MountOptions = {}) {
  tabCalls.length = 0;
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={[`/trips/${tripId}/itinerary?transport=${transportId}&tab=${options.tab ?? "memories"}`]}><Spy />
    <GalleryProvider list={list as never} now={() => NOW}><Routes>
      <Route path="/trips/:tripId/itinerary" element={<Host options={options} />} />
    </Routes></GalleryProvider></MemoryRouter>));
  return container;
}
const standard = () => vi.fn().mockResolvedValue(page([photo(21, p1, 0), photo(22, p1, 1), photo(23, p3, 0)], null));
const click = async (element: Element | null | undefined) => { expect(element).toBeTruthy(); await act(async () => element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))); };
const key = (element: Element, name: string) => act(async () => { element.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })); });
const tabButton = (name: "memories" | "photos") => document.getElementById(`transport-tab-${name}`) as HTMLButtonElement;
const memoryRows = (container: ParentNode) => Array.from(container.querySelectorAll("[data-memory]")).map((item) => item.getAttribute("data-memory"));
const alertTexts = () => Array.from(document.querySelectorAll('[role="alert"]')).map((item) => item.textContent);

describe("TransportMemories", () => {
  it("asks the gallery with transportId only, never activityId", async () => {
    const list = standard();
    await mount(list);
    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith(tripId, { transportId });
  });
  it("lists the memories of this transport (also with an activity, outside the trip dates, unplaced), newest first, without other transports or independent posts", async () => {
    const container = await mount(standard());
    expect(memoryRows(container)).toEqual([p1.id, p2.id, p3.id]);
    expect(container.querySelector('ul[aria-label="Recuerdos del transporte"]')).not.toBeNull();
    const rows = Array.from(container.querySelectorAll("[data-memory]")) as HTMLElement[];
    expect(rows[1]!.textContent).toContain("Continuación de otro recuerdo");
    expect(rows[2]!.textContent).toContain("Recuerdo sin texto.");
    expect(container.querySelectorAll("[data-memory] img")).toHaveLength(2);
  });
  it("shows the empty states", async () => {
    const container = await mount(vi.fn().mockResolvedValue(page([], null)), { tab: "photos" });
    expect(container.textContent).toContain("Todavía no hay fotos de este transporte");
  });
  it("the link opens the post with label «transporte»", async () => {
    const container = await mount(standard());
    await click(container.querySelector(`[data-memory="${p1.id}"] a`));
    expect(openPost.mock.calls[0]![2]).toEqual({ tripId, postId: p1.id, anchor: `data-memory=${p1.id}`, label: "transporte" });
  });
  it("«Ver recuerdo» from the viewer opens the post with label «transporte» and the viewer mark", async () => {
    const container = await mount(standard(), { tab: "photos" });
    expect(list_grid(container)).toEqual([itineraryId(21), itineraryId(22), itineraryId(23)]);
    await click(container.querySelector(`[data-photo="${itineraryId(23)}"] button`));
    await click(Array.from(document.querySelectorAll("a")).find((item) => item.textContent === "Ver recuerdo"));
    expect(openPost.mock.calls[0]![2]).toEqual({ tripId, postId: p3.id, anchor: `data-photo=${itineraryId(23)}`, label: "transporte", viewer: true });
  });
  it("«Compartir un recuerdo» goes to the composer with transportId and the origin of the current entry, outside the panel", async () => {
    const container = await mount(standard());
    const link = Array.from(container.querySelectorAll("a")).find((item) => item.textContent === "Compartir un recuerdo")!;
    expect(link.getAttribute("href")).toBe(`/trips/${tripId}/memories/new?transportId=${transportId}`);
    expect((container.querySelector("#transport-panel-memories") as HTMLElement).contains(link)).toBe(false);
    expect(Array.from(container.querySelectorAll("button")).some((item) => item.textContent === "Vincular a")).toBe(false);
    expect(here).toBe(`/trips/${tripId}/itinerary?transport=${transportId}&tab=memories`);
  });
  it("has labelled tabs with itinerant tabindex and keyboard navigation", async () => {
    const container = await mount(standard());
    const tabs = Array.from(container.querySelectorAll('[role="tab"]')) as HTMLButtonElement[];
    expect(tabs.map((item) => item.id)).toEqual(["transport-tab-memories", "transport-tab-photos"]);
    expect(tabs.map((item) => item.tabIndex)).toEqual([0, -1]);
    tabButton("memories").focus();
    await key(tabButton("memories"), "ArrowRight");
    expect(tabCalls).toEqual(["photos"]);
    expect(document.activeElement).toBe(tabButton("photos"));
    await key(tabButton("photos"), "Home");
    expect(tabCalls.at(-1)).toBe("memories");
    await key(tabButton("memories"), "End");
    expect(tabCalls.at(-1)).toBe("photos");
  });
  it("one gallery feeds both tabs: switching does not ask again", async () => {
    const list = standard();
    await mount(list);
    await click(tabButton("photos"));
    expect(list).toHaveBeenCalledTimes(1);
  });
  it("«Cargar más fotos» uses aria-disabled while loading and keeps the focus", async () => {
    let resolveSecond!: (value: unknown) => void;
    const second = new Promise((resolve) => { resolveSecond = resolve; });
    const list = vi.fn().mockResolvedValueOnce(page([photo(21, p1, 0)], "c1")).mockReturnValueOnce(second);
    const container = await mount(list);
    const more = () => Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "Cargar más fotos") as HTMLButtonElement;
    more().focus();
    await click(more());
    expect(more().getAttribute("aria-disabled")).toBe("true");
    expect(more().disabled).toBe(false);
    expect(document.activeElement).toBe(more());
    await click(more());
    expect(list).toHaveBeenCalledTimes(2);
    await act(async () => resolveSecond(page([photo(23, p3, 0)], null)));
    expect(container.contains(document.activeElement) && document.activeElement !== document.body).toBe(true);
  });
  it("a gallery failure keeps the memories and raises a single alert, whichever tab", async () => {
    const container = await mount(vi.fn().mockResolvedValue(fail("network")));
    expect(memoryRows(container)).toEqual([p1.id, p2.id, p3.id]);
    expect(alertTexts()).toHaveLength(1);
    await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren();
    await mount(vi.fn().mockResolvedValue(fail("network")), { tab: "photos" });
    expect(alertTexts()).toHaveLength(1);
  });
  it("404 and 403 call onGone once, with no alert", async () => {
    for (const kind of ["not-found", "forbidden"]) {
      const gone = vi.fn();
      await mount(vi.fn().mockResolvedValue(fail(kind)), { onGone: gone });
      expect(gone).toHaveBeenCalledTimes(1);
      expect(alertTexts()).toHaveLength(0);
      await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren();
    }
  });
});

const list_grid = (container: ParentNode) => Array.from(container.querySelectorAll("ul.photo-grid li")).map((item) => item.getAttribute("data-photo"));
