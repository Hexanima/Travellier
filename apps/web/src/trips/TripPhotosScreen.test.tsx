// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation, useNavigate, type NavigateFunction } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TripPhotosScreen } from "./TripPhotosScreen.js";
import { GalleryProvider } from "./use-gallery.js";
import { itineraryId } from "./itinerary-test-fixture.js";
import type { GalleryPage, GalleryPhoto } from "./trip-gallery-api.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); vi.restoreAllMocks(); });
const tripId = itineraryId(1);
const me = itineraryId(600);
const path = `/trips/${tripId}/memories/photos`;
const NOW = Date.parse("2026-11-10T12:00:00.000Z");
const photo = (n: number): GalleryPhoto => ({ id: itineraryId(n), postId: itineraryId(500 + n), order: 0, uploadedAt: "2026-11-10T01:30:00.000Z", uploaderId: me,
  url: `https://s3.test/${n}?sig=SECRET${n}`, expiresAtMs: NOW + 300_000, post: { createdAt: "2026-11-10T01:00:00.000Z", authorId: me, rootActivityId: null, rootTransportId: null } });
const page = (photos: GalleryPhoto[], nextCursor: string | null): { ok: true; value: GalleryPage } => ({ ok: true, value: { photos, nextCursor } });
const fail = (kind: string, fields?: unknown) => ({ ok: false as const, error: { kind, ...(fields ? { fields } : {}) } });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
const members = { list: vi.fn() };
beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); members.list.mockReset().mockResolvedValue({ ok: true, value: { currentUserId: me, members: [{ id: itineraryId(900), userId: me, name: "Yo", role: "admin", joinedAt: "2026-11-01T10:00:00.000Z" }] } }); });

const seen: { pathname: string; state: unknown }[] = [];
let go: NavigateFunction = () => undefined;
function Spy() { const location = useLocation(); go = useNavigate(); seen.push({ pathname: location.pathname, state: location.state }); return null; }
const last = () => seen[seen.length - 1]!;
function Detail() { const location = useLocation(); return <p data-detail>{JSON.stringify(location.state)}</p>; }
async function mount(list: ReturnType<typeof vi.fn>, entries: { pathname: string; state?: unknown }[] = [{ pathname: path }]) {
  seen.length = 0;
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={[{ pathname: `/trips/${tripId}/memories` }, ...entries]} initialIndex={entries.length}><Spy />
    <GalleryProvider list={list as never} now={() => NOW}><Routes>
      <Route path="/trips/:tripId/memories" element={<p>DIARIO</p>} />
      <Route path="/trips/:tripId/memories/photos" element={<TripPhotosScreen members={members as never} timeZone="America/Argentina/Buenos_Aires" />} />
      <Route path="/trips/:tripId/memories/new" element={<p>NUEVO</p>} />
      <Route path="/trips/:tripId/memories/:postId" element={<Detail />} />
      <Route path="/login" element={<p>LOGIN</p>} />
    </Routes></GalleryProvider></MemoryRouter>));
  return container;
}
const buttons = (container: ParentNode) => Array.from(container.querySelectorAll("button"));
const byText = (container: ParentNode, text: string) => buttons(container).find((item) => item.textContent === text) as HTMLButtonElement | undefined;
const thumbs = (container: ParentNode) => Array.from(container.querySelectorAll("ul.photo-grid > li")).map((item) => item.getAttribute("data-photo"));
const click = (element: Element | null | undefined) => act(async () => { expect(element).toBeTruthy(); (element as HTMLElement).click(); });
const alerts = (container: ParentNode) => container.querySelectorAll('[role="alert"]');

describe("TripPhotosScreen", () => {
  it("shows the loading state and then the grid with the newest first and named thumbnails", async () => {
    const pending = deferred<unknown>();
    const list = vi.fn().mockReturnValue(pending.promise);
    const container = await mount(list);
    expect(container.textContent).toContain("Cargando fotos…");
    expect(container.querySelector("ul.photo-grid")).toBeNull();
    await act(async () => pending.resolve(page([photo(3), photo(2), photo(1)], null)));
    expect(thumbs(container)).toEqual([itineraryId(3), itineraryId(2), itineraryId(1)]);
    expect(container.textContent).not.toContain("Cargando fotos…");
    expect(container.querySelector("button[aria-label]")?.getAttribute("aria-label")).toBe("Foto 1 de 3. De Vos, 9 de nov de 2026");
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Mostrando 3 fotos");
    expect(Array.from(container.querySelectorAll("a")).find((item) => item.textContent === "Volver a recuerdos")?.getAttribute("href")).toBe(`/trips/${tripId}/memories`);
    expect(alerts(container)).toHaveLength(0);
  });
  it("names an unknown uploader «Ex integrante» only once the members loaded", async () => {
    const other = { ...photo(1), uploaderId: itineraryId(777) };
    const container = await mount(vi.fn().mockResolvedValue(page([other], null)));
    expect(container.querySelector("button[aria-label]")?.getAttribute("aria-label")).toBe("Foto 1 de 1. De Ex integrante, 9 de nov de 2026");
  });
  it("does not block the grid when the members fail: «Integrante»", async () => {
    members.list.mockResolvedValue({ ok: false, error: { kind: "server" } });
    const container = await mount(vi.fn().mockResolvedValue(page([photo(1)], null)));
    expect(container.querySelector("button[aria-label]")?.getAttribute("aria-label")).toBe("Foto 1 de 1. De Integrante, 9 de nov de 2026");
    expect(alerts(container)).toHaveLength(0);
  });
  it("shows the empty state with a link to a new memory", async () => {
    const container = await mount(vi.fn().mockResolvedValue(page([], null)));
    expect(container.textContent).toContain("Todavía no hay fotos");
    const link = Array.from(container.querySelectorAll("a")).find((item) => item.textContent === "Nuevo recuerdo");
    expect(link?.getAttribute("href")).toBe(`/trips/${tripId}/memories/new`);
    expect(container.querySelector("ul.photo-grid")).toBeNull();
    expect(byText(container, "Cargar más")).toBeUndefined();
  });
  it("shows a single alert with a retry when the first load fails and no grid", async () => {
    const list = vi.fn().mockResolvedValueOnce(fail("network")).mockResolvedValueOnce(page([photo(1)], null));
    const container = await mount(list);
    expect(alerts(container)).toHaveLength(1);
    expect(container.querySelector("ul.photo-grid")).toBeNull();
    await click(byText(container, "Reintentar"));
    expect(list).toHaveBeenCalledTimes(2);
    expect(thumbs(container)).toEqual([itineraryId(1)]);
    expect(alerts(container)).toHaveLength(0);
  });
  it("shows «no disponible» without retry for a 404", async () => {
    const container = await mount(vi.fn().mockResolvedValue(fail("not-found")));
    expect(alerts(container)).toHaveLength(1);
    expect(container.textContent).toContain("no están disponibles");
    expect(byText(container, "Reintentar")).toBeUndefined();
  });
  it("links to the login on a 401", async () => {
    const container = await mount(vi.fn().mockResolvedValue(fail("unauthorized")));
    expect(alerts(container)).toHaveLength(1);
    expect(Array.from(container.querySelectorAll("a")).find((item) => item.textContent === "Iniciar sesión")?.getAttribute("href")).toBe("/login");
    expect(byText(container, "Reintentar")).toBeUndefined();
  });
  it("loads more on a button with a guard against double clicks, keeping the focus and announcing the progress", async () => {
    const second = deferred<unknown>();
    const list = vi.fn().mockResolvedValueOnce(page([photo(3), photo(2)], "c1")).mockReturnValueOnce(second.promise);
    const container = await mount(list);
    const more = byText(container, "Cargar más")!;
    more.focus();
    await act(async () => { more.click(); more.click(); });
    expect(list).toHaveBeenCalledTimes(2);
    expect(more.getAttribute("aria-disabled")).toBe("true");
    expect(more.disabled).toBe(false);
    expect(document.activeElement).toBe(more);
    expect(container.textContent).toContain("Cargando más fotos…");
    await act(async () => second.resolve(page([photo(1)], null)));
    expect(thumbs(container)).toEqual([itineraryId(3), itineraryId(2), itineraryId(1)]);
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Mostrando 3 fotos");
    expect(byText(container, "Cargar más")).toBeUndefined();
    expect(document.activeElement).toBe(container.querySelector(`[data-photo="${itineraryId(1)}"] button`));
  });
  it("keeps the focus on «Cargar más» while there are more pages", async () => {
    const list = vi.fn().mockResolvedValueOnce(page([photo(3)], "c1")).mockResolvedValueOnce(page([photo(2)], "c2"));
    const container = await mount(list);
    byText(container, "Cargar más")!.focus();
    await click(byText(container, "Cargar más"));
    expect(document.activeElement).toBe(byText(container, "Cargar más"));
  });
  it("shows one alert when page 2 fails, keeps page 1 and retries with the same cursor", async () => {
    const list = vi.fn().mockResolvedValueOnce(page([photo(3)], "c1")).mockResolvedValueOnce(fail("server")).mockResolvedValueOnce(page([photo(2)], null));
    const container = await mount(list);
    await click(byText(container, "Cargar más"));
    expect(alerts(container)).toHaveLength(1);
    expect(thumbs(container)).toEqual([itineraryId(3)]);
    await click(byText(container, "Reintentar"));
    expect(list).toHaveBeenLastCalledWith(tripId, { cursor: "c1" });
    expect(thumbs(container)).toEqual([itineraryId(3), itineraryId(2)]);
    expect(alerts(container)).toHaveLength(0);
  });
  it("offers to reload from the start when the cursor is rejected with a 422", async () => {
    const list = vi.fn().mockResolvedValueOnce(page([photo(3)], "c1")).mockResolvedValueOnce(fail("validation", [{ field: "cursor", code: "invalid", message: "x" }])).mockResolvedValueOnce(page([photo(9)], null));
    const container = await mount(list);
    await click(byText(container, "Cargar más"));
    expect(byText(container, "Reintentar")).toBeUndefined();
    await click(byText(container, "Volver a cargar desde el inicio"));
    expect(list).toHaveBeenLastCalledWith(tripId, {});
    expect(thumbs(container)).toEqual([itineraryId(9)]);
  });
  it("opens the viewer by click as a history entry and closes it with the button, Escape or back, returning the focus to the thumbnail", async () => {
    const container = await mount(vi.fn().mockResolvedValue(page([photo(3), photo(2)], null)));
    const thumb = container.querySelector(`[data-photo="${itineraryId(2)}"] button`)!;
    await click(thumb);
    expect(last().state).toEqual({ photo: itineraryId(2) });
    expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe("Foto 2 de 2");
    await click(Array.from(document.querySelectorAll("button")).find((item) => item.getAttribute("aria-label") === "Cerrar"));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(last().state).toBeNull();
    expect(document.activeElement).toBe(thumb);
    await click(thumb);
    await act(async () => { document.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(thumb);
    await click(thumb);
    await act(async () => go(-1));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(thumb);
  });
  it("replaces the entry when moving between photos so back closes in one step", async () => {
    const container = await mount(vi.fn().mockResolvedValue(page([photo(3), photo(2), photo(1)], null)));
    await click(container.querySelector(`[data-photo="${itineraryId(3)}"] button`));
    await click(Array.from(document.querySelectorAll("button")).find((item) => item.textContent === "Siguiente"));
    await click(Array.from(document.querySelectorAll("button")).find((item) => item.textContent === "Siguiente"));
    expect(document.querySelector("h2")?.textContent).toBe("Foto 3 de 3");
    expect(last().state).toEqual({ photo: itineraryId(1) });
    await act(async () => go(-1));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(last().pathname).toBe(path);
  });
  it("closes without leaving the screen when there is nothing behind the viewer", async () => {
    const list = vi.fn().mockResolvedValue(page([photo(2)], null));
    const container = await mount(list, [{ pathname: path, state: { noBack: true } }]);
    await click(container.querySelector(`[data-photo="${itineraryId(2)}"] button`));
    await act(async () => { document.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(last().pathname).toBe(path);
  });
  it("cleans an invalid or unknown photo from the state and shows only the grid", async () => {
    for (const state of [{ photo: "xyz" }, { photo: itineraryId(77) }, { photo: 5, keep: 1 }]) {
      document.body.replaceChildren();
      const container = await mount(vi.fn().mockResolvedValue(page([photo(2)], null)), [{ pathname: path, state }]);
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(thumbs(container)).toEqual([itineraryId(2)]);
      expect(alerts(container)).toHaveLength(0);
      expect(last().state).toEqual("keep" in state ? { keep: 1 } : null);
    }
  });
  it("opens «Ver recuerdo» with the origin and comes back to the same photo without asking again", async () => {
    const list = vi.fn().mockResolvedValue(page([photo(3), photo(2)], null));
    const container = await mount(list);
    await click(container.querySelector(`[data-photo="${itineraryId(2)}"] button`));
    await click(Array.from(document.querySelectorAll("a")).find((item) => item.textContent === "Ver recuerdo"));
    expect(last().pathname).toBe(`/trips/${tripId}/memories/${itineraryId(502)}`);
    expect(last().state).toEqual({ origin: { path, label: "fotos", anchor: `data-photo=${itineraryId(2)}`, scrollY: 0, viewer: true } });
    await act(async () => go(-1));
    expect(last().pathname).toBe(path);
    expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe("Foto 2 de 2");
    expect(list).toHaveBeenCalledTimes(1);
    expect(thumbs(container)).toEqual([itineraryId(3), itineraryId(2)]);
    expect(last().state).toEqual({ photo: itineraryId(2) });
  });
  it("never puts a signed url in the history state, outside an src, or in the console", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((name) => vi.spyOn(console, name).mockImplementation(() => undefined));
    const list = vi.fn().mockResolvedValueOnce(page([photo(3), photo(2)], "c1")).mockResolvedValueOnce(fail("server"));
    const container = await mount(list);
    await click(byText(container, "Cargar más"));
    await click(container.querySelector(`[data-photo="${itineraryId(2)}"] button`));
    await click(Array.from(document.querySelectorAll("a")).find((item) => item.textContent === "Ver recuerdo"));
    await act(async () => go(-1));
    await act(async () => document.querySelector("img")!.dispatchEvent(new Event("error")));
    expect(JSON.stringify(seen.map((item) => item.state))).not.toContain("SECRET");
    expect(JSON.stringify(seen.map((item) => item.state))).not.toContain("s3.test");
    for (const element of document.querySelectorAll("*")) for (const attribute of Array.from(element.attributes)) {
      if (!(element.tagName === "IMG" && attribute.name === "src")) expect(attribute.value, `${element.tagName}.${attribute.name}`).not.toContain("SECRET");
    }
    for (const text of Array.from(document.querySelectorAll("*")).flatMap((element) => Array.from(element.childNodes).filter((node) => node.nodeType === 3).map((node) => node.textContent ?? ""))) expect(text).not.toContain("SECRET");
    for (const spy of spies) for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain("SECRET");
  });
});
