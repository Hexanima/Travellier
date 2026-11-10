// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Link, MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { itineraryFixture, itineraryId, linkPost } from "./itinerary-test-fixture.js";
import type { TripItineraryApi, TripItineraryResponse } from "./trip-itinerary-api.js";
import { TripItineraryScreen } from "./TripItineraryScreen.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
const fixture = () => itineraryFixture() as TripItineraryResponse;
async function render(get = vi.fn().mockResolvedValue({ ok: true, value: fixture() }), timeZone = "America/Argentina/Buenos_Aires") {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={[`/trips/${itineraryId(1)}/itinerary`]}>
    <Link to={`/trips/${itineraryId(99)}/itinerary`}>Otro viaje</Link>
    <Routes><Route path="/trips/:tripId/itinerary" element={<TripItineraryScreen itinerary={{ get } as TripItineraryApi}
      timeZone={timeZone} />} /></Routes>
  </MemoryRouter>));
  return { container, get };
}
/** One day is shown at a time: pick it in the strip. */
const showDay = async (container: HTMLElement, date: string) => act(async () => container.querySelector<HTMLElement>(`[data-day="${date}"]`)!.click());
const clickText = async (container: HTMLElement, text: string) => act(async () => {
  Array.from(container.querySelectorAll("button,a")).find((item) => item.textContent === text)?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
});

describe("itinerary screen", () => {
  it("renders mixed bands under one local date with activities and posts in chronological order", async () => {
    const { container, get } = await render();
    expect(get).toHaveBeenCalledExactlyOnceWith(itineraryId(1));
    expect(container.querySelectorAll('[data-itinerary-date="2026-09-25"]')).toHaveLength(1);
    expect(container.textContent).toContain("Tránsito de ida"); expect(container.textContent).toContain("Tránsito de vuelta");
    expect(container.querySelectorAll('[data-itinerary-kind="activity"]')).toHaveLength(1);
    expect(Array.from(container.querySelectorAll('[data-itinerary-kind="activity"] [data-itinerary-item]')).map((item) => item.getAttribute("data-itinerary-item")))
      .toEqual([itineraryId(8), itineraryId(10), itineraryId(9)]);
    expect(container.querySelector(`time[datetime="2026-09-25T12:00:00.123Z"]`)?.textContent).toBe("09:00");
    expect(container.textContent).toContain("En camino");
    expect(container.querySelector('[data-itinerary-expenses]')?.textContent).toContain("ARS 25,50 · 1 gasto");
    expect(container.querySelector('[data-itinerary-expenses]')?.textContent).not.toContain("999");
  });
  it.each([
    ["register", 0.1, 0.2, "ARS 0,30", "ARS 0,10"],
    ["balance", 0.1, 0.2, "ARS 0,30", "ARS 0,10"],
    ["register", 10.005, 0, "ARS 10,01", "ARS 10,01"],
    ["balance", 10.005, 0, "ARS 10,01", "ARS 10,01"],
    ["register", 1234.56, 0.01, "ARS 1.234,57", "ARS 1.234,56"],
    ["balance", 1234.56, 0.01, "ARS 1.234,57", "ARS 1.234,56"],
  ] as const)("formats daily expenses without floating point artifacts in %s: %s + %s", async (expenseMode, first, second, expectedTotal, expectedPost) => {
    const value = fixture(); value.expenseMode = expenseMode;
    value.posts[0].expense!.totalAmount = first;
    value.posts[1].expense = { ...value.posts[0].expense!, id: itineraryId(30), postId: value.posts[1].id, totalAmount: second };
    const before = JSON.stringify(value);
    const { container } = await render(vi.fn().mockResolvedValue({ ok: true, value }));
    expect(container.querySelector('[data-itinerary-expenses] .itinerary-expense-total strong')?.textContent).toBe(expectedTotal);
    expect(container.querySelector('[data-itinerary-expenses] .itinerary-expense-total span')?.textContent).toBe("2 gastos");
    expect(container.querySelector(`[data-itinerary-post="${value.posts[0].id}"] .itinerary-post-expense strong`)?.textContent).toBe(`Gasto: ${expectedPost}`);
    expect(JSON.stringify(value)).toBe(before);
  });
  it("shows activity posts in context once with their own UTC publication instant and expense", async () => {
    const value = fixture(); linkPost(value.posts[0], { activityId: itineraryId(8), transportId: itineraryId(6) });
    value.activities[0].postIds = [itineraryId(10)]; value.transports[0].postIds.push(itineraryId(10));
    const { container } = await render(vi.fn().mockResolvedValue({ ok: true, value }));
    expect(container.querySelectorAll(`[data-itinerary-post="${itineraryId(10)}"]`)).toHaveLength(1);
    expect(container.querySelector(`[data-itinerary-item="${itineraryId(8)}"]`)?.textContent).toContain("Almuerzo junto al río");
    expect(container.querySelector(`[data-itinerary-post="${itineraryId(10)}"] time`)?.getAttribute("datetime")).toBe(value.posts[0].createdAt);
  });
  it.each(["UTC", "America/Argentina/Buenos_Aires"])("renders a daily chronological agenda with transport posts nested under their transport in %s", async (timeZone) => {
    const value = fixture(); value.posts[1].createdAt = value.posts[0].createdAt;
    const { container } = await render(vi.fn().mockResolvedValue({ ok: true, value }), timeZone);
    const day = container.querySelector('[data-itinerary-date="2026-09-25"]');
    expect(Array.from(day!.querySelectorAll('[data-itinerary-item]')).map((item) => item.getAttribute("data-itinerary-item")))
      .toEqual([6, 8, 10, 9, 7].map(itineraryId));
    const post = day?.querySelector(`[data-itinerary-post="${itineraryId(11)}"]`);
    expect(post?.closest('[data-itinerary-kind]')?.getAttribute("data-itinerary-kind")).toBe("transit_out");
    expect(post?.closest(`[data-itinerary-item="${itineraryId(6)}"]`)).not.toBeNull();
    expect(day?.querySelector(`[data-itinerary-item="${itineraryId(6)}"] [aria-label="Recuerdos de Auto"]`)).not.toBeNull();
    expect(post?.textContent).toContain("Vinculado a transporte");
    expect(container.querySelectorAll(`[data-itinerary-post="${itineraryId(11)}"]`)).toHaveLength(1);
    const labels = Array.from(day!.querySelectorAll('[aria-labelledby]')).map((node) => node.getAttribute("aria-labelledby"));
    expect(labels.every((label) => container.querySelectorAll(`[id="${label}"]`).length === 1)).toBe(true);
  });
  it("shows a descendant of an activity under it once, with its relation, and not as a loose post of the day", async () => {
    const value = fixture();
    linkPost(value.posts[0], { activityId: itineraryId(8) });
    const child = linkPost({ ...fixture().posts[0], id: itineraryId(41), description: "Respuesta al almuerzo", expense: null, createdAt: "2026-09-25T15:00:00.000Z" },
      { parentPostId: itineraryId(10), rootActivityId: itineraryId(8) });
    value.posts.push(child); value.activities[0].postIds = [itineraryId(10), child.id];
    const { container } = await render(vi.fn().mockResolvedValue({ ok: true, value }));
    expect(container.querySelectorAll(`[data-itinerary-post="${child.id}"]`)).toHaveLength(1);
    expect(container.querySelector(`[data-itinerary-item="${itineraryId(8)}"] [data-itinerary-post="${child.id}"]`)?.textContent).toContain("Relacionado con otro post");
    expect(container.querySelector(`[data-itinerary-item="${child.id}"]`)).toBeNull();
  });
  it("labels relations from the context, even when the post's own links are empty", async () => {
    const value = fixture();
    // The parent is not in posts[] (it is unplaced): the top-level parentPostId is null but the context keeps the real parent.
    const parent = { ...fixture().posts[0], id: itineraryId(60), createdAt: "2025-01-01T00:00:00.000Z", expense: null };
    value.unplacedPosts = [parent];
    const descendant = linkPost({ ...fixture().posts[0], id: itineraryId(61), description: "Nieto del transporte", expense: null }, { rootTransportId: itineraryId(6) });
    descendant.context = { ...descendant.context, parentPostId: parent.id, rootPostId: parent.id };
    value.posts.push(descendant);
    const { container } = await render(vi.fn().mockResolvedValue({ ok: true, value }));
    const node = container.querySelector(`[data-itinerary-item="${itineraryId(6)}"] [data-itinerary-post="${descendant.id}"]`);
    expect(descendant.transportId).toBeNull(); expect(descendant.parentPostId).toBeNull();
    expect(node?.textContent).toContain("Vinculado a transporte");
    expect(node?.textContent).toContain("Relacionado con otro post");
  });
  it("lists posts outside the itinerary in their own section, with their expense, without adding it to any day", async () => {
    const value = fixture();
    value.unplacedPosts = [{ ...fixture().posts[0], id: itineraryId(50), description: "Foto previa al viaje", createdAt: "2026-08-01T12:00:00.000Z",
      expense: { ...fixture().posts[0].expense!, id: itineraryId(51), postId: itineraryId(50), totalAmount: 99 } }];
    value.posts[0].createdAt = "2026-10-03T12:00:00.789Z";
    const { container } = await render(vi.fn().mockResolvedValue({ ok: true, value }));
    const section = container.querySelector('section[aria-labelledby="itinerary-outside-posts"]');
    expect(section?.querySelector("h2")?.textContent).toBe("Publicaciones fuera del itinerario");
    expect(Array.from(section!.querySelectorAll("[data-itinerary-post]")).map((n) => n.getAttribute("data-itinerary-post")))
      .toEqual([itineraryId(50), itineraryId(10)]);
    expect(section?.textContent).toContain("Gasto: ARS 99,00");
    expect(container.querySelector('[data-itinerary-date="2026-09-25"] [data-itinerary-expenses]')?.textContent).toContain("Sin gastos registrados.");
    expect(container.querySelectorAll(`[data-itinerary-post="${itineraryId(50)}"]`)).toHaveLength(1);
  });
  it("shows the outside section even when the trip has no itinerary days", async () => {
    const value: TripItineraryResponse = { ...fixture(), days: [], activities: [], transports: [], posts: [],
      unplacedPosts: [{ ...fixture().posts[0], id: itineraryId(50), description: "Sin viaje aún" }] };
    const { container } = await render(vi.fn().mockResolvedValue({ ok: true, value }));
    expect(container.textContent).toContain("Todavía no hay itinerario");
    expect(container.querySelector('[data-itinerary-post]')?.textContent).toContain("Sin viaje aún");
    expect(container.textContent).toContain("Publicaciones fuera del itinerario");
  });
  it("does not show the section when every post is placed, and never labels a band as arrival", async () => {
    const { container } = await render();
    expect(container.textContent).not.toContain("Publicaciones fuera del itinerario");
    expect(Array.from(container.querySelectorAll("h3")).map((h) => h.textContent)).toEqual(["Tránsito de ida", "Actividades", "Tránsito de vuelta"]);
    expect(container.querySelector('[data-itinerary-kind="arrival"]')).toBeNull();
  });
  it("shows a post published outside the trip dates once, outside the itinerary and without adding its expense to a day", async () => {
    const value = fixture();
    value.days = [{ ...value.days[1], startsAt: "2026-09-25T00:00:00.123Z", endsAt: "2026-09-25T08:00:00.456Z", items: [] }];
    value.activities = []; value.transports = []; value.posts = [value.posts[0]];
    value.posts[0].createdAt = "2026-10-03T12:00:00.789Z";
    const { container } = await render(vi.fn().mockResolvedValue({ ok: true, value }));
    expect(container.querySelectorAll(`[data-itinerary-post="${value.posts[0].id}"]`)).toHaveLength(1);
    const post = container.querySelector(`[data-itinerary-post="${value.posts[0].id}"]`);
    expect(post?.closest("section")?.getAttribute("aria-labelledby")).toBe("itinerary-outside-posts");
    expect(container.querySelector('[data-itinerary-date] [data-itinerary-post]')).toBeNull();
    expect(post?.textContent).toContain("Gasto: ARS 25,50");
    for (const date of ["2026-09-24", "2026-09-25"]) {
      await showDay(container, date);
      expect(container.querySelector(`[data-itinerary-date="${date}"] [data-itinerary-expenses]`)?.textContent).toContain("Sin gastos registrados.");
    }
    expect(post?.querySelector("time")?.getAttribute("datetime")).toBe(value.posts[0].createdAt);
  });
  it.each(["UTC", "America/Argentina/Buenos_Aires"])("shows a linked post under its activity across canonical days in %s", async (timeZone) => {
    const value = fixture();
    value.days = [
      { ...value.days[1], date: "2026-09-24T00:00:00.000Z", startsAt: "2026-09-24T22:00:00.000Z", endsAt: "2026-09-25T00:00:00.000Z", items: [] },
      { ...value.days[1], id: itineraryId(30), startsAt: "2026-09-25T00:00:00.000Z", endsAt: "2026-09-25T03:00:00.000Z", items: [] },
    ];
    value.transports = []; value.activities = [value.activities[0]]; value.posts = [value.posts[0]];
    value.activities[0].scheduledAt = "2026-09-24T23:00:00.000Z"; value.activities[0].postIds = [value.posts[0].id];
    linkPost(value.posts[0], { activityId: value.activities[0].id });
    value.posts[0].createdAt = "2026-09-25T01:00:00.000Z";
    const { container } = await render(vi.fn().mockResolvedValue({ ok: true, value }), timeZone);
    const postSelector = `[data-itinerary-post="${value.posts[0].id}"]`;
    expect(container.querySelectorAll(postSelector)).toHaveLength(1);
    expect(container.querySelector(`[data-itinerary-item="${value.activities[0].id}"] ${postSelector}`)).not.toBeNull();
    // The expense follows the root activity's local day, not the publication day.
    expect(container.querySelector('[data-itinerary-date="2026-09-24"] [data-itinerary-expenses]')?.textContent).toContain("25,5");
    if (timeZone === "UTC") await showDay(container, "2026-09-25");
    if (timeZone === "UTC") expect(container.querySelector('[data-itinerary-date="2026-09-25"] [data-itinerary-expenses]')?.textContent).toContain("Sin gastos registrados.");
  });
  it("shows the empty state and a link to configuring transport", async () => {
    const value = { ...fixture(), days: [], activities: [], posts: [], transports: [] };
    const { container } = await render(vi.fn().mockResolvedValue({ ok: true, value }));
    expect(container.textContent).toContain("Todavía no hay itinerario");
    expect(container.querySelector(`a[href="/trips/${itineraryId(1)}/journey"]`)).not.toBeNull();
  });
  it("no longer carries the provisional link to the Trip memories: the Diario tab of the Trip shell replaces it", async () => {
    const { container } = await render(vi.fn().mockResolvedValue({ ok: true, value: { ...fixture(), days: [], activities: [], posts: [], transports: [] } }));
    expect(container.querySelector(`a[href="/trips/${itineraryId(1)}/memories"]`)).toBeNull();
  });
  it("links to the balance from the header whatever the expense mode (it lives in the itinerary panel)", async () => {
    const { container } = await render(vi.fn().mockResolvedValue({ ok: true, value: fixture() }));
    expect(container.querySelector(`.itinerary-header a[href="/trips/${itineraryId(1)}/balance"]`)?.textContent).toBe("Balance");
    const empty = await render(vi.fn().mockResolvedValue({ ok: true, value: { ...fixture(), days: [], activities: [], posts: [], transports: [] } }));
    expect(empty.container.querySelector(`.itinerary-header a[href="/trips/${itineraryId(1)}/balance"]`)?.textContent).toBe("Balance");
  });
  it("shows loading until the aggregate resolves", async () => {
    let resolve: (value: unknown) => void = () => undefined;
    const { container } = await render(vi.fn(() => new Promise((done) => { resolve = done; })));
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Cargando itinerario");
    await act(async () => resolve({ ok: true, value: fixture() }));
    expect(container.textContent).toContain("Paseo por el centro");
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });
  it("retries a failed request without showing stale content", async () => {
    const get = vi.fn().mockResolvedValueOnce({ ok: false, error: { kind: "network" } }).mockResolvedValueOnce({ ok: true, value: fixture() });
    const { container } = await render(get);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("No pudimos cargar");
    await clickText(container, "Reintentar");
    expect(get).toHaveBeenCalledTimes(2); expect(container.textContent).toContain("Paseo por el centro");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it.each(["not-found", "forbidden"])("hides private content and actions after %s", async (kind) => {
    const { container } = await render(vi.fn().mockResolvedValue({ ok: false, error: { kind } }));
    expect(container.textContent).toContain("no está disponible");
    expect(container.querySelector('[data-itinerary-date]')).toBeNull();
    expect(container.querySelector('a[href$="/journey"]')).toBeNull();
    expect(container.querySelector('a[href$="/memories"]')).toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });
  it("clears the old Trip immediately and ignores a late response after navigation", async () => {
    let resolve: (value: unknown) => void = () => undefined;
    const get = vi.fn().mockImplementationOnce(() => new Promise((done) => { resolve = done; }))
      .mockResolvedValueOnce({ ok: false, error: { kind: "not-found" } });
    const { container } = await render(get);
    await clickText(container, "Otro viaje");
    await act(async () => resolve({ ok: true, value: fixture() }));
    expect(get).toHaveBeenLastCalledWith(itineraryId(99));
    expect(container.textContent).not.toContain("Paseo por el centro");
    expect(container.textContent).toContain("no está disponible");
  });
});

describe("itinerary posts as links to the memory detail", () => {
  type Entry = { pathname: string; state: unknown };
  const seen: Entry[] = [];
  function Spy() { const location = useLocation(); seen.push({ pathname: location.pathname, state: location.state }); return null; }
  function Detail() { const navigate = useNavigate(); return <button onClick={() => navigate(-1)}>atrás</button>; }
  const scrollIntoView = vi.fn(); const scrollTo = vi.fn();
  beforeEach(() => {
    seen.length = 0; scrollIntoView.mockReset(); scrollTo.mockReset();
    Object.defineProperty(window, "scrollY", { value: 360, configurable: true });
    Element.prototype.scrollIntoView = scrollIntoView; window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
  });
  const timeZone = "America/Argentina/Buenos_Aires";
  async function open(get: ReturnType<typeof vi.fn>, state?: unknown) {
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container); roots.push(root);
    await act(async () => root.render(<MemoryRouter initialEntries={[{ pathname: `/trips/${itineraryId(1)}/itinerary`, state }]}><Spy /><Routes>
      <Route path="/trips/:tripId/itinerary" element={<TripItineraryScreen itinerary={{ get } as TripItineraryApi} timeZone={timeZone} />} />
      <Route path="/trips/:tripId/memories/:postId" element={<Detail />} />
    </Routes></MemoryRouter>));
    return container;
  }
  const ok = (value: TripItineraryResponse) => vi.fn().mockResolvedValue({ ok: true, value });
  const click = async (element: Element | null) => { expect(element).not.toBeNull(); await act(async () => element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }))); };
  const anchor = (n: number) => `data-itinerary-post=${itineraryId(n)}`;
  const detailPath = (n: number) => `/trips/${itineraryId(1)}/memories/${itineraryId(n)}`;
  const link = (container: HTMLElement, n: number) => container.querySelector(`[data-itinerary-post="${itineraryId(n)}"] a`);
  const withActivityPost = () => { const value = fixture(); linkPost(value.posts[0], { activityId: itineraryId(8) }); value.activities[0].postIds = [itineraryId(10)]; return value; };
  const withOutsidePost = () => { const value = fixture(); value.unplacedPosts = [{ ...fixture().posts[0], id: itineraryId(50), description: "Foto previa", createdAt: "2026-08-01T12:00:00.000Z", expense: null }]; return value; };

  it.each([
    ["an activity", withActivityPost, 10, `[data-itinerary-item="${itineraryId(8)}"] `],
    ["a transport", fixture, 11, `[data-itinerary-item="${itineraryId(6)}"] `],
    ["an independent post of the day", fixture, 10, '[data-itinerary-date] '],
    ["the section of posts outside the itinerary", withOutsidePost, 50, 'section[aria-labelledby="itinerary-outside-posts"] '],
  ])("links the post of %s to its detail", async (_name, build, n, scope) => {
    const container = await open(ok(build() as TripItineraryResponse));
    const element = container.querySelector(`${scope}[data-itinerary-post="${itineraryId(n)}"] a`);
    expect(element?.getAttribute("href")).toBe(detailPath(n));
    expect(element?.textContent).toBe(container.querySelector(`${scope}[data-itinerary-post="${itineraryId(n)}"] .itinerary-post-description`)?.textContent);
    expect(element?.textContent).not.toBe("");
  });
  it("opens the detail with the itinerary as origin, anchored to the post, and restores it when coming back", async () => {
    const container = await open(ok(fixture()));
    await click(link(container, 11));
    expect(seen[seen.length - 1].pathname).toBe(detailPath(11));
    expect(seen[seen.length - 1].state).toEqual({ origin: { path: `/trips/${itineraryId(1)}/itinerary`, label: "itinerario", anchor: anchor(11), scrollY: 360 } });
    await click(Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "atrás") ?? null);
    expect(seen.some((entry) => JSON.stringify(entry.state) === JSON.stringify({ restore: { anchor: anchor(11), scrollY: 360 } }))).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(container.querySelector(`[data-itinerary-post="${itineraryId(11)}"]`));
    expect(seen[seen.length - 1].state).toBeNull();
  });
  it("restores only once the itinerary is ready, focuses the post and cleans the state", async () => {
    let resolve!: (value: unknown) => void;
    const get = vi.fn().mockReturnValue(new Promise((r) => { resolve = r; }));
    const container = await open(get, { restore: { anchor: anchor(11), scrollY: 200 } });
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
    await act(async () => resolve({ ok: true, value: fixture() }));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    expect(document.activeElement).toBe(container.querySelector(`[data-itinerary-post="${itineraryId(11)}"]`));
    expect(scrollTo).not.toHaveBeenCalled();
    expect(seen[seen.length - 1].state).toBeNull();
  });
  it("falls back to the saved scroll when the anchor is gone, with no errors or messages", async () => {
    const container = await open(ok(fixture()), { restore: { anchor: anchor(99), scrollY: 200 } });
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(scrollTo).toHaveBeenCalledWith(0, 200);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});
