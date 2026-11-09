// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoriesLayout, TripMemoriesScreen } from "./TripMemoriesScreen.js";
import { itineraryId } from "./itinerary-test-fixture.js";
import type { PostResponse } from "./trip-post-api.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
const tripId = itineraryId(1);
const post = (n: number, createdAt: string, description: string | null = `Recuerdo ${n}`): PostResponse => ({ id: itineraryId(n), tripId, authorId: itineraryId(20),
  description, mapsUrl: null, activityId: null, parentPostId: null, transportId: null, createdAt });
async function render(list: ReturnType<typeof vi.fn>, state?: unknown) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={[{ pathname: `/trips/${tripId}/memories`, state }]}><Routes>
    <Route path="/trips/:tripId/memories" element={<MemoriesLayout />}>
      <Route index element={<TripMemoriesScreen posts={{ list }} timeZone="America/Argentina/Buenos_Aires" />} />
    </Route>
  </Routes></MemoryRouter>));
  return container;
}
const texts = (container: HTMLElement) => Array.from(container.querySelectorAll("li")).map((item) => item.querySelector("p")?.textContent);
const click = async (element: Element | null | undefined) => { expect(element).toBeTruthy(); await act(async () => element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))); };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };

describe("TripMemoriesScreen", () => {
  it("lists newest first with id descending as tiebreak, even if the server order differs", async () => {
    const same = "2026-01-02T10:00:00.000Z";
    const container = await render(vi.fn().mockResolvedValue({ ok: true, value: [post(11, "2026-01-01T10:00:00.000Z"), post(12, same), post(13, same), post(14, "2026-01-03T10:00:00.000Z")] }));
    expect(container.querySelector("h1")?.textContent).toBe("Recuerdos");
    expect(texts(container)).toEqual(["Recuerdo 14", "Recuerdo 13", "Recuerdo 12", "Recuerdo 11"]);
  });
  it("shows text or a placeholder, the local publication date and an edit link", async () => {
    const container = await render(vi.fn().mockResolvedValue({ ok: true, value: [post(11, "2026-01-02T15:30:00.000Z", null)] }));
    expect(container.textContent).toContain("Recuerdo sin texto.");
    expect(container.textContent).toMatch(/Publicado .*2026.*12:30/);
    expect(container.querySelector(`a[href="/trips/${tripId}/memories/${itineraryId(11)}/edit"]`)?.textContent).toBe("Editar");
    expect(container.querySelector(`a[href="/trips/${tripId}/memories/new"]`)?.textContent).toBe("Nuevo recuerdo");
  });
  it("shows the loading state and then the empty state with a creation link", async () => {
    const pending = deferred<unknown>();
    const list = vi.fn().mockReturnValue(pending.promise);
    const container = await render(list);
    expect(container.textContent).toContain("Cargando recuerdos…");
    await act(async () => pending.resolve({ ok: true, value: [] }));
    expect(container.textContent).toContain("Todavía no hay recuerdos.");
    expect(container.querySelectorAll(`a[href="/trips/${tripId}/memories/new"]`).length).toBeGreaterThanOrEqual(2);
  });
  it("shows an error with retry", async () => {
    const list = vi.fn().mockResolvedValueOnce({ ok: false, error: { kind: "network" } }).mockResolvedValueOnce({ ok: true, value: [post(11, "2026-01-02T10:00:00.000Z")] });
    const container = await render(list);
    expect(container.textContent).toContain("No pudimos cargar los recuerdos");
    await click(Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "Reintentar"));
    expect(texts(container)).toEqual(["Recuerdo 11"]);
  });
  it("is unavailable on 404 and does not offer retry", async () => {
    const container = await render(vi.fn().mockResolvedValue({ ok: false, error: { kind: "not-found" } }));
    expect(container.textContent).toContain("Los recuerdos de este viaje no están disponibles para tu cuenta.");
    expect(Array.from(container.querySelectorAll("button")).some((item) => item.textContent === "Reintentar")).toBe(false);
  });
  it("shows the saved post on top without waiting for the refresh, which then neither duplicates nor loses it", async () => {
    const saved = post(20, "2026-01-05T10:00:00.000Z", "Recién guardado");
    const pending = deferred<unknown>();
    const list = vi.fn().mockReturnValue(pending.promise);
    const container = await render(list, { post: saved, notice: "created" });
    expect(texts(container)).toEqual(["Recién guardado"]);
    expect(container.textContent).toContain("Recuerdo publicado.");
    expect(list).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ ok: true, value: [post(11, "2026-01-01T10:00:00.000Z"), saved] }));
    expect(texts(container)).toEqual(["Recién guardado", "Recuerdo 11"]);
  });
  it("keeps the saved post when a refresh arrives without it", async () => {
    const saved = post(20, "2026-01-05T10:00:00.000Z", "Recién guardado");
    const container = await render(vi.fn().mockResolvedValue({ ok: true, value: [post(11, "2026-01-01T10:00:00.000Z")] }), { post: saved, notice: "created" });
    expect(texts(container)).toEqual(["Recién guardado", "Recuerdo 11"]);
  });
  it("replaces an edited post and confirms the changes", async () => {
    const edited = post(11, "2026-01-01T10:00:00.000Z", "Editado");
    const pending = deferred<unknown>();
    const container = await render(vi.fn().mockReturnValue(pending.promise), { post: edited, notice: "updated" });
    expect(texts(container)).toEqual(["Editado"]);
    expect(container.textContent).toContain("Cambios guardados.");
    await act(async () => pending.resolve({ ok: true, value: [post(11, "2026-01-01T10:00:00.000Z", "Editado"), post(12, "2025-01-01T10:00:00.000Z")] }));
    expect(texts(container)).toEqual(["Editado", "Recuerdo 12"]);
  });
  it("keeps the local post and warns when the refresh fails", async () => {
    const saved = post(20, "2026-01-05T10:00:00.000Z", "Recién guardado");
    const container = await render(vi.fn().mockResolvedValue({ ok: false, error: { kind: "network" } }), { post: saved, notice: "created" });
    expect(texts(container)).toEqual(["Recién guardado"]);
    expect(container.textContent).toContain("No pudimos actualizar los recuerdos");
  });
  it("deduplicates repeated ids from the server", async () => {
    const container = await render(vi.fn().mockResolvedValue({ ok: true, value: [post(11, "2026-01-01T10:00:00.000Z"), post(11, "2026-01-01T10:00:00.000Z")] }));
    expect(texts(container)).toEqual(["Recuerdo 11"]);
  });
  it("ignores a malformed navigation state", async () => {
    const container = await render(vi.fn().mockResolvedValue({ ok: true, value: [] }), { post: { id: 1 }, notice: "created" });
    expect(container.textContent).toContain("Todavía no hay recuerdos.");
    expect(container.textContent).not.toContain("Recuerdo publicado.");
  });
});
