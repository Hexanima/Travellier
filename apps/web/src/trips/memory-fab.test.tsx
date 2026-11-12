// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoriesLayout, TripMemoriesScreen } from "./TripMemoriesScreen.js";
import { TripPhotosScreen } from "./TripPhotosScreen.js";
import { GalleryProvider } from "./use-gallery.js";
import { itineraryId } from "./itinerary-test-fixture.js";
import type { GalleryPhoto } from "./trip-gallery-api.js";
import type { PostResponse } from "./trip-post-api.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
const tripId = itineraryId(1);
const me = itineraryId(600);
const NOW = Date.parse("2026-11-10T12:00:00.000Z");
const create = `/trips/${tripId}/memories/new`;
const post = (n: number): PostResponse => ({ id: itineraryId(n), tripId, authorId: me, description: `Recuerdo ${n}`, mapsUrl: null, activityId: null,
  parentPostId: null, transportId: null, createdAt: "2026-01-02T15:30:00.000Z" });
const photo = (n: number): GalleryPhoto => ({ id: itineraryId(n), postId: itineraryId(500 + n), order: 0, uploadedAt: "2026-11-10T01:30:00.000Z", uploaderId: me,
  url: `https://s3.test/${n}?sig=SECRET${n}`, expiresAtMs: NOW + 300_000, post: { createdAt: "2026-11-10T01:00:00.000Z", authorId: me, rootActivityId: null, rootTransportId: null } });
const members = { list: vi.fn() };
beforeEach(() => { members.list.mockReset().mockResolvedValue({ ok: true, value: { currentUserId: me, members: [] } }); });
const never = () => new Promise<never>(() => undefined);
const failure = { ok: false as const, error: { kind: "server" } };

async function renderPosts(list: () => unknown) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={[`/trips/${tripId}/memories`]}><Routes>
    <Route path="/trips/:tripId/memories" element={<MemoriesLayout />}>
      <Route index element={<TripMemoriesScreen posts={{ list } as never} timeZone="America/Argentina/Buenos_Aires" />} />
      <Route path="new" element={<h1>COMPOSITOR</h1>} />
    </Route>
  </Routes></MemoryRouter>));
  return container;
}
async function renderPhotos(list: () => unknown) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={[`/trips/${tripId}/memories/photos`]}>
    <GalleryProvider list={list as never} now={() => NOW}><Routes>
      <Route path="/trips/:tripId/memories/photos" element={<TripPhotosScreen members={members as never} timeZone="America/Argentina/Buenos_Aires" />} />
      <Route path="/trips/:tripId/memories/new" element={<h1>COMPOSITOR</h1>} />
    </Routes></GalleryProvider></MemoryRouter>));
  return container;
}
const fabs = (container: ParentNode) => Array.from(container.querySelectorAll("a")).filter((item) => item.textContent === "Nuevo recuerdo");
const expectSingleFab = (container: ParentNode) => {
  const found = fabs(container);
  expect(found).toHaveLength(1);
  expect(found[0]!.getAttribute("href")).toBe(create);
  expect(found[0]!.classList.contains("memory-fab")).toBe(true);
  expect(found[0]!.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  expect(container.querySelectorAll(`a[href="${create}"].memory-fab`)).toHaveLength(1);
};
const open = async (container: HTMLElement) => {
  await act(async () => fabs(container)[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })));
  expect(container.querySelector("h1")?.textContent).toBe("COMPOSITOR");
};

describe("acceso flotante a Nuevo recuerdo en Posts", () => {
  it("con recuerdos: un único enlace flotante que abre el compositor directo", async () => {
    const container = await renderPosts(vi.fn().mockResolvedValue({ ok: true, value: [post(11), post(12)] }));
    expectSingleFab(container);
    await open(container);
  });
  it("vacío: el flotante convive con «Crear el primer recuerdo»", async () => {
    const container = await renderPosts(vi.fn().mockResolvedValue({ ok: true, value: [] }));
    expectSingleFab(container);
    expect(container.textContent).toContain("Crear el primer recuerdo");
    await open(container);
  });
  it("cargando y con error sigue disponible", async () => {
    expectSingleFab(await renderPosts(vi.fn().mockReturnValue(never())));
    const errored = await renderPosts(vi.fn().mockResolvedValue(failure));
    expect(errored.textContent).toContain("No pudimos cargar los recuerdos");
    expectSingleFab(errored);
  });
  it("el contenido de la pantalla queda dentro de un contenedor con espacio inferior para el flotante", async () => {
    const container = await renderPosts(vi.fn().mockResolvedValue({ ok: true, value: [post(11)] }));
    const feed = container.querySelector(".memory-feed");
    expect(feed?.querySelector("ul.memories-list")).toBeTruthy();
  });
});

describe("acceso flotante a Nuevo recuerdo en Fotos", () => {
  it("con fotos: un único enlace flotante que abre el compositor directo", async () => {
    const container = await renderPhotos(vi.fn().mockResolvedValue({ ok: true, value: { photos: [photo(2), photo(1)], nextCursor: null } }));
    expect(container.querySelector("ul.photo-grid")).toBeTruthy();
    expectSingleFab(container);
    await open(container);
  });
  it("vacío: un único enlace (el del estado vacío se reemplazó por el flotante)", async () => {
    const container = await renderPhotos(vi.fn().mockResolvedValue({ ok: true, value: { photos: [], nextCursor: null } }));
    expect(container.textContent).toContain("Todavía no hay fotos");
    expectSingleFab(container);
    await open(container);
  });
  it("cargando y con error sigue disponible", async () => {
    const loading = await renderPhotos(vi.fn().mockReturnValue(never()));
    expect(loading.textContent).toContain("Cargando fotos…");
    expectSingleFab(loading);
    const errored = await renderPhotos(vi.fn().mockResolvedValue(failure));
    expect(errored.querySelector('[role="alert"]')).toBeTruthy();
    expectSingleFab(errored);
  });
});

describe("el acceso flotante no queda sobre el visor de fotos", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const zOf = (css: string, selector: string) => Number(/z-index:\s*(\d+)/.exec(css.split(`\n${selector} {`)[1]?.split("}")[0] ?? "")?.[1]);
  it("con el visor abierto el modal es un diálogo cuyo backdrop pinta por encima del flotante", async () => {
    const container = await renderPhotos(vi.fn().mockResolvedValue({ ok: true, value: { photos: [photo(2), photo(1)], nextCursor: null } }));
    expectSingleFab(container);
    await act(async () => container.querySelector<HTMLButtonElement>(".photo-grid__open")!.click());
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    const backdrop = dialog!.closest(".ui-modal-backdrop");
    expect(backdrop).toBeTruthy();
    const fabZ = zOf(read("./itinerary.css"), ".memory-fab");
    const backdropZ = zOf(read("../components/components.css"), ".ui-modal-backdrop");
    expect(fabZ).toBeGreaterThan(0);
    expect(backdropZ).toBeGreaterThan(fabZ);
    expect(backdrop!.querySelector("a.memory-fab")).toBeNull();
  });
  it("al cerrar el visor vuelve a haber un único enlace «Nuevo recuerdo»", async () => {
    const container = await renderPhotos(vi.fn().mockResolvedValue({ ok: true, value: { photos: [photo(2)], nextCursor: null } }));
    await act(async () => container.querySelector<HTMLButtonElement>(".photo-grid__open")!.click());
    await act(async () => document.querySelector<HTMLButtonElement>('[role="dialog"] .ui-modal__close')!.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expectSingleFab(container);
  });
});
