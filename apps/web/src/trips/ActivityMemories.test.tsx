// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityMemories } from "./ActivityMemories.js";
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
const tripId = itineraryId(1), activityId = itineraryId(8), otherActivity = itineraryId(9), me = itineraryId(600);
const NOW = Date.parse("2026-11-10T12:00:00.000Z");
const BA = "America/Argentina/Buenos_Aires";

type PostOptions = { createdAt: string; description?: string | null; parentPostId?: string | null; rootActivityId?: string | null; placement?: "activity" | "transport" | "independent" };
const post = (n: number, o: PostOptions): ItineraryPostResponse => {
  const rootActivityId = o.rootActivityId === undefined ? activityId : o.rootActivityId;
  return { id: itineraryId(n), description: o.description === undefined ? `Recuerdo ${n}` : o.description, createdAt: o.createdAt,
    context: { parentPostId: o.parentPostId ?? null, rootPostId: itineraryId(n), rootActivityId, rootTransportId: null, placement: o.placement ?? (rootActivityId ? "activity" : "independent") } } as unknown as ItineraryPostResponse;
};
const photo = (n: number, forPost: ItineraryPostResponse, order = 0): GalleryPhoto => ({ id: itineraryId(n), postId: forPost.id, order, uploadedAt: "2026-03-10T13:30:00.000Z", uploaderId: me,
  url: `https://s3.test/${n}?sig=SECRET${n}`, expiresAtMs: NOW + 300_000, post: { createdAt: forPost.createdAt, authorId: me, rootActivityId: activityId, rootTransportId: null } });
const page = (photos: GalleryPhoto[], nextCursor: string | null): { ok: true; value: GalleryPage } => ({ ok: true, value: { photos, nextCursor } });
const fail = (kind: string) => ({ ok: false as const, error: { kind } });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
const members = { list: vi.fn() };
beforeEach(() => { members.list.mockReset().mockResolvedValue({ ok: true, value: { currentUserId: me, members: [{ id: itineraryId(900), userId: me, name: "Yo", role: "admin", joinedAt: "2026-11-01T10:00:00.000Z" }] } }); });

// Newest first: p1 (15:00Z) has two photos, p2 (12:00Z) is a continuation of p1 with no photo, p3 (09:00Z) has a photo and no text.
const p1 = post(11, { createdAt: "2026-03-10T15:00:00.000Z" });
const p2 = post(12, { createdAt: "2026-03-10T12:00:00.000Z", parentPostId: p1.id });
const p3 = post(13, { createdAt: "2026-03-10T09:00:00.000Z", description: null });
const elsewhere = post(14, { createdAt: "2026-03-10T16:00:00.000Z", rootActivityId: otherActivity });
const independent = post(15, { createdAt: "2026-03-10T17:00:00.000Z", rootActivityId: null });
const placed = [p3, p1, elsewhere, independent];

type MountOptions = { tab?: ActivityTab; posts?: ItineraryPostResponse[]; unplaced?: ItineraryPostResponse[]; onGone?: () => void; onSettled?: () => void; timeZone?: string };
const tabCalls: ActivityTab[] = [];
let here = "";
function Spy() { const location = useLocation(); here = `${location.pathname}${location.search}`; return null; }
function Host({ options }: { options: MountOptions }) {
  const [tab, setTab] = useState<ActivityTab>(options.tab ?? "memories");
  return <ActivityMemories tripId={tripId} activityId={activityId} activityTitle="Paseo por el centro" itinerary={{ posts: options.posts ?? placed, unplacedPosts: options.unplaced ?? [p2] }}
    members={members as never} timeZone={options.timeZone ?? "UTC"} tab={tab} onTab={(next) => { tabCalls.push(next); setTab(next); }} onGone={options.onGone ?? (() => undefined)} onSettled={options.onSettled ?? (() => undefined)} />;
}
async function mount(list: ReturnType<typeof vi.fn>, options: MountOptions = {}) {
  tabCalls.length = 0;
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={[`/trips/${tripId}/itinerary?activity=${activityId}&tab=${options.tab ?? "memories"}`]}><Spy />
    <GalleryProvider list={list as never} now={() => NOW}><Routes>
      <Route path="/trips/:tripId/itinerary" element={<Host options={options} />} />
      <Route path="/login" element={<p>LOGIN</p>} />
    </Routes></GalleryProvider></MemoryRouter>));
  return container;
}
const standard = () => vi.fn().mockResolvedValue(page([photo(21, p1, 0), photo(22, p1, 1), photo(23, p3, 0)], null));
const click = async (element: Element | null | undefined) => { expect(element).toBeTruthy(); await act(async () => element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))); };
const key = (element: Element, name: string) => act(async () => { element.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })); });
const tabButton = (name: "memories" | "photos") => document.getElementById(`activity-tab-${name}`) as HTMLButtonElement;
const memoryRows = (container: ParentNode) => Array.from(container.querySelectorAll("[data-memory]")).map((item) => item.getAttribute("data-memory"));
const alertTexts = () => Array.from(document.querySelectorAll('[role="alert"]')).map((item) => item.textContent);

describe("ActivityMemories tabs", () => {
  it("opens on Recuerdos with a labelled tablist, itinerant tabindex and the other panel hidden", async () => {
    const container = await mount(standard());
    expect(container.querySelector('[role="tablist"]')).not.toBeNull();
    const tabs = Array.from(container.querySelectorAll('[role="tab"]')) as HTMLButtonElement[];
    expect(tabs.map((item) => item.id)).toEqual(["activity-tab-memories", "activity-tab-photos"]);
    expect(tabs.map((item) => item.getAttribute("aria-selected"))).toEqual(["true", "false"]);
    expect(tabs.map((item) => item.tabIndex)).toEqual([0, -1]);
    expect(tabs.map((item) => item.textContent)).toEqual(["Recuerdos", "Fotos"]);
    const panels = Array.from(container.querySelectorAll('[role="tabpanel"]')) as HTMLElement[];
    expect(panels).toHaveLength(2);
    expect(tabs.map((item) => item.getAttribute("aria-controls"))).toEqual(panels.map((item) => item.id));
    expect(panels.map((item) => item.getAttribute("aria-labelledby"))).toEqual(["activity-tab-memories", "activity-tab-photos"]);
    expect(panels.map((item) => item.hidden)).toEqual([false, true]);
    expect(container.querySelector('ul[aria-label="Recuerdos de la actividad"]')).not.toBeNull();
  });
  it("Fotos selected shows its panel and hides Recuerdos", async () => {
    const container = await mount(standard(), { tab: "photos" });
    const panels = Array.from(container.querySelectorAll('[role="tabpanel"]')) as HTMLElement[];
    expect(panels.map((item) => item.hidden)).toEqual([true, false]);
    expect(tabButton("photos").getAttribute("aria-selected")).toBe("true");
    expect(tabButton("photos").tabIndex).toBe(0);
    expect(tabButton("memories").tabIndex).toBe(-1);
  });
  it("clicking a tab asks for it", async () => {
    const container = await mount(standard());
    await click(tabButton("photos"));
    expect(tabCalls).toEqual(["photos"]);
    expect(tabButton("photos").getAttribute("aria-selected")).toBe("true");
    expect((container.querySelector("#activity-panel-photos") as HTMLElement).hidden).toBe(false);
  });
  it("arrows, Home and End move between the tabs and put the focus on the new one", async () => {
    await mount(standard());
    tabButton("memories").focus();
    await key(tabButton("memories"), "ArrowRight");
    expect(tabCalls).toEqual(["photos"]);
    expect(document.activeElement).toBe(tabButton("photos"));
    await key(tabButton("photos"), "ArrowRight"); // wraps
    expect(tabCalls).toEqual(["photos", "memories"]);
    expect(document.activeElement).toBe(tabButton("memories"));
    await key(tabButton("memories"), "ArrowLeft"); // wraps back
    expect(tabCalls.at(-1)).toBe("photos");
    await key(tabButton("photos"), "Home");
    expect(tabCalls.at(-1)).toBe("memories");
    expect(document.activeElement).toBe(tabButton("memories"));
    await key(tabButton("memories"), "End");
    expect(tabCalls.at(-1)).toBe("photos");
    expect(document.activeElement).toBe(tabButton("photos"));
  });
});

describe("ActivityMemories (Recuerdos)", () => {
  it("lists the descendants and the unplaced ones of this activity, newest first, without other activities or independent posts", async () => {
    const container = await mount(standard());
    expect(memoryRows(container)).toEqual([p1.id, p2.id, p3.id]);
  });
  it("shows the text or «Recuerdo sin texto.», the publication date in the given time zone and the continuation mark", async () => {
    const container = await mount(standard(), { timeZone: BA });
    const rows = Array.from(container.querySelectorAll("[data-memory]")) as HTMLElement[];
    expect(rows[0]!.textContent).toContain("Recuerdo 11");
    expect(rows[0]!.textContent).not.toContain("Continuación de otro recuerdo");
    expect(rows[1]!.textContent).toContain("Continuación de otro recuerdo");
    expect(rows[2]!.textContent).toContain("Recuerdo sin texto.");
    expect(rows[0]!.querySelector("time")!.getAttribute("datetime")).toBe(p1.createdAt);
    expect(rows[0]!.querySelector("time")!.textContent).toContain("12:00");
    expect(rows.every((item) => item.tabIndex === -1)).toBe(true);
  });
  it("shows the first photo of each post as an empty-alt thumbnail inside the link, and no image for a text-only post", async () => {
    const container = await mount(standard());
    const [first, second, third] = Array.from(container.querySelectorAll("[data-memory]")) as HTMLElement[];
    const img = first!.querySelector("a img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe(photo(21, p1).url);
    expect(img.getAttribute("alt")).toBe("");
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(second!.querySelector("img")).toBeNull();
    expect((third!.querySelector("a img") as HTMLImageElement).getAttribute("src")).toBe(photo(23, p3).url);
    expect(container.querySelectorAll('[data-memory] img')).toHaveLength(2);
  });
  it("the link opens the post from the activity with its anchor and the label «actividad»", async () => {
    const container = await mount(standard());
    await click(container.querySelector(`[data-memory="${p1.id}"] a`));
    expect(openPost).toHaveBeenCalledTimes(1);
    expect(openPost.mock.calls[0]![2]).toEqual({ tripId, postId: p1.id, anchor: `data-memory=${p1.id}`, label: "actividad" });
  });
  it("shows the empty state", async () => {
    const container = await mount(vi.fn().mockResolvedValue(page([], null)), { posts: [elsewhere, independent], unplaced: [] });
    expect(container.textContent).toContain("Todavía no hay recuerdos de esta actividad");
    expect(container.querySelector("[data-memory]")).toBeNull();
  });
  it("offers «Compartir un recuerdo» towards the composer with the activity", async () => {
    const container = await mount(standard());
    const link = Array.from(container.querySelectorAll("a")).find((item) => item.textContent === "Compartir un recuerdo")!;
    expect(link.getAttribute("href")).toBe(`/trips/${tripId}/memories/new?activityId=${activityId}`);
    expect((container.querySelector("#activity-panel-memories") as HTMLElement).contains(link)).toBe(false);
  });
  it("tells that the memory is only text when the whole gallery is loaded and has no photo for it", async () => {
    const container = await mount(standard());
    expect(container.textContent).not.toContain("Cargar más fotos");
    expect(container.querySelector("[data-memory-pending]")).toBeNull();
  });

  describe("thumbnails that are not loaded yet", () => {
    // Page 1 only reaches p1: p2 and p3 may still have photos in later pages.
    const firstPage = () => page([photo(21, p1, 0)], "c1");
    it("shows «Cargar más fotos» and marks the posts without a thumbnail as pending, claiming nothing", async () => {
      const container = await mount(vi.fn().mockResolvedValue(firstPage()));
      expect(Array.from(container.querySelectorAll("button")).some((item) => item.textContent === "Cargar más fotos")).toBe(true);
      expect(memoryRows(container.querySelector("#activity-panel-memories")!)).toEqual([p1.id, p2.id, p3.id]);
      expect(Array.from(container.querySelectorAll("[data-memory-pending]")).map((item) => item.getAttribute("data-memory-pending"))).toEqual([p2.id, p3.id]);
      expect(container.textContent).not.toContain("Sin foto");
    });
    it("offers nothing to load when every post already has a thumbnail or is text only for certain, even with more pages", async () => {
      // Loaded up to p3 (the oldest): p2 has no photo for sure; the older posts, if any, are not listed here.
      const container = await mount(vi.fn().mockResolvedValue(page([photo(21, p1, 0), photo(23, p3, 0)], "c1")));
      expect(container.querySelector("[data-memory-pending]")).toBeNull();
      expect(container.textContent).not.toContain("Cargar más fotos");
    });
    it("does not load more by itself", async () => {
      const list = vi.fn().mockResolvedValue(firstPage());
      await mount(list);
      expect(list).toHaveBeenCalledTimes(1);
    });
    it("uses aria-disabled (not disabled) while loading, ignores a second click and keeps the focus", async () => {
      const second = deferred<unknown>();
      const list = vi.fn().mockResolvedValueOnce(firstPage()).mockReturnValueOnce(second.promise);
      const container = await mount(list);
      const more = () => Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "Cargar más fotos") as HTMLButtonElement;
      more().focus();
      await click(more());
      expect(list).toHaveBeenCalledTimes(2);
      expect(more().getAttribute("aria-disabled")).toBe("true");
      expect(more().disabled).toBe(false);
      expect(document.activeElement).toBe(more());
      await click(more());
      expect(list).toHaveBeenCalledTimes(2);
      await act(async () => second.resolve(page([photo(23, p3, 0)], null)));
      expect(container.querySelector("[data-memory-pending]")).toBeNull();
      expect((container.querySelector(`[data-memory="${p3.id}"] img`) as HTMLImageElement).getAttribute("src")).toBe(photo(23, p3).url);
      expect(container.textContent).not.toContain("Cargar más fotos");
      expect(container.contains(document.activeElement) && document.activeElement !== document.body).toBe(true);
    });
  });

  describe("failures", () => {
    it("a gallery failure keeps the memories and shows a single non-blocking alert with Reintentar", async () => {
      const list = vi.fn().mockResolvedValueOnce(fail("network")).mockResolvedValueOnce(page([photo(21, p1, 0), photo(23, p3, 0)], null));
      const container = await mount(list);
      expect(memoryRows(container)).toEqual([p1.id, p2.id, p3.id]);
      expect(alertTexts()).toHaveLength(1);
      expect(alertTexts()[0]).toContain("No pudimos cargar las miniaturas");
      expect(document.querySelector('[role="alert"][aria-live]')).toBeNull();
      await click(Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "Reintentar"));
      expect(list).toHaveBeenCalledTimes(2);
      expect(alertTexts()).toHaveLength(0);
      expect(container.querySelectorAll("[data-memory] img")).toHaveLength(2);
    });
    it("a failed page 2 keeps the loaded thumbnails and shows one alert", async () => {
      const list = vi.fn().mockResolvedValueOnce(page([photo(21, p1, 0)], "c1")).mockResolvedValueOnce(fail("server"));
      const container = await mount(list);
      await click(Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "Cargar más fotos"));
      expect(alertTexts()).toHaveLength(1);
      expect(container.querySelectorAll("[data-memory] img")).toHaveLength(1);
    });
    it("401 offers «Iniciar sesión» and keeps the memories", async () => {
      const container = await mount(vi.fn().mockResolvedValue(fail("unauthorized")));
      expect(memoryRows(container)).toEqual([p1.id, p2.id, p3.id]);
      const login = Array.from(container.querySelectorAll("a")).find((item) => item.textContent === "Iniciar sesión");
      expect(login?.getAttribute("href")).toBe("/login");
      expect(alertTexts()).toHaveLength(1);
    });
    it("a thumbnail that fails after its refresh shows a failure marker instead of a broken image", async () => {
      const list = vi.fn().mockResolvedValue(page([photo(21, p1, 0)], null));
      const container = await mount(list);
      const img = () => container.querySelector(`[data-memory="${p1.id}"] img`) as HTMLImageElement | null;
      await act(async () => { img()!.dispatchEvent(new Event("error")); });
      expect(list).toHaveBeenCalledTimes(2); // the page is asked again for a fresh url
      await act(async () => { img()?.dispatchEvent(new Event("error")); });
      expect(img()).toBeNull();
      expect(container.querySelector(`[data-memory="${p1.id}"]`)!.textContent).toContain("Miniatura no disponible");
      expect(container.querySelector(`[data-memory="${p1.id}"]`)!.textContent).toContain("Recuerdo 11");
    });
    it("404 and 403 of the gallery call onGone once", async () => {
      const gone = vi.fn();
      await mount(vi.fn().mockResolvedValue(fail("not-found")), { onGone: gone });
      expect(gone).toHaveBeenCalledTimes(1);
      expect(alertTexts()).toHaveLength(0);
      await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren();
      const forbidden = vi.fn();
      await mount(vi.fn().mockResolvedValue(fail("forbidden")), { onGone: forbidden });
      expect(forbidden).toHaveBeenCalledTimes(1);
    });
    it("a 404 when refreshing an expired url also calls onGone, with no thumbnail notice", async () => {
      const gone = vi.fn();
      const list = vi.fn().mockResolvedValueOnce(page([photo(21, p1, 0)], null)).mockResolvedValueOnce(fail("not-found"));
      const container = await mount(list, { onGone: gone });
      await act(async () => { container.querySelector(`[data-memory="${p1.id}"] img`)!.dispatchEvent(new Event("error")); });
      expect(gone).toHaveBeenCalledTimes(1);
      expect(alertTexts()).toHaveLength(0);
    });
    it("a 404 while loading page 2 also calls onGone", async () => {
      const gone = vi.fn();
      const list = vi.fn().mockResolvedValueOnce(page([photo(21, p1, 0)], "c1")).mockResolvedValueOnce(fail("not-found"));
      const container = await mount(list, { onGone: gone });
      await click(Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "Cargar más fotos"));
      expect(gone).toHaveBeenCalledTimes(1);
    });
  });
});

describe("ActivityMemories (Fotos)", () => {
  it("asks the gallery of this activity only, once, and shows just its images in the grid", async () => {
    const list = standard();
    const container = await mount(list, { tab: "photos" });
    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith(tripId, { activityId });
    const grid = container.querySelector('ul.photo-grid[aria-label="Fotos de la actividad"]')!;
    expect(Array.from(grid.querySelectorAll("li")).map((item) => item.getAttribute("data-photo"))).toEqual([itineraryId(21), itineraryId(22), itineraryId(23)]);
  });
  it("one gallery feeds both tabs: switching does not ask again", async () => {
    const list = standard();
    const container = await mount(list);
    await click(tabButton("photos"));
    expect(list).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll('ul.photo-grid li')).toHaveLength(3);
  });
  it("shows the empty state when the activity has no photos", async () => {
    const container = await mount(vi.fn().mockResolvedValue(page([], null)), { tab: "photos" });
    expect(container.textContent).toContain("Todavía no hay fotos de esta actividad");
  });
  it("tells the gallery unavailable on 404 and calls onGone", async () => {
    const gone = vi.fn();
    const container = await mount(vi.fn().mockResolvedValue(fail("not-found")), { tab: "photos", onGone: gone });
    expect(gone).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Las fotos de este viaje no están disponibles para tu cuenta.");
  });
  it("has a single alert when the gallery fails, whichever tab is shown", async () => {
    await mount(vi.fn().mockResolvedValue(fail("network")), { tab: "photos" });
    expect(alertTexts()).toHaveLength(1);
    expect(alertTexts()[0]).toContain("No pudimos cargar las fotos");
  });
  it("401 shows «Iniciar sesión»", async () => {
    const container = await mount(vi.fn().mockResolvedValue(fail("unauthorized")), { tab: "photos" });
    expect(Array.from(container.querySelectorAll("a")).some((item) => item.textContent === "Iniciar sesión")).toBe(true);
  });
  it("opens the viewer over the photos of the activity, in its own layer outside the dialog content", async () => {
    const container = await mount(standard(), { tab: "photos" });
    await click(container.querySelector(`[data-photo="${itineraryId(22)}"] button`));
    const viewer = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(viewer).not.toBeNull();
    expect(viewer.getAttribute("aria-labelledby")).toBeTruthy();
    expect(viewer.textContent).toContain("Foto 2 de 3");
    expect(container.contains(viewer)).toBe(false);
    expect(viewer.closest(".activity-confirm-layer")).not.toBeNull();
    expect(viewer.closest(".activity-confirm-layer")!.parentElement).toBe(document.body);
  });
  it("«Ver recuerdo» opens the post with label «actividad», the viewer mark and the photo anchor", async () => {
    const container = await mount(standard(), { tab: "photos" });
    await click(container.querySelector(`[data-photo="${itineraryId(23)}"] button`));
    await click(Array.from(document.querySelectorAll("a")).find((item) => item.textContent === "Ver recuerdo"));
    expect(openPost).toHaveBeenCalledTimes(1);
    expect(openPost.mock.calls[0]![2]).toEqual({ tripId, postId: p3.id, anchor: `data-photo=${itineraryId(23)}`, label: "actividad", viewer: true });
  });
  it("closing the viewer returns the focus to the thumbnail", async () => {
    const container = await mount(standard(), { tab: "photos" });
    await click(container.querySelector(`[data-photo="${itineraryId(22)}"] button`));
    await click(Array.from(document.querySelectorAll("button")).find((item) => item.getAttribute("aria-label") === "Cerrar"));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(container.querySelector(`[data-photo="${itineraryId(22)}"] button`));
    expect(here).toBe(`/trips/${tripId}/itinerary?activity=${activityId}&tab=photos`);
  });
  it("restarting from page 1 sends the focus to the Fotos tab", async () => {
    const list = vi.fn().mockResolvedValueOnce(page([photo(21, p1, 0)], "c1")).mockResolvedValueOnce({ ok: false, error: { kind: "validation", fields: [{ field: "cursor", code: "invalid" }] } })
      .mockResolvedValue(page([photo(21, p1, 0)], null));
    const container = await mount(list, { tab: "photos" });
    await click(Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "Cargar más"));
    await click(Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "Volver a cargar desde el inicio"));
    expect(document.activeElement).toBe(tabButton("photos"));
  });
});

describe("ActivityMemories settling", () => {
  it("with Recuerdos it settles once the list is mounted, without waiting for the gallery", async () => {
    const pending = deferred<unknown>();
    const settled = vi.fn();
    const seenAtSettle: (string | null)[][] = [];
    settled.mockImplementation(() => seenAtSettle.push(memoryRows(document)));
    await mount(vi.fn().mockReturnValue(pending.promise), { onSettled: settled });
    expect(settled).toHaveBeenCalled();
    expect(seenAtSettle[0]).toEqual([p1.id, p2.id, p3.id]);
  });
  it("with Fotos it waits until the gallery is no longer loading", async () => {
    const pending = deferred<unknown>();
    const settled = vi.fn();
    await mount(vi.fn().mockReturnValue(pending.promise), { tab: "photos", onSettled: settled });
    expect(settled).not.toHaveBeenCalled();
    await act(async () => pending.resolve(page([photo(21, p1, 0)], null)));
    expect(settled).toHaveBeenCalledTimes(1);
    expect(document.querySelector(`[data-photo="${itineraryId(21)}"]`)).not.toBeNull();
  });
});
