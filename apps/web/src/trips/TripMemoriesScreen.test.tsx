// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoriesLayout, TripMemoriesScreen } from "./TripMemoriesScreen.js";
import { PostDraftsProvider, usePostDraft } from "./use-post-drafts.js";
import { CommentDraftsProvider, useCommentDraft } from "./use-comment-drafts.js";
import { itineraryId } from "./itinerary-test-fixture.js";
import { emptyDraft } from "./post-draft.js";
import type { PostResponse } from "./trip-post-api.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
const tripId = itineraryId(1);
const post = (n: number, createdAt: string, description: string | null = `Recuerdo ${n}`): PostResponse => ({ id: itineraryId(n), tripId, authorId: itineraryId(20),
  description, mapsUrl: null, activityId: null, parentPostId: null, transportId: null, createdAt });
async function render(list: ReturnType<typeof vi.fn>, state?: unknown, members?: ReturnType<typeof vi.fn>) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={[{ pathname: `/trips/${tripId}/memories`, state }]}><Routes>
    <Route path="/trips/:tripId/memories" element={<MemoriesLayout />}>
      <Route index element={<TripMemoriesScreen posts={{ list }} {...(members ? { members: { list: members } } : {})} timeZone="America/Argentina/Buenos_Aires" />} />
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
  it("no longer carries the provisional link to the gallery: the Posts/Fotos tabs of the Trip shell reach it (see TripShell and App.navigation)", async () => {
    const container = await render(vi.fn().mockResolvedValue({ ok: true, value: [] }));
    expect(Array.from(container.querySelectorAll("a")).some((item) => item.textContent === "Fotos" || item.getAttribute("href")?.endsWith("/memories/photos"))).toBe(false);
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
  it("el vacío del diario ofrece la creación como botón primario, como el del itinerario (T153)", async () => {
    const container = await render(vi.fn().mockResolvedValue({ ok: true, value: [] }));
    const action = container.querySelector(`.trips-empty a[href="/trips/${tripId}/memories/new"]`);
    expect(action?.textContent).toBe("Crear el primer recuerdo");
    expect(action?.classList.contains("ui-button")).toBe(true);
    // Es la única acción del vacío: nada compite con ella como secundaria.
    expect(action?.classList.contains("ui-button--secondary")).toBe(false);
  });
  it("shows an error with retry", async () => {
    const list = vi.fn().mockResolvedValueOnce({ ok: false, error: { kind: "network" } }).mockResolvedValueOnce({ ok: true, value: [post(11, "2026-01-02T10:00:00.000Z")] });
    const container = await render(list);
    expect(container.textContent).toContain("No pudimos cargar los recuerdos");
    await click(Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "Reintentar"));
    expect(texts(container)).toEqual(["Recuerdo 11"]);
  });
  it("un timeout tiene su propio texto y conserva el reintento", async () => {
    const list = vi.fn().mockResolvedValueOnce({ ok: false, error: { kind: "network", code: "TimeoutError" } })
      .mockResolvedValueOnce({ ok: true, value: [post(11, "2026-01-02T10:00:00.000Z")] });
    const container = await render(list);
    expect(container.textContent).toContain("La conexión tardó demasiado. Intentá nuevamente.");
    expect(container.textContent).not.toContain("No pudimos cargar los recuerdos");
    await click(Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "Reintentar"));
    expect(texts(container)).toEqual(["Recuerdo 11"]);
  });
  it("una conexión caída conserva el texto de siempre", async () => {
    const container = await render(vi.fn().mockResolvedValue({ ok: false, error: { kind: "network", code: "NetworkError" } }));
    expect(container.textContent).toContain("No pudimos cargar los recuerdos");
    expect(container.textContent).not.toContain("tardó demasiado");
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
  const statuses = (container: HTMLElement) => Array.from(container.querySelectorAll('[role="status"]')).map((item) => item.textContent);
  it.each([
    ["created-activity", true, "Recuerdo publicado y actividad creada. Vas a ir."],
    ["created-activity", false, "Recuerdo publicado y actividad creada."],
    ["linked-activity", true, "Cambios guardados y actividad creada. Vas a ir."],
    ["linked-activity", false, "Cambios guardados y actividad creada."],
  ])("confirms %s (going %s) with the created activity", async (notice, going, message) => {
    const saved = post(20, "2026-01-05T10:00:00.000Z", "Recién guardado");
    const container = await render(vi.fn().mockResolvedValue({ ok: true, value: [post(11, "2026-01-01T10:00:00.000Z")] }), { post: saved, notice, going });
    expect(texts(container)).toEqual(["Recién guardado", "Recuerdo 11"]);
    expect(statuses(container)).toContain(message);
    expect(statuses(container).filter((text) => text?.includes("Recuerdo publicado") || text?.includes("Cambios guardados"))).toHaveLength(1);
  });
  it("keeps the plain notices without mentioning an activity", async () => {
    const saved = post(20, "2026-01-05T10:00:00.000Z", "Recién guardado");
    const container = await render(vi.fn().mockResolvedValue({ ok: true, value: [] }), { post: saved, notice: "created", going: true });
    expect(statuses(container)).toContain("Recuerdo publicado.");
    expect(container.textContent).not.toContain("actividad creada");
  });
  it("ignores an unknown notice", async () => {
    const container = await render(vi.fn().mockResolvedValue({ ok: true, value: [] }), { post: post(20, "2026-01-05T10:00:00.000Z"), notice: "other" });
    expect(container.textContent).toContain("Todavía no hay recuerdos.");
  });
});

describe("TripMemoriesScreen detail links and restoration", () => {
  type Entry = { pathname: string; search: string; state: unknown };
  const seen: Entry[] = [];
  function Spy() { const location = useLocation(); seen.push({ pathname: location.pathname, search: location.search, state: location.state }); return null; }
  function Detail() { const navigate = useNavigate(); return <button onClick={() => navigate(-1)}>atrás</button>; }
  const scrollIntoView = vi.fn(); const scrollTo = vi.fn();
  const setScroll = (value: number) => Object.defineProperty(window, "scrollY", { value, configurable: true });
  beforeEach(() => {
    seen.length = 0; scrollIntoView.mockReset(); scrollTo.mockReset(); setScroll(0);
    Element.prototype.scrollIntoView = scrollIntoView; window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
  });
  async function open(list: ReturnType<typeof vi.fn>, state?: unknown) {
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container); roots.push(root);
    await act(async () => root.render(<MemoryRouter initialEntries={[{ pathname: `/trips/${tripId}/memories`, state }]}><Spy /><Routes>
      <Route path="/trips/:tripId/memories" element={<MemoriesLayout />}>
        <Route index element={<TripMemoriesScreen posts={{ list }} timeZone="America/Argentina/Buenos_Aires" />} />
        <Route path=":postId" element={<Detail />} />
      </Route>
    </Routes></MemoryRouter>));
    return container;
  }
  const anchor = (n: number) => `data-memory=${itineraryId(n)}`;
  const listOf = (...posts: PostResponse[]) => vi.fn().mockResolvedValue({ ok: true, value: posts });
  const last = () => seen[seen.length - 1];

  it("links each excerpt to the detail and keeps Editar and Nuevo recuerdo", async () => {
    const container = await open(listOf(post(11, "2026-01-02T10:00:00.000Z"), post(12, "2026-01-03T10:00:00.000Z", null)));
    expect(texts(container)).toEqual(["Recuerdo sin texto.", "Recuerdo 11"]);
    expect(container.querySelector(`li[data-memory="${itineraryId(11)}"] a[href="/trips/${tripId}/memories/${itineraryId(11)}"]`)?.textContent).toBe("Recuerdo 11");
    expect(container.querySelector(`li[data-memory="${itineraryId(12)}"] a[href="/trips/${tripId}/memories/${itineraryId(12)}"]`)?.textContent).toBe("Recuerdo sin texto.");
    expect(container.querySelector(`a[href="/trips/${tripId}/memories/${itineraryId(11)}/edit"]`)?.textContent).toBe("Editar");
    expect(container.querySelector(`a[href="/trips/${tripId}/memories/new"]`)?.textContent).toBe("Nuevo recuerdo");
  });
  it("shows posts dated outside the trip, newest first and unfiltered", async () => {
    const container = await open(listOf(post(11, "2020-01-02T10:00:00.000Z"), post(12, "2030-01-03T10:00:00.000Z"), post(13, "2026-06-01T10:00:00.000Z")));
    expect(texts(container)).toEqual(["Recuerdo 12", "Recuerdo 13", "Recuerdo 11"]);
  });
  it("saves the anchor and scroll in the current entry and then opens the detail with the origin", async () => {
    setScroll(480);
    const container = await open(listOf(post(11, "2026-01-02T10:00:00.000Z")));
    await click(container.querySelector(`li[data-memory="${itineraryId(11)}"] a`));
    const entries = seen.map((entry) => entry.pathname);
    expect(entries.slice(-2)).toEqual([`/trips/${tripId}/memories`, `/trips/${tripId}/memories/${itineraryId(11)}`]);
    expect(last().state).toEqual({ origin: { path: `/trips/${tripId}/memories`, label: "diario", anchor: anchor(11), scrollY: 480 } });
    await click(Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "atrás"));
    expect(seen.some((entry) => entry.pathname === `/trips/${tripId}/memories` && JSON.stringify(entry.state) === JSON.stringify({ restore: { anchor: anchor(11), scrollY: 480 } }))).toBe(true);
    expect(last().state).toBeNull();
  });
  it("restores the anchor when coming back, only after the list is ready, once, and cleans the state", async () => {
    const pending = deferred<unknown>();
    const list = vi.fn().mockReturnValue(pending.promise);
    const container = await open(list, { restore: { anchor: anchor(11), scrollY: 300 } });
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
    expect(last().state).toEqual({ restore: { anchor: anchor(11), scrollY: 300 } });
    await act(async () => pending.resolve({ ok: true, value: [post(11, "2026-01-02T10:00:00.000Z"), post(12, "2026-01-01T10:00:00.000Z")] }));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(container.querySelector(`[data-memory="${itineraryId(11)}"]`));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    expect(document.activeElement).toBe(container.querySelector(`[data-memory="${itineraryId(11)}"]`));
    expect(scrollTo).not.toHaveBeenCalled();
    expect(last().state).toBeNull();
  });
  it("falls back to the saved scroll when the anchor no longer exists, without errors or messages", async () => {
    const container = await open(listOf(post(12, "2026-01-01T10:00:00.000Z")), { restore: { anchor: anchor(11), scrollY: 300 } });
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(scrollTo).toHaveBeenCalledWith(0, 300);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(last().state).toBeNull();
  });
  it("does not restore anything for a malformed restore state", async () => {
    await open(listOf(post(11, "2026-01-02T10:00:00.000Z")), { restore: { anchor: "[data-memory]", scrollY: 3 } });
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
  });
  it("restores the place after opening a detail and going back", async () => {
    setScroll(200);
    const container = await open(listOf(post(11, "2026-01-02T10:00:00.000Z")));
    await click(container.querySelector(`li[data-memory="${itineraryId(11)}"] a`));
    await click(Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "atrás"));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(last().pathname).toBe(`/trips/${tripId}/memories`);
  });

  describe("already saved notice (T88)", () => {
    const text = "Ese recuerdo ya se había guardado. Revisá si tus últimos cambios hacen falta.";
    it("shows the notice and a link to the saved memory while still listing from the server", async () => {
      const list = vi.fn().mockResolvedValue({ ok: true, value: [post(11, "2026-01-01T10:00:00.000Z")] });
      const container = await render(list, { notice: "already-saved", postId: itineraryId(11) });
      expect(container.textContent).toContain(text);
      expect(Array.from(container.querySelectorAll("a")).find((item) => item.textContent === "Ver recuerdo")?.getAttribute("href")).toBe(`/trips/${tripId}/memories/${itineraryId(11)}`);
      expect(list).toHaveBeenCalledOnce();
      expect(texts(container)).toEqual(["Recuerdo 11"]);
    });
    it("shows the notice before the list arrives and without a link when there is no valid postId", async () => {
      const pending = deferred<unknown>();
      const container = await render(vi.fn().mockReturnValue(pending.promise), { notice: "already-saved", postId: "../x" });
      expect(container.textContent).toContain(text);
      expect(Array.from(container.querySelectorAll("a")).some((item) => item.textContent === "Ver recuerdo")).toBe(false);
      await act(async () => pending.resolve({ ok: true, value: [] }));
    });
    it("shows nothing for a notice that is not known", async () => {
      const container = await render(vi.fn().mockResolvedValue({ ok: true, value: [] }), { notice: "other" });
      expect(container.textContent).not.toContain(text);
    });
  });
});

describe("TripMemoriesScreen authorship (T125)", () => {
  const author = itineraryId(20), someone = itineraryId(21);
  const people = (currentUserId: string) => vi.fn().mockResolvedValue({ ok: true, value: { currentUserId, members: [{ userId: author, name: "Ana" }, { userId: someone, name: "Beto" }] } });
  const editLink = (container: HTMLElement, n: number) => container.querySelector<HTMLAnchorElement>(`a[href="/trips/${tripId}/memories/${itineraryId(n)}/edit"]`);
  const list = () => vi.fn().mockResolvedValue({ ok: true, value: [post(11, "2026-01-02T10:00:00.000Z")] });
  it("offers «Editar» to the author", async () => {
    const container = await render(list(), undefined, people(author));
    expect(editLink(container, 11)?.textContent).toBe("Editar");
  });
  it("offers only «Editar gasto» (same route) to another member", async () => {
    const container = await render(list(), undefined, people(someone));
    expect(editLink(container, 11)?.textContent).toBe("Editar gasto");
    expect(Array.from(container.querySelectorAll("a")).some((item) => item.textContent === "Editar")).toBe(false);
  });
  it("offers only «Editar gasto» to a former member of the trip (not listed)", async () => {
    const container = await render(list(), undefined, people(itineraryId(22)));
    expect(editLink(container, 11)?.textContent).toBe("Editar gasto");
  });
  it("keeps the listing usable and offers «Editar» when the member list fails", async () => {
    const container = await render(list(), undefined, vi.fn().mockResolvedValue({ ok: false, error: { kind: "network" } }));
    expect(texts(container)).toEqual(["Recuerdo 11"]);
    expect(editLink(container, 11)?.textContent).toBe("Editar");
  });
});

describe("MemoriesLayout under draft providers", () => {
  function Probe() {
    const post = usePostDraft("new"), comment = useCommentDraft("new:x");
    return <button type="button" data-probe onClick={() => { post.setDraft(emptyDraft()); comment.setText("c"); }}>{post.draft ? "post" : "-"}{comment.text ?? "-"}</button>;
  }
  it("does not replace the providers above: a draft written under it survives the layout remounting", async () => {
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container); roots.push(root);
    const tree = (shown: boolean) => <PostDraftsProvider><CommentDraftsProvider><MemoryRouter initialEntries={[`/trips/${tripId}/memories/x`]}><Routes>
      <Route path="/trips/:tripId/memories" element={shown ? <MemoriesLayout /> : <p>vacío</p>}><Route path=":id" element={<Probe />} /></Route>
    </Routes></MemoryRouter></CommentDraftsProvider></PostDraftsProvider>;
    await act(async () => root.render(tree(true)));
    await act(async () => { container.querySelector<HTMLElement>("[data-probe]")?.click(); });
    expect(container.querySelector("[data-probe]")?.textContent).toBe("postc");
    await act(async () => root.render(tree(false)));
    expect(container.querySelector("[data-probe]")).toBeNull();
    await act(async () => root.render(tree(true)));
    expect(container.querySelector("[data-probe]")?.textContent).toBe("postc");
  });
  it.each([["only the posts provider", true], ["only the comments provider", false]])("with %s above, it creates the missing one and keeps the existing", async (_name, postsOnly) => {
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container); roots.push(root);
    const routes = <MemoryRouter initialEntries={[`/trips/${tripId}/memories/x`]}><Routes>
      <Route path="/trips/:tripId/memories" element={<MemoriesLayout />}><Route path=":id" element={<Probe />} /></Route>
    </Routes></MemoryRouter>;
    const tree = (shown: boolean) => postsOnly ? <PostDraftsProvider>{shown ? routes : <p>vacío</p>}</PostDraftsProvider>
      : <CommentDraftsProvider>{shown ? routes : <p>vacío</p>}</CommentDraftsProvider>;
    await act(async () => root.render(tree(true)));
    await act(async () => { container.querySelector<HTMLElement>("[data-probe]")?.click(); });
    expect(container.querySelector("[data-probe]")?.textContent).toBe("postc");
    await act(async () => root.render(tree(false)));
    await act(async () => root.render(tree(true)));
    // The provider above is the one that survives; the one the layout created starts empty.
    expect(container.querySelector("[data-probe]")?.textContent).toBe(postsOnly ? "post-" : "-c");
  });
});
