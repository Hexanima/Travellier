// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation, useNavigate, type NavigateFunction } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TripPhotosScreen } from "./TripPhotosScreen.js";
import { GalleryProvider } from "./use-gallery.js";
import { itineraryId } from "./itinerary-test-fixture.js";
import type { GalleryPage, GalleryPhoto } from "./trip-gallery-api.js";

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
    const empty = container.querySelector("section.trips-empty")!;
    expect(empty.textContent).toContain("Todavía no hay fotos");
    // El vacío lleva su propia acción, como los de Diario, balance e itinerario: no deja la salida solo en el botón flotante.
    const link = Array.from(empty.querySelectorAll("a")).find((item) => item.textContent === "Crear un recuerdo con fotos");
    expect(link?.getAttribute("href")).toBe(`/trips/${tripId}/memories/new`);
    expect(link?.classList.contains("ui-button")).toBe(true);
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
    expect(last().state).toEqual({ photo: itineraryId(2), viewerEntry: true });
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
  describe("double close while the step back is still pending (BrowserRouter: popstate arrives later)", () => {
    const closeButton = () => Array.from(document.querySelectorAll("button")).find((item) => item.getAttribute("aria-label") === "Cerrar");
    const escape = () => act(async () => { document.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    const flush = () => act(async () => { gate.back.splice(0).forEach((run) => run()); });
    it("steps back only once on a double click on «Cerrar» and a later legitimate close still works", async () => {
      const container = await mount(vi.fn().mockResolvedValue(page([photo(3), photo(2)], null)));
      await click(container.querySelector(`[data-photo="${itineraryId(2)}"] button`));
      gate.defer = true;
      await act(async () => { closeButton()!.click(); closeButton()!.click(); });
      expect(gate.back).toHaveLength(1);
      await flush();
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(last().pathname).toBe(path);
      await click(container.querySelector(`[data-photo="${itineraryId(3)}"] button`));
      await click(closeButton());
      expect(gate.back).toHaveLength(1);
      await flush();
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(last().pathname).toBe(path);
    });
    it("steps back only once on a repeated Escape", async () => {
      const container = await mount(vi.fn().mockResolvedValue(page([photo(3), photo(2)], null)));
      await click(container.querySelector(`[data-photo="${itineraryId(2)}"] button`));
      gate.defer = true;
      await escape(); await escape();
      expect(gate.back).toHaveLength(1);
      await flush();
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(last().pathname).toBe(path);
    });
    it("does not stay blocked if the step back changed nothing and the user then opens another photo and closes it", async () => {
      const container = await mount(vi.fn().mockResolvedValue(page([photo(3), photo(2)], null)));
      await click(container.querySelector(`[data-photo="${itineraryId(2)}"] button`));
      gate.defer = true;
      await click(closeButton());
      expect(gate.back).toHaveLength(1);
      gate.back.length = 0; // history.go had no effect: the viewer is still there
      await click(Array.from(document.querySelectorAll("button")).find((item) => item.textContent === "Anterior"));
      await click(closeButton());
      expect(gate.back).toHaveLength(1);
    });
  });
  it("replaces the entry when moving between photos so back closes in one step", async () => {
    const container = await mount(vi.fn().mockResolvedValue(page([photo(3), photo(2), photo(1)], null)));
    await click(container.querySelector(`[data-photo="${itineraryId(3)}"] button`));
    await click(Array.from(document.querySelectorAll("button")).find((item) => item.textContent === "Siguiente"));
    await click(Array.from(document.querySelectorAll("button")).find((item) => item.textContent === "Siguiente"));
    expect(document.querySelector("h2")?.textContent).toBe("Foto 3 de 3");
    expect(last().state).toEqual({ photo: itineraryId(1), viewerEntry: true });
    await act(async () => go(-1));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(last().pathname).toBe(path);
  });
  it("closes a viewer opened from the grid with one step back, even after moving between photos", async () => {
    const container = await mount(vi.fn().mockResolvedValue(page([photo(3), photo(2), photo(1)], null)));
    await click(container.querySelector(`[data-photo="${itineraryId(3)}"] button`));
    await click(Array.from(document.querySelectorAll("button")).find((item) => item.textContent === "Siguiente"));
    await click(Array.from(document.querySelectorAll("button")).find((item) => item.getAttribute("aria-label") === "Cerrar"));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(last()).toMatchObject({ pathname: path, state: null });
    await act(async () => go(-1));
    expect(last().pathname).toBe(`/trips/${tripId}/memories`);
  });
  it("closes a viewer reopened by a return (state with photo and restore, not opened from the grid) replacing the entry, never going back to the detail", async () => {
    const restore = { anchor: `data-photo=${itineraryId(2)}`, scrollY: 0, panel: "photos" };
    const container = await mount(vi.fn().mockResolvedValue(page([photo(3), photo(2)], null)), [{ pathname: `/trips/${tripId}/memories/${itineraryId(502)}` }]);
    await act(async () => go(path, { state: { photo: itineraryId(2), restore } }));
    expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe("Foto 2 de 2");
    await click(Array.from(document.querySelectorAll("button")).find((item) => item.getAttribute("aria-label") === "Cerrar"));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(last()).toMatchObject({ pathname: path, state: null }); // the restore data was already consumed by the position restore
    expect(thumbs(container)).toEqual([itineraryId(3), itineraryId(2)]);
    await act(async () => go(1));
    expect(last().pathname).toBe(path);
    await act(async () => go(-1));
    expect(last().pathname).toBe(`/trips/${tripId}/memories/${itineraryId(502)}`);
  });
  it("keeps the viewer-entry mark when moving between photos with replace, and closes after a reload with the state alive without leaving the screen", async () => {
    const container = await mount(vi.fn().mockResolvedValue(page([photo(3), photo(2)], null)), [{ pathname: path }, { pathname: path, state: { photo: itineraryId(3), viewerEntry: true } }]);
    await click(Array.from(document.querySelectorAll("button")).find((item) => item.textContent === "Siguiente"));
    expect(last().state).toEqual({ photo: itineraryId(2), viewerEntry: true });
    await click(Array.from(document.querySelectorAll("button")).find((item) => item.getAttribute("aria-label") === "Cerrar"));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(last().pathname).toBe(path);
    expect(thumbs(container)).toEqual([itineraryId(3), itineraryId(2)]);
  });
  it("a reload with the state alive and nothing behind (first entry) closes by replacing, without leaving the screen", async () => {
    seen.length = 0;
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container); roots.push(root);
    const list = vi.fn().mockResolvedValue(page([photo(2)], null));
    await act(async () => root.render(<MemoryRouter initialEntries={[{ pathname: path, state: { photo: itineraryId(2), viewerEntry: true } }]}><Spy />
      <GalleryProvider list={list as never} now={() => NOW}><Routes>
        <Route path="/trips/:tripId/memories/photos" element={<TripPhotosScreen members={members as never} timeZone="America/Argentina/Buenos_Aires" />} />
      </Routes></GalleryProvider></MemoryRouter>));
    expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe("Foto 1 de 1");
    await click(Array.from(document.querySelectorAll("button")).find((item) => item.getAttribute("aria-label") === "Cerrar"));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(last()).toMatchObject({ pathname: path, state: null });
    expect(container.querySelector("ul.photo-grid")).not.toBeNull();
  });
  it("a forced close (the open photo vanished after a refresh) undoes the grid entry with a step back, never leaving a duplicated entry", async () => {
    const list = vi.fn().mockResolvedValueOnce(page([photo(3), photo(2)], null)).mockResolvedValueOnce(page([photo(3)], null));
    const container = await mount(list);
    await click(container.querySelector(`[data-photo="${itineraryId(2)}"] button`));
    expect(last().state).toEqual({ photo: itineraryId(2), viewerEntry: true });
    const before = seen.length;
    await act(async () => document.querySelector("img")!.dispatchEvent(new Event("error")));
    await act(async () => { await Promise.resolve(); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(thumbs(container)).toEqual([itineraryId(3)]);
    expect(last()).toMatchObject({ pathname: path, state: null });
    expect(alerts(document)).toHaveLength(0);
    expect(seen.length - before).toBeLessThan(8); // no loop
    await act(async () => go(-1)); // the first step back leaves the grid: no duplicated entry behind
    expect(last().pathname).toBe(`/trips/${tripId}/memories`);
  });
  it("a reload (first entry) with a viewerEntry photo missing from page 1 cleans the state in place, without leaving the screen nor looping", async () => {
    seen.length = 0;
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container); roots.push(root);
    const list = vi.fn().mockResolvedValue(page([photo(2)], null));
    await act(async () => root.render(<MemoryRouter initialEntries={[{ pathname: path, state: { photo: itineraryId(77), viewerEntry: true } }]}><Spy />
      <GalleryProvider list={list as never} now={() => NOW}><Routes>
        <Route path="/trips/:tripId/memories/photos" element={<TripPhotosScreen members={members as never} timeZone="America/Argentina/Buenos_Aires" />} />
      </Routes></GalleryProvider></MemoryRouter>));
    await act(async () => { await Promise.resolve(); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(last()).toMatchObject({ pathname: path, state: null });
    expect(thumbs(container)).toEqual([itineraryId(2)]);
    expect(alerts(document)).toHaveLength(0);
    expect(seen.length).toBeLessThan(8);
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
    expect(last().state).toEqual({ photo: itineraryId(2), viewerEntry: true });
  });
  describe("notices with the viewer open", () => {
    const dialogAlerts = () => document.querySelectorAll('[role="dialog"] [role="alert"]');
    const next = () => Array.from(document.querySelectorAll("button")).find((item) => item.textContent === "Siguiente");
    it("shows a failed load of more photos as the single alert inside the dialog and retries from there", async () => {
      const list = vi.fn().mockResolvedValueOnce(page([photo(3), photo(2)], "c1")).mockResolvedValueOnce(fail("server")).mockResolvedValueOnce(page([photo(1)], null));
      const container = await mount(list);
      await click(container.querySelector(`[data-photo="${itineraryId(2)}"] button`));
      await click(next());
      expect(alerts(document)).toHaveLength(1);
      expect(dialogAlerts()).toHaveLength(1);
      expect(dialogAlerts()[0]!.textContent).toContain("No pudimos cargar las fotos");
      expect(alerts(container.querySelector(".trips-panel")!)).toHaveLength(1); // the same one (the dialog lives in the panel)
      expect(Array.from(container.querySelectorAll(".trips-panel > .trips-state"))).toHaveLength(0);
      await click(Array.from(document.querySelectorAll('[role="dialog"] button')).find((item) => item.textContent === "Reintentar"));
      expect(list).toHaveBeenLastCalledWith(tripId, { cursor: "c1" });
      expect(alerts(document)).toHaveLength(0);
      expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe("Foto 2 de 3");
      await click(next());
      expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe("Foto 3 de 3");
    });
    const openFailing = async (failure: unknown, extra: unknown[] = []) => {
      const list = vi.fn().mockResolvedValueOnce(page([photo(3), photo(2)], "c1")).mockResolvedValueOnce(failure);
      for (const item of extra) list.mockResolvedValueOnce(item);
      const container = await mount(list);
      await click(container.querySelector(`[data-photo="${itineraryId(2)}"] button`));
      await click(next());
      return { list, container };
    };
    const inDialog = (text: string) => Array.from(document.querySelectorAll('[role="dialog"] a, [role="dialog"] button')).find((item) => item.textContent === text) as HTMLElement | undefined;
    it("offers the login link inside the dialog on a 401 with the viewer open, once and inside the focus trap", async () => {
      const { container } = await openFailing(fail("unauthorized"));
      expect(alerts(document)).toHaveLength(1);
      expect(dialogAlerts()[0]!.textContent).toContain("Volvé a iniciar sesión");
      expect(inDialog("Iniciar sesión")?.getAttribute("href")).toBe("/login");
      expect(inDialog("Reintentar")).toBeUndefined();
      expect(Array.from(container.querySelectorAll(".trips-panel > .trips-state"))).toHaveLength(0);
      expect(document.querySelector('[role="dialog"] [aria-live]')).toBeNull();
      const link = inDialog("Iniciar sesión")!;
      expect(document.querySelector('[role="dialog"]')!.contains(link)).toBe(true);
      link.focus();
      expect(document.activeElement).toBe(link);
    });
    it("wraps the focus inside the dialog: Tab from the last focusable goes to the first and Shift+Tab from the first goes to the last", async () => {
      await openFailing(fail("unauthorized"));
      const focusables = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"] a[href], [role="dialog"] button:not([disabled])'));
      const first = focusables[0]!; const lastOne = focusables[focusables.length - 1]!;
      expect(first).not.toBe(lastOne);
      const press = (element: HTMLElement, shiftKey: boolean) => act(async () => { element.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true })); });
      lastOne.focus();
      await press(lastOne, false);
      expect(document.activeElement).toBe(first);
      await press(first, true);
      expect(document.activeElement).toBe(lastOne);
    });
    it("offers «Volver a cargar desde el inicio» on a rejected cursor with the viewer open and restarts from page 1 without looping", async () => {
      const { list } = await openFailing(fail("validation", [{ field: "cursor" }]), [page([photo(3), photo(2)], null)]);
      expect(alerts(document)).toHaveLength(1);
      expect(dialogAlerts()[0]!.textContent).toContain("desde el inicio");
      expect(inDialog("Reintentar")).toBeUndefined();
      await click(inDialog("Volver a cargar desde el inicio"));
      expect(list).toHaveBeenCalledTimes(3);
      expect(list).toHaveBeenLastCalledWith(tripId, {});
      expect(alerts(document)).toHaveLength(0);
      expect(thumbs(document)).toEqual([itineraryId(3), itineraryId(2)]);
      await act(async () => { await Promise.resolve(); });
      expect(list).toHaveBeenCalledTimes(3);
    });
    it("restarting with the viewer open closes it for good (as «Cerrar» does), does not reopen it although the photo is on page 1 and keeps the focus off the body", async () => {
      const { list } = await openFailing(fail("validation", [{ field: "cursor" }]), [page([photo(3), photo(2)], null)]);
      expect(last().state).toEqual({ photo: itineraryId(2), viewerEntry: true });
      await click(inDialog("Volver a cargar desde el inicio"));
      await act(async () => { await Promise.resolve(); });
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(last().pathname).toBe(path);
      expect(last().state).toBeNull();
      expect(thumbs(document)).toEqual([itineraryId(3), itineraryId(2)]);
      expect(list).toHaveBeenCalledTimes(3);
      expect(list.mock.calls.filter((call) => call[1] && !("cursor" in (call[1] as object)))).toHaveLength(2); // first load and the single restart
      expect(document.activeElement).not.toBe(document.body);
      expect(document.activeElement?.closest("main")).not.toBeNull();
    });
    it("restarting with a viewer that has no viewer-entry mark closes it replacing the entry, never leaving the screen", async () => {
      const restore = { anchor: `data-photo=${itineraryId(2)}`, scrollY: 0, panel: "photos" };
      const list = vi.fn().mockResolvedValueOnce(page([photo(3), photo(2)], "c1")).mockResolvedValueOnce(fail("validation", [{ field: "cursor" }])).mockResolvedValueOnce(page([photo(3), photo(2)], null));
      await mount(list, [{ pathname: `/trips/${tripId}/memories/${itineraryId(502)}` }]);
      await act(async () => go(path, { state: { photo: itineraryId(2), restore } }));
      await click(next());
      await click(inDialog("Volver a cargar desde el inicio"));
      await act(async () => { await Promise.resolve(); });
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(last()).toMatchObject({ pathname: path, state: null });
    });
    it("keeps «Reintentar» inside the dialog for network and server failures and offers no action for a 404", async () => {
      for (const kind of ["network", "server"]) {
        document.body.replaceChildren();
        await openFailing(fail(kind));
        expect(alerts(document)).toHaveLength(1);
        expect(inDialog("Reintentar")).toBeTruthy();
        expect(inDialog("Iniciar sesión")).toBeUndefined();
        expect(inDialog("Volver a cargar desde el inicio")).toBeUndefined();
      }
      document.body.replaceChildren();
      await openFailing(fail("not-found"));
      expect(alerts(document)).toHaveLength(1);
      expect(dialogAlerts()[0]!.textContent).toContain("no están disponibles");
      for (const text of ["Reintentar", "Iniciar sesión", "Volver a cargar desde el inicio"]) expect(inDialog(text)).toBeUndefined();
    });
    it("announces the load in progress inside the dialog and not outside it", async () => {
      const second = deferred<unknown>();
      const list = vi.fn().mockResolvedValueOnce(page([photo(3), photo(2)], "c1")).mockReturnValueOnce(second.promise);
      const container = await mount(list);
      await click(container.querySelector(`[data-photo="${itineraryId(2)}"] button`));
      await click(next());
      const inside = Array.from(document.querySelectorAll('[role="dialog"] [role="status"]')).filter((item) => item.textContent === "Cargando más fotos…");
      expect(inside).toHaveLength(1);
      expect(container.textContent?.split("Cargando más fotos…").length).toBe(2);
      await act(async () => second.resolve(page([photo(1)], null)));
      expect(container.textContent).not.toContain("Cargando más fotos…");
    });
    it("keeps the previous behaviour with the viewer closed: the alert and the retry are in the page", async () => {
      const list = vi.fn().mockResolvedValueOnce(page([photo(3), photo(2)], "c1")).mockResolvedValueOnce(fail("server"));
      const container = await mount(list);
      await click(container.querySelector(`[data-photo="${itineraryId(2)}"] button`));
      await click(next());
      await click(Array.from(document.querySelectorAll("button")).find((item) => item.getAttribute("aria-label") === "Cerrar"));
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(alerts(container)).toHaveLength(1);
      expect(byText(container, "Reintentar")).toBeTruthy();
    });
    it("shows the refresh failure inside the dialog with the viewer open, once, and in the page once it is closed", async () => {
      const list = vi.fn().mockResolvedValueOnce(page([photo(3), photo(2)], null)).mockResolvedValueOnce(fail("network"));
      const container = await mount(list);
      await click(container.querySelector(`[data-photo="${itineraryId(2)}"] button`));
      await act(async () => document.querySelector("img")!.dispatchEvent(new Event("error")));
      await act(async () => { await Promise.resolve(); });
      expect(alerts(document)).toHaveLength(1);
      expect(dialogAlerts()).toHaveLength(1);
      expect(dialogAlerts()[0]!.textContent).toContain("No pudimos renovar algunas fotos");
      await click(Array.from(document.querySelectorAll("button")).find((item) => item.getAttribute("aria-label") === "Cerrar"));
      expect(alerts(container)).toHaveLength(1);
      expect(container.textContent).toContain("No pudimos renovar algunas fotos");
    });
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
