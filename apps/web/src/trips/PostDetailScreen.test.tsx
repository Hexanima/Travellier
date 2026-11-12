// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation, useNavigate, type NavigateFunction } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PostDetailScreen } from "./PostDetailScreen.js";
import { MemoriesLayout } from "./TripMemoriesScreen.js";
import { itineraryId } from "./itinerary-test-fixture.js";
import type { PostDetail, PostResponse, PostSummary } from "./trip-post-api.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
const tripId = itineraryId(1);
const zone = "America/Argentina/Buenos_Aires";
const base = `/trips/${tripId}/memories`;
const post = (n: number, extra: Partial<PostResponse> = {}): PostResponse => ({ id: itineraryId(n), tripId, authorId: itineraryId(20), description: `Recuerdo ${n}`,
  mapsUrl: null, activityId: null, parentPostId: null, transportId: null, createdAt: "2026-01-02T15:30:00.000Z", ...extra });
const summary = (n: number, extra: Partial<PostSummary> = {}): PostSummary => ({ id: itineraryId(n), authorId: itineraryId(20), createdAt: "2026-01-01T15:30:00.000Z", description: `Resumen ${n}`, ...extra });
const detail = (n: number, extra: Partial<PostDetail> & { postExtra?: Partial<PostResponse> } = {}): PostDetail => ({ post: post(n, extra.postExtra), parent: extra.parent ?? null,
  children: extra.children ?? [], rootActivityId: extra.rootActivityId ?? null });
const ok = (value: PostDetail) => ({ ok: true, value });
const seen: { pathname: string; search: string; state: unknown }[] = [];
let go: NavigateFunction = () => undefined;
function Spy() { const location = useLocation(); go = useNavigate(); seen.push({ pathname: location.pathname, search: location.search, state: location.state }); return null; }
const last = () => seen[seen.length - 1];
function Stub({ name }: { name: string }) { const location = useLocation(); return <p data-stub={name}>{name} {location.search}</p>; }
const ok2 = <T,>(value: T) => ({ ok: true as const, value });
const summaryOk = { post: { count: 0, likedByMe: false }, comments: {} };
/** Interaction APIs: by default an empty thread with nothing liked; tests replace the pieces they exercise. */
const extras = (over: { comments?: Partial<Record<"list" | "create" | "update", ReturnType<typeof vi.fn>>>; likes?: Partial<Record<"summary" | "setPostLike" | "setCommentLike", ReturnType<typeof vi.fn>>>;
  members?: ReturnType<typeof vi.fn> } = {}) => ({
  comments: { list: vi.fn().mockResolvedValue(ok2([])), create: vi.fn(), update: vi.fn(), ...over.comments },
  likes: { summary: vi.fn().mockResolvedValue(ok2(summaryOk)), setPostLike: vi.fn(), setCommentLike: vi.fn(), ...over.likes },
  members: { list: over.members ?? vi.fn().mockResolvedValue(ok2({ currentUserId: itineraryId(20), members: [] })) } });
type Extras = ReturnType<typeof extras>;
const tree = (get: ReturnType<typeof vi.fn>, api: Extras) => <Routes>
  <Route path="/trips/:tripId/memories" element={<MemoriesLayout />}>
    <Route index element={<Stub name="DIARIO" />} />
    <Route path="new" element={<Stub name="NUEVO" />} />
    <Route path=":postId" element={<PostDetailScreen posts={{ get }} members={api.members as never} comments={api.comments as never} likes={api.likes as never} timeZone={zone} />} />
  </Route>
  <Route path="/trips/:tripId/itinerary" element={<Stub name="ITINERARIO" />} />
  <Route path="/login" element={<Stub name="LOGIN" />} />
</Routes>;
type Entry = string | { pathname: string; state?: unknown };
async function render(get: ReturnType<typeof vi.fn>, entries: Entry[], index = entries.length - 1, api: Extras = extras()) {
  seen.length = 0;
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={entries} initialIndex={index}><Spy />{tree(get, api)}</MemoryRouter>));
  return { container, api, rerender: async (next: ReturnType<typeof vi.fn>) => act(async () => root.render(<MemoryRouter initialEntries={entries} initialIndex={index}><Spy />{tree(next, api)}</MemoryRouter>)) };
}
const open = (get: ReturnType<typeof vi.fn>, n = 5, state?: unknown, api: Extras = extras()) => render(get, [{ pathname: `${base}/${itineraryId(n)}`, state }], 0, api);
const click = async (element: Element | null | undefined) => { expect(element).toBeTruthy(); await act(async () => element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }))); };
const byText = (container: HTMLElement, selector: string, text: string) => Array.from(container.querySelectorAll(selector)).find((item) => item.textContent === text);
const section = (container: HTMLElement, title: string) => Array.from(container.querySelectorAll("section")).find((item) => item.querySelector("h2")?.textContent === title);
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
const href = (n: number) => `${base}/${itineraryId(n)}`;

describe("PostDetailScreen content", () => {
  it("shows the loading state and then the post without inventing anything", async () => {
    const pending = deferred<unknown>();
    const get = vi.fn().mockReturnValue(pending.promise);
    const { container } = await open(get);
    expect(container.textContent).toContain("Cargando recuerdo…");
    await act(async () => pending.resolve(ok(detail(5))));
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith(tripId, itineraryId(5));
    expect(container.textContent).not.toContain("Cargando recuerdo…");
    expect(container.textContent).toContain("Recuerdo 5");
    expect(container.textContent).toMatch(/Publicado .*2026.*12:30/);
    expect(container.querySelector("time")?.getAttribute("datetime")).toBe("2026-01-02T15:30:00.000Z");
    expect(container.textContent).not.toContain("Recuerdo sin texto.");
    expect(container.textContent).not.toContain("Ver ubicación");
    expect(container.textContent).not.toContain("Vinculado a");
  });
  it("shows a placeholder for an entry without text", async () => {
    const { container } = await open(vi.fn().mockResolvedValue(ok(detail(5, { postExtra: { description: null } }))));
    expect(container.textContent).toContain("Recuerdo sin texto.");
  });
  it("shows the location as a place card with a safe open action when there is one", async () => {
    const { container } = await open(vi.fn().mockResolvedValue(ok(detail(5, { postExtra: { mapsUrl: "https://maps.google.com/?q=Torre+Eiffel" } }))));
    const link = container.querySelector('a[href="https://maps.google.com/?q=Torre+Eiffel"]');
    expect(link?.textContent).toBe("Abrir en Maps");
    expect(link?.getAttribute("aria-label")).toBe("Abrir en Maps: Torre Eiffel");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(container.querySelector(".memory-detail .location-preview, .location-preview")?.getAttribute("data-context")).toBe("memory");
    expect(container.textContent).not.toContain("Ver ubicación");
  });
  it.each(["javascript:alert(1)", "/relativo/mapa", "ftp://maps.test/x", "data:text/html,x", "maps.test/x", "mailto:a@b.c", "https://maps.test/x"])("does not link an unsafe or unlisted location (%s)", async (mapsUrl) => {
    const { container } = await open(vi.fn().mockResolvedValue(ok(detail(5, { postExtra: { mapsUrl } }))));
    expect(container.textContent).toContain("Recuerdo 5");
    expect(container.textContent).not.toContain("Abrir en Maps");
    expect(container.querySelector("[role=status]")?.textContent).toBe("Vínculo de Maps no válido");
    expect(container.querySelector("a[href^='javascript:'], a[href='/relativo/mapa'], a[href^='ftp:'], a[href^='data:'], a[href^='mailto:'], a[href^='https://maps.test']")).toBeNull();
  });
  it("does not link an http location any more", async () => {
    const { container } = await open(vi.fn().mockResolvedValue(ok(detail(5, { postExtra: { mapsUrl: "http://maps.google.com/x" } }))));
    expect(container.querySelector('a[href^="http://"]')).toBeNull();
    expect(container.textContent).not.toContain("Abrir en Maps");
  });
  it("shows generic link labels for an activity root and a transport", async () => {
    const withActivity = await open(vi.fn().mockResolvedValue(ok(detail(5, { rootActivityId: itineraryId(8) }))));
    expect(withActivity.container.textContent).toContain("Vinculado a una actividad");
    expect(withActivity.container.textContent).not.toContain("Vinculado a un transporte");
    const withTransport = await open(vi.fn().mockResolvedValue(ok(detail(5, { postExtra: { transportId: itineraryId(9) } }))));
    expect(withTransport.container.textContent).toContain("Vinculado a un transporte");
    expect(withTransport.container.textContent).not.toContain("Vinculado a una actividad");
  });
  it("offers «Ver transporte» only for a post linked directly to a transport, pointing to its detail in the itinerary", async () => {
    const withTransport = await open(vi.fn().mockResolvedValue(ok(detail(5, { postExtra: { transportId: itineraryId(9) } }))));
    const link = byText(withTransport.container, "a", "Ver transporte");
    expect(link?.getAttribute("href")).toBe(`/trips/${itineraryId(1)}/itinerary?transport=${itineraryId(9)}`);
    const without = await open(vi.fn().mockResolvedValue(ok(detail(5, { rootActivityId: itineraryId(8) }))));
    expect(byText(without.container, "a", "Ver transporte")).toBeUndefined();
  });
  it("shows the immediate parent and the direct children as links to their detail, and nothing else", async () => {
    const get = vi.fn().mockResolvedValue(ok(detail(5, { postExtra: { parentPostId: itineraryId(3) }, parent: summary(3), children: [summary(7), summary(6, { description: null })] })));
    const { container } = await open(get);
    const previous = section(container, "Recuerdo anterior");
    expect(previous?.querySelectorAll("a")).toHaveLength(1);
    expect(previous?.querySelector("a")?.getAttribute("href")).toBe(href(3));
    expect(previous?.textContent).toContain("Resumen 3");
    expect(previous?.textContent).toMatch(/2026/);
    const next = section(container, "Continuaciones");
    expect(Array.from(next?.querySelectorAll("li a") ?? []).map((link) => [link.getAttribute("href"), link.textContent])).toEqual([[href(7), "Resumen 7"], [href(6), "Recuerdo sin texto."]]);
    expect(next?.querySelector("ul, ol")?.getAttribute("aria-label")).toBe("Continuaciones");
    expect(get).toHaveBeenCalledTimes(1);
  });
  it("shows the parent as one compact row with the same link, origin and no list, and keeps continuations and comments in separate panels", async () => {
    const get = vi.fn().mockResolvedValue(ok(detail(5, { postExtra: { parentPostId: itineraryId(3) }, parent: summary(3), children: [summary(7)] })));
    const { container } = await open(get, 5, { origin: { path: `${base}`, label: "diario" } });
    const previous = section(container, "Recuerdo anterior");
    expect(previous?.querySelector("ul, ol, li")).toBeNull();
    const rows = previous?.querySelectorAll(".memory-parent a") ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.getAttribute("href")).toBe(href(3));
    expect(rows[0]!.textContent).toBe("Resumen 3");
    expect(previous?.querySelector(".memory-parent")?.textContent).toMatch(/Publicado .*2026/);
    await click(rows[0]);
    expect(last().pathname).toBe(href(3));
    expect(last().state).toEqual({ origin: { path: `${base}`, label: "diario" } });
  });
  it("keeps continuations and comments in separate tab panels", async () => {
    const { container } = await open(vi.fn().mockResolvedValue(ok(detail(5, { children: [summary(7)] }))));
    const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Continuaciones", "Comentarios"]);
    const panels = Array.from(container.querySelectorAll('[role="tabpanel"]'));
    expect(panels).toHaveLength(2);
    expect(panels[0]!.contains(panels[1]!)).toBe(false);
    expect(panels[0]!.querySelector("li a")?.getAttribute("href")).toBe(href(7));
    expect(panels[0]!.querySelector(".comment-list")).toBeNull();
  });
  it("shows an empty state for the continuations without inventing items", async () => {
    const { container } = await open(vi.fn().mockResolvedValue(ok(detail(5))));
    expect(section(container, "Continuaciones")?.textContent).toContain("Todavía no hay continuaciones.");
    expect(section(container, "Continuaciones")?.querySelectorAll("li")).toHaveLength(0);
    expect(section(container, "Recuerdo anterior")).toBeUndefined();
  });
  it("warns without a link when the parent is no longer available", async () => {
    const { container } = await open(vi.fn().mockResolvedValue(ok(detail(5, { postExtra: { parentPostId: itineraryId(3) }, parent: null }))));
    const previous = section(container, "Recuerdo anterior");
    expect(previous?.textContent).toContain("El recuerdo anterior ya no está disponible.");
    expect(previous?.querySelector("a")).toBeNull();
  });
  it("offers to continue the memory and to edit it", async () => {
    const { container } = await open(vi.fn().mockResolvedValue(ok(detail(5))));
    expect(byText(container, "a", "Editar")?.getAttribute("href")).toBe(`${href(5)}/edit`);
    expect(byText(container, "a", "Continuar recuerdo")?.getAttribute("href")).toBe(`${base}/new?parentPostId=${itineraryId(5)}`);
  });
  it("continues with the parent post id, the excerpt as label and the current detail as origin", async () => {
    const { container } = await open(vi.fn().mockResolvedValue(ok(detail(5, { postExtra: { description: "Un texto" } }))));
    await click(byText(container, "a", "Continuar recuerdo"));
    expect(last().pathname).toBe(`${base}/new`);
    expect(last().search).toBe(`?parentPostId=${itineraryId(5)}`);
    expect(last().state).toEqual({ origin: { path: href(5), label: "recuerdo" }, parentLabel: "Un texto" });
    expect(container.querySelector('[data-stub="NUEVO"]')).toBeTruthy();
  });
  it("continues an entry without text with no label, and cuts a long excerpt", async () => {
    const empty = await open(vi.fn().mockResolvedValue(ok(detail(5, { postExtra: { description: null } }))));
    await click(byText(empty.container, "a", "Continuar recuerdo"));
    expect((last().state as { parentLabel?: string }).parentLabel).toBeUndefined();
    const long = await open(vi.fn().mockResolvedValue(ok(detail(5, { postExtra: { description: `  ${"palabra ".repeat(30)}` } }))));
    await click(byText(long.container, "a", "Continuar recuerdo"));
    const label = (last().state as { parentLabel: string }).parentLabel;
    expect(label.length).toBeLessThanOrEqual(81);
    expect(label.endsWith("…")).toBe(true);
    expect(label.startsWith("palabra")).toBe(true);
  });
});

describe("PostDetailScreen failures", () => {
  it.each([["not-found"], ["forbidden"]])("is unavailable on %s, with only a way back and no other resource opened", async (kind) => {
    const get = vi.fn().mockResolvedValue({ ok: false, error: { kind } });
    const { container } = await open(get);
    expect(container.textContent).toContain("Este recuerdo ya no está disponible para tu cuenta.");
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(byText(container, "button", "Reintentar")).toBeUndefined();
    expect(Array.from(container.querySelectorAll("a")).map((link) => link.getAttribute("href"))).toEqual([base]);
    expect(get).toHaveBeenCalledTimes(1);
  });
  it("asks to sign in again on 401", async () => {
    const { container } = await open(vi.fn().mockResolvedValue({ ok: false, error: { kind: "unauthorized" } }));
    expect(container.textContent).toContain("Tu sesión venció. Volvé a iniciar sesión.");
    expect(container.querySelector('a[href="/login"]')).toBeTruthy();
    expect(byText(container, "button", "Reintentar")).toBeUndefined();
  });
  it.each([["network"], ["server"]])("shows a %s error with a single alert and retries", async (kind) => {
    const get = vi.fn().mockResolvedValueOnce({ ok: false, error: { kind } }).mockResolvedValueOnce(ok(detail(5)));
    const { container } = await open(get);
    expect(container.textContent).toContain("No pudimos cargar el recuerdo. Revisá tu conexión e intentá nuevamente.");
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    await click(byText(container, "button", "Reintentar"));
    expect(get).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Recuerdo 5");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it("treats a rejected request as a network error", async () => {
    const { container } = await open(vi.fn().mockRejectedValue(new Error("down")));
    expect(container.textContent).toContain("No pudimos cargar el recuerdo.");
  });
  it("keeps the loaded data and warns when an update fails", async () => {
    const { container, rerender } = await open(vi.fn().mockResolvedValue(ok(detail(5, { children: [summary(7)] }))));
    expect(container.textContent).toContain("Resumen 7");
    await rerender(vi.fn().mockResolvedValue({ ok: false, error: { kind: "network" } }));
    expect(container.textContent).toContain("Recuerdo 5");
    expect(container.textContent).toContain("Resumen 7");
    expect(container.textContent).toContain("No pudimos actualizar el recuerdo. Lo que ya cargaste se conserva.");
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
  });
});

const type = async (container: HTMLElement, name: string, value: string) => {
  const element = container.querySelector(`[name="${name}"]`) as HTMLTextAreaElement; expect(element).toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); });
};
const field = (container: HTMLElement) => container.querySelector('[name="comment-new"]') as HTMLTextAreaElement | null;
const tab = (container: HTMLElement, name: string) => Array.from(container.querySelectorAll('[role="tab"]')).find((item) => item.textContent === name) as HTMLElement;
const key = async (element: Element, name: string) => act(async () => { element.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })); });
const chain = () => vi.fn().mockImplementation(async (_trip: string, id: string) => id === itineraryId(5)
  ? ok(detail(5, { children: [summary(7)] })) : ok(detail(7, { postExtra: { parentPostId: itineraryId(5) }, parent: summary(5) })));
const mine = (n: number, text: string) => ({ id: itineraryId(n), tripId, postId: itineraryId(5), authorId: itineraryId(20), text, createdAt: "2026-01-02T16:00:00.000Z", authorIsFormerMember: false });

describe("PostDetailScreen comments and likes", () => {
  it("asks for the comments and the likes once, only when the detail is ready", async () => {
    const { api } = await open(vi.fn().mockResolvedValue(ok(detail(5))));
    expect(api.comments.list).toHaveBeenCalledExactlyOnceWith(tripId, itineraryId(5));
    expect(api.likes.summary).toHaveBeenCalledExactlyOnceWith(tripId, itineraryId(5));
    const failed = await open(vi.fn().mockResolvedValue({ ok: false, error: { kind: "forbidden" } }));
    expect(failed.api.comments.list).not.toHaveBeenCalled();
    expect(failed.api.likes.summary).not.toHaveBeenCalled();
  });
  it("keeps the detail when the comments fail and explains it inside the comments panel", async () => {
    const get = vi.fn().mockResolvedValue(ok(detail(5, { children: [summary(7)] })));
    const { container } = await open(get, 5, undefined, extras({ comments: { list: vi.fn().mockResolvedValue({ ok: false, error: { kind: "network" } }) } }));
    expect(container.textContent).toContain("Recuerdo 5");
    expect(container.textContent).toContain("Resumen 7");
    expect(container.querySelector("#memory-panel-comments")?.textContent).toContain("No pudimos cargar los comentarios.");
    expect(get).toHaveBeenCalledTimes(1);
  });
  it("likes the memory from its content and paints what the server answers", async () => {
    const setPostLike = vi.fn().mockResolvedValue(ok2({ liked: true, count: 3 }));
    const { container } = await open(vi.fn().mockResolvedValue(ok(detail(5))), 5, undefined,
      extras({ likes: { summary: vi.fn().mockResolvedValue(ok2({ post: { count: 2, likedByMe: false }, comments: {} })), setPostLike } }));
    const like = section(container, "Contenido")?.querySelector('[data-like="post"]') as HTMLButtonElement;
    expect(like.textContent).toBe("Me gusta 2");
    await click(like);
    expect(setPostLike).toHaveBeenCalledExactlyOnceWith(tripId, itineraryId(5), true);
    expect(like.textContent).toBe("Quitar me gusta 3");
    expect(like.getAttribute("aria-pressed")).toBe("true");
  });
  it("lists the comments with their author in the comments panel", async () => {
    const { container } = await open(vi.fn().mockResolvedValue(ok(detail(5))), 5, undefined, extras({ comments: { list: vi.fn().mockResolvedValue(ok2([mine(9, "Qué lindo")])) } }));
    expect(container.querySelector("#memory-panel-comments")?.textContent).toContain("Qué lindo");
    expect(container.querySelector("#memory-panel-comments .comment-author strong")?.textContent).toBe("Vos");
  });
});

describe("PostDetailScreen panels", () => {
  it("exposes accessible tabs, with Continuaciones selected and Comentarios hidden", async () => {
    const { container } = await open(vi.fn().mockResolvedValue(ok(detail(5))));
    const list = container.querySelector('[role="tablist"]');
    expect(list).toBeTruthy();
    const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
    expect(tabs.map((item) => [item.textContent, item.getAttribute("aria-selected")])).toEqual([["Continuaciones", "true"], ["Comentarios", "false"]]);
    expect(tabs.map((item) => item.getAttribute("tabindex"))).toEqual(["0", "-1"]);
    for (const item of tabs) {
      const panel = container.querySelector(`#${item.getAttribute("aria-controls")}`) as HTMLElement;
      expect(panel.getAttribute("role")).toBe("tabpanel");
      expect(panel.getAttribute("aria-labelledby")).toBe(item.id);
    }
    expect((container.querySelector("#memory-panel-children") as HTMLElement).hidden).toBe(false);
    expect((container.querySelector("#memory-panel-comments") as HTMLElement).hidden).toBe(true);
  });
  it("switches panel without remounting, scrolling, moving the focus or asking for the detail again", async () => {
    const get = vi.fn().mockResolvedValue(ok(detail(5, { children: [summary(7)] })));
    const { container, api } = await open(get);
    const scroll = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, writable: true, value: scroll });
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    const list = container.querySelector("#memory-panel-children ul");
    const title = container.querySelector("h1");
    await click(tab(container, "Comentarios"));
    expect(tab(container, "Comentarios").getAttribute("aria-selected")).toBe("true");
    expect((container.querySelector("#memory-panel-comments") as HTMLElement).hidden).toBe(false);
    expect((container.querySelector("#memory-panel-children") as HTMLElement).hidden).toBe(true);
    await type(container, "comment-new", "a medias");
    const written = field(container);
    await click(tab(container, "Continuaciones"));
    await click(tab(container, "Comentarios"));
    expect(container.querySelector("#memory-panel-children ul")).toBe(list);
    expect(field(container)).toBe(written);
    expect(field(container)?.value).toBe("a medias");
    expect(get).toHaveBeenCalledTimes(1);
    expect(api.comments.list).toHaveBeenCalledTimes(1);
    expect(container.querySelector("h1")).toBe(title);
    expect(document.activeElement).toBe(title);
    expect(scroll).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
    scrollTo.mockRestore();
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });
  it("moves between tabs with the arrow keys, Home and End, focusing the selected tab", async () => {
    const { container } = await open(vi.fn().mockResolvedValue(ok(detail(5))));
    (tab(container, "Continuaciones") as HTMLElement).focus();
    await key(tab(container, "Continuaciones"), "ArrowRight");
    expect(tab(container, "Comentarios").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab(container, "Comentarios"));
    expect(tab(container, "Comentarios").getAttribute("tabindex")).toBe("0");
    await key(tab(container, "Comentarios"), "ArrowRight");
    expect(tab(container, "Continuaciones").getAttribute("aria-selected")).toBe("true");
    await key(tab(container, "Continuaciones"), "ArrowLeft");
    expect(tab(container, "Comentarios").getAttribute("aria-selected")).toBe("true");
    await key(tab(container, "Comentarios"), "Home");
    expect(tab(container, "Continuaciones").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab(container, "Continuaciones"));
    await key(tab(container, "Continuaciones"), "End");
    expect(tab(container, "Comentarios").getAttribute("aria-selected")).toBe("true");
    await key(tab(container, "Comentarios"), "Enter");
    expect(tab(container, "Comentarios").getAttribute("aria-selected")).toBe("true");
  });
});

describe("PostDetailScreen drafts and position", () => {
  it("keeps the unsent text of a memory when going to the next one and coming back, without leaking it", async () => {
    const get = chain();
    const { container } = await open(get);
    await click(tab(container, "Comentarios"));
    await type(container, "comment-new", "borrador de A");
    await click(container.querySelector(`a[href="${href(7)}"]`));
    expect(container.textContent).toContain("Recuerdo 7");
    await click(tab(container, "Comentarios"));
    expect(field(container)?.value).toBe("");
    await type(container, "comment-new", "borrador de B");
    await click(byText(container, "button", "Volver"));
    expect(last().pathname).toBe(href(5));
    expect(container.textContent).toContain("Recuerdo 5");
    await click(tab(container, "Comentarios"));
    expect(field(container)?.value).toBe("borrador de A");
    await click(container.querySelector(`a[href="${href(7)}"]`));
    await click(tab(container, "Comentarios"));
    expect(field(container)?.value).toBe("borrador de B");
  });
  it("discards the drafts when the Trip changes", async () => {
    const get = chain();
    const { container } = await open(get);
    await click(tab(container, "Comentarios"));
    await type(container, "comment-new", "borrador");
    await act(async () => go(`/trips/${itineraryId(99)}/memories/${itineraryId(5)}`));
    await click(tab(container, "Comentarios"));
    expect(field(container)?.value).toBe("");
    await act(async () => go(href(5)));
    await click(tab(container, "Comentarios"));
    expect(field(container)?.value).toBe("");
  });
  it("keeps the unsent text after the retry, without asking for the detail again", async () => {
    const get = chain();
    const create = vi.fn().mockResolvedValue({ ok: false, error: { kind: "network" } });
    const { container, api } = await open(get, 5, undefined, extras({ comments: { create } }));
    await click(tab(container, "Comentarios"));
    await type(container, "comment-new", "hola");
    await click(byText(container, "button", "Comentar"));
    await click(tab(container, "Continuaciones"));
    await click(tab(container, "Comentarios"));
    expect(field(container)?.value).toBe("hola");
    expect(container.textContent).toContain("No pudimos confirmar si se publicó.");
    expect(get).toHaveBeenCalledTimes(1);
    expect(api.comments.list).toHaveBeenCalledTimes(1);
  });
  it("interacting does not rebuild the chain nor ask for the detail again", async () => {
    const get = chain();
    const create = vi.fn().mockResolvedValue(ok2(mine(9, "hola")));
    const setPostLike = vi.fn().mockResolvedValue(ok2({ liked: true, count: 1 }));
    const { container } = await open(get, 5, undefined, extras({ comments: { create }, likes: { setPostLike } }));
    const title = container.querySelector("h1");
    const content = section(container, "Contenido");
    const children = container.querySelector("#memory-panel-children ul");
    await click(tab(container, "Comentarios"));
    await type(container, "comment-new", "hola");
    await click(byText(container, "button", "Comentar"));
    await click(container.querySelector('[data-like="post"]'));
    expect(container.textContent).toContain("hola");
    expect(get).toHaveBeenCalledTimes(1);
    expect(container.querySelector("h1")).toBe(title);
    expect(section(container, "Contenido")).toBe(content);
    expect(container.querySelector("#memory-panel-children ul")).toBe(children);
    expect(last().pathname).toBe(href(5));
  });
  it("keeps the initial focus on the title while the comments load", async () => {
    let finish!: (value: unknown) => void;
    const list = vi.fn().mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { container } = await open(vi.fn().mockResolvedValue(ok(detail(5))), 5, undefined, extras({ comments: { list } }));
    expect(document.activeElement).toBe(container.querySelector("h1"));
    await act(async () => finish(ok2([mine(9, "hola")])));
    expect(container.textContent).toContain("hola");
    expect(document.activeElement).toBe(container.querySelector("h1"));
  });
  it("does not reload the comments when the memory is refreshed", async () => {
    const failing = vi.fn().mockResolvedValueOnce({ ok: false, error: { kind: "network" } }).mockResolvedValue(ok(detail(5)));
    const { container, api, rerender } = await open(vi.fn().mockResolvedValue(ok(detail(5))));
    await rerender(failing);
    await click(byText(container, "button", "Actualizar recuerdo"));
    expect(failing).toHaveBeenCalledTimes(2);
    expect(api.comments.list).toHaveBeenCalledTimes(1);
    expect(api.likes.summary).toHaveBeenCalledTimes(1);
  });
});

describe("PostDetailScreen navigation", () => {
  it("focuses the title when opened", async () => {
    const { container } = await open(vi.fn().mockResolvedValue(ok(detail(5))));
    const title = container.querySelector("h1");
    expect(title?.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(title);
  });
  it("goes back to the diary when there is no origin and no history", async () => {
    const { container } = await open(vi.fn().mockResolvedValue(ok(detail(5))));
    expect(byText(container, "a", "Volver al diario")?.getAttribute("href")).toBe(base);
    await click(byText(container, "button", "Volver"));
    expect(last().pathname).toBe(base);
  });
  it("goes back to a valid origin when there is no history, restoring its place", async () => {
    const anchor = `data-itinerary-post=${itineraryId(5)}`;
    const origin = { path: `/trips/${tripId}/itinerary`, search: "?x=1", label: "itinerario", anchor, scrollY: 250 };
    const { container } = await open(vi.fn().mockResolvedValue(ok(detail(5))), 5, { origin });
    expect(byText(container, "a", "Volver al itinerario")?.getAttribute("href")).toBe(`/trips/${tripId}/itinerary?x=1`);
    await click(byText(container, "button", "Volver"));
    expect(last().pathname).toBe(`/trips/${tripId}/itinerary`);
    expect(last().search).toBe("?x=1");
    expect(last().state).toEqual({ restore: { anchor, scrollY: 250 } });
  });
  it("goes back to the photos of a deep link restoring the panel and, from the viewer, the photo", async () => {
    const photo = itineraryId(9);
    const anchor = `data-photo=${photo}`;
    const path = `/trips/${tripId}/memories/photos`;
    const { container } = await open(vi.fn().mockResolvedValue(ok(detail(5))), 5, { origin: { path, label: "fotos", anchor, scrollY: 90, viewer: true } });
    expect(byText(container, "a", "Volver a las fotos")?.getAttribute("href")).toBe(path);
    await click(byText(container, "button", "Volver"));
    expect(last().pathname).toBe(path);
    expect(last().state).toEqual({ photo, restore: { anchor, scrollY: 90, panel: "photos" } });
  });
  it("goes back to the photos without reopening the viewer when it was not open", async () => {
    const anchor = `data-photo=${itineraryId(9)}`;
    const path = `/trips/${tripId}/memories/photos`;
    const { container } = await open(vi.fn().mockResolvedValue(ok(detail(5))), 5, { origin: { path, label: "fotos", anchor, scrollY: 90 } });
    await click(byText(container, "button", "Volver"));
    expect(last().state).toEqual({ restore: { anchor, scrollY: 90, panel: "photos" } });
  });
  it.each([["another trip", `/trips/${itineraryId(2)}/itinerary`], ["an external url", "https://evil.test/x"], ["a protocol-relative url", "//evil.test/x"]])(
    "ignores an origin pointing to %s", async (_name, path) => {
      const { container } = await open(vi.fn().mockResolvedValue(ok(detail(5))), 5, { origin: { path, label: "itinerario" } });
      expect(byText(container, "a", "Volver al diario")?.getAttribute("href")).toBe(base);
      expect(container.querySelector('a[href*="evil"]')).toBeNull();
      await click(byText(container, "button", "Volver"));
      expect(last().pathname).toBe(base);
    });
  it("goes back one level in the app history instead of jumping to the origin", async () => {
    const { container } = await render(vi.fn().mockResolvedValue(ok(detail(5))), [{ pathname: `/trips/${tripId}/itinerary` }, { pathname: href(5), state: { origin: { path: base, label: "diario" } } }]);
    await click(byText(container, "button", "Volver"));
    expect(last().pathname).toBe(`/trips/${tripId}/itinerary`);
  });
  it("walks parent to child and back one level, keeping the root origin", async () => {
    const root = { path: `/trips/${tripId}/itinerary`, label: "itinerario" };
    const get = vi.fn().mockImplementation(async (_trip: string, id: string) => id === itineraryId(5)
      ? ok(detail(5, { children: [summary(7)] })) : ok(detail(7, { postExtra: { parentPostId: itineraryId(5) }, parent: summary(5) })));
    const { container } = await render(get, [{ pathname: `/trips/${tripId}/itinerary` }, { pathname: href(5), state: { origin: root } }]);
    await click(container.querySelector(`a[href="${href(7)}"]`));
    expect(last().pathname).toBe(href(7));
    expect(last().state).toEqual({ origin: root });
    expect(get).toHaveBeenLastCalledWith(tripId, itineraryId(7));
    expect(container.textContent).toContain("Recuerdo 7");
    expect(container.textContent).not.toContain("Recuerdo 5");
    expect(byText(container, "a", "Volver al itinerario")?.getAttribute("href")).toBe(`/trips/${tripId}/itinerary`);
    expect(document.activeElement).toBe(container.querySelector("h1"));
    await click(byText(container, "button", "Volver"));
    expect(last().pathname).toBe(href(5));
    expect(container.textContent).toContain("Recuerdo 5");
    expect(document.activeElement).toBe(container.querySelector("h1"));
  });
});
