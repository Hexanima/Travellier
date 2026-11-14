// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommentsPanel, PostLikeControl } from "./PostComments.js";
import { itineraryId } from "./itinerary-test-fixture.js";
import type { CommentResponse, TripCommentApi } from "./trip-comment-api.js";
import type { LikesSummary, TripLikeApi } from "./trip-like-api.js";
import type { TripMembersApi } from "./trip-members-api.js";
import { useLikes } from "./use-likes.js";
import { CommentDraftsProvider } from "./use-comment-drafts.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
const tripId = itineraryId(1), postId = itineraryId(2), me = itineraryId(20), other = itineraryId(21), stranger = itineraryId(22);
const comment = (n: number, extra: Partial<CommentResponse> = {}): CommentResponse => ({ id: itineraryId(n), tripId, postId, authorId: other, text: `Comentario ${n}`,
  createdAt: `2026-01-02T15:${String(n).padStart(2, "0")}:00.000Z`, authorIsFormerMember: false, ...extra });
/** Edit tests act on the comments of the current user: «Editar» is offered only to the author (T125). */
const own = (n: number, extra: Partial<CommentResponse> = {}): CommentResponse => comment(n, { authorId: me, ...extra });
const ok = <T,>(value: T) => ({ ok: true as const, value });
const fail = (kind: string, extra: object = {}) => ({ ok: false as const, error: { kind, ...extra } });
const summary = (extra: Partial<LikesSummary> = {}): LikesSummary => ({ post: { count: 0, likedByMe: false }, comments: {}, ...extra });
const membersOk = ok({ currentUserId: me, members: [{ id: itineraryId(40), userId: me, name: "Yo", role: "admin", joinedAt: "2026-01-01T00:00:00.000Z" },
  { id: itineraryId(41), userId: other, name: "Marta", role: "participant", joinedAt: "2026-01-01T00:00:00.000Z" }] });
type Apis = { comments: { [K in keyof TripCommentApi]: ReturnType<typeof vi.fn> }; likes: { [K in keyof TripLikeApi]: ReturnType<typeof vi.fn> }; members: { list: ReturnType<typeof vi.fn> } };
const apis = (list: unknown[] = [], over: Partial<Record<string, unknown>> = {}): Apis => ({
  comments: { list: vi.fn().mockResolvedValue(ok(list)), create: vi.fn(), update: vi.fn(), remove: vi.fn(), ...(over.comments as object) },
  likes: { summary: vi.fn().mockResolvedValue(ok(summary())), setPostLike: vi.fn(), setCommentLike: vi.fn(), ...(over.likes as object) },
  members: { list: vi.fn().mockResolvedValue(membersOk), ...(over.members as object) } });
function Panel({ api }: { api: Apis }) {
  const likes = useLikes(tripId, postId, api.likes as unknown as TripLikeApi);
  return <>
    <PostLikeControl likes={likes} />
    <CommentsPanel tripId={tripId} postId={postId} comments={api.comments as unknown as TripCommentApi} members={api.members as unknown as Pick<TripMembersApi, "list">}
      likes={likes} format={(iso) => `F:${iso}`} />
  </>;
}
function Host({ api }: { api: Apis }) {
  const [visible, setVisible] = useState(true);
  return <MemoryRouter><CommentDraftsProvider>
    <button type="button" data-action="toggle" onClick={() => setVisible((value) => !value)}>toggle</button>
    {visible ? <Panel api={api} /> : null}
  </CommentDraftsProvider></MemoryRouter>;
}
async function render(api: Apis) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<Host api={api} />));
  return container;
}
const click = async (element: Element | null | undefined) => { expect(element).toBeTruthy(); await act(async () => element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }))); };
const clickTwice = async (element: Element | null | undefined) => { expect(element).toBeTruthy();
  await act(async () => { for (let i = 0; i < 2; i += 1) element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })); }); };
const type = async (container: HTMLElement, name: string, value: string) => {
  const element = container.querySelector(`[name="${name}"]`) as HTMLTextAreaElement; expect(element).toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); });
};
const field = (container: HTMLElement, name: string) => container.querySelector(`[name="${name}"]`) as HTMLTextAreaElement | null;
const button = (container: ParentNode, text: string) => Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.startsWith(text)) as HTMLButtonElement | undefined;
const item = (container: HTMLElement, n: number) => container.querySelector(`[data-comment="${itineraryId(n)}"]`) as HTMLElement;
const likeOf = (container: ParentNode, key: string) => container.querySelector(`[data-like="${key}"]`) as HTMLButtonElement;
const order = (container: HTMLElement) => Array.from(container.querySelectorAll("[data-comment]")).map((li) => li.querySelector(".comment-text")?.textContent);
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
const NEW = "comment-new";

describe("comments panel: loading", () => {
  it("shows the loading state and then the comments oldest first, asking once", async () => {
    const pending = deferred<unknown>();
    const api = apis([], { comments: { list: vi.fn().mockReturnValue(pending.promise) } });
    const container = await render(api);
    expect(container.textContent).toContain("Cargando comentarios…");
    await act(async () => pending.resolve(ok([comment(5), comment(6, { text: "Segundo" })])));
    expect(container.textContent).not.toContain("Cargando comentarios…");
    expect(order(container)).toEqual(["Comentario 5", "Segundo"]);
    expect(item(container, 5).querySelector("time")?.getAttribute("datetime")).toBe("2026-01-02T15:05:00.000Z");
    expect(item(container, 5).textContent).toContain("F:2026-01-02T15:05:00.000Z");
    expect(api.comments.list).toHaveBeenCalledExactlyOnceWith(tripId, postId);
    expect(api.likes.summary).toHaveBeenCalledExactlyOnceWith(tripId, postId);
    expect(api.members.list).toHaveBeenCalledExactlyOnceWith(tripId);
  });
  it("shows an empty state without inventing comments", async () => {
    const container = await render(apis([]));
    expect(container.textContent).toContain("Todavía no hay comentarios.");
    expect(container.querySelectorAll("[data-comment]")).toHaveLength(0);
  });
  it.each([["network"], ["server"]])("shows a %s error with a retry", async (kind) => {
    const api = apis([], { comments: { list: vi.fn().mockResolvedValueOnce(fail(kind)).mockResolvedValueOnce(ok([comment(5)])) } });
    const container = await render(api);
    expect(container.textContent).toContain("No pudimos cargar los comentarios.");
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(field(container, NEW)).toBeNull();
    await click(button(container, "Reintentar comentarios"));
    expect(api.comments.list).toHaveBeenCalledTimes(2);
    expect(order(container)).toEqual(["Comentario 5"]);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it("un timeout al cargar tiene su propio texto y conserva el reintento (T150)", async () => {
    const api = apis([], { comments: { list: vi.fn().mockResolvedValueOnce(fail("network", { code: "TimeoutError" })).mockResolvedValueOnce(ok([comment(5)])) } });
    const container = await render(api);
    expect(container.textContent).toContain("La conexión tardó demasiado. Intentá nuevamente.");
    expect(container.textContent).not.toContain("No pudimos cargar los comentarios.");
    await click(button(container, "Reintentar comentarios"));
    expect(order(container)).toEqual(["Comentario 5"]);
  });
  it("una conexión caída al cargar conserva el texto de siempre (T150)", async () => {
    const container = await render(apis([], { comments: { list: vi.fn().mockResolvedValue(fail("network", { code: "NetworkError" })) } }));
    expect(container.textContent).toContain("No pudimos cargar los comentarios.");
    expect(container.textContent).not.toContain("tardó demasiado");
  });
  it("treats a rejected list as a network error", async () => {
    const container = await render(apis([], { comments: { list: vi.fn().mockRejectedValue(new Error("down")) } }));
    expect(container.textContent).toContain("No pudimos cargar los comentarios.");
  });
  it.each([["forbidden"], ["not-found"]])("on %s says the comments are no longer visible, without retry or composer", async (kind) => {
    const container = await render(apis([], { comments: { list: vi.fn().mockResolvedValue(fail(kind)) } }));
    expect(container.textContent).toContain("Ya no podés ver los comentarios de este recuerdo.");
    expect(button(container, "Reintentar comentarios")).toBeUndefined();
    expect(field(container, NEW)).toBeNull();
  });
  it("on 401 asks to sign in again with a link to login", async () => {
    const container = await render(apis([], { comments: { list: vi.fn().mockResolvedValue(fail("unauthorized")) } }));
    expect(container.textContent).toContain("Tu sesión venció. Volvé a iniciar sesión.");
    expect(container.querySelector('a[href="/login"]')).toBeTruthy();
    expect(button(container, "Reintentar comentarios")).toBeUndefined();
  });
  it("reloads only the comments and the likes with the manual update, keeping the list meanwhile", async () => {
    const second = deferred<unknown>();
    const api = apis([comment(5)], { comments: { list: vi.fn().mockResolvedValueOnce(ok([comment(5)])).mockReturnValueOnce(second.promise) } });
    const container = await render(api);
    await click(button(container, "Actualizar comentarios"));
    expect(container.textContent).toContain("Actualizando comentarios…");
    expect(order(container)).toEqual(["Comentario 5"]);
    await act(async () => second.resolve(ok([comment(5), comment(7)])));
    expect(order(container)).toEqual(["Comentario 5", "Comentario 7"]);
    expect(api.likes.summary).toHaveBeenCalledTimes(2);
  });
  it("keeps the list and warns when a manual update fails", async () => {
    const api = apis([comment(5)], { comments: { list: vi.fn().mockResolvedValueOnce(ok([comment(5)])).mockResolvedValueOnce(fail("network")) } });
    const container = await render(api);
    await click(button(container, "Actualizar comentarios"));
    expect(order(container)).toEqual(["Comentario 5"]);
    expect(container.textContent).toContain("No pudimos actualizar los comentarios.");
  });
  it("un timeout al actualizar los comentarios lo dice y conserva lo cargado (T150)", async () => {
    const api = apis([comment(5)], { comments: { list: vi.fn().mockResolvedValueOnce(ok([comment(5)])).mockResolvedValueOnce(fail("network", { code: "TimeoutError" })) } });
    const container = await render(api);
    await click(button(container, "Actualizar comentarios"));
    expect(order(container)).toEqual(["Comentario 5"]);
    expect(container.textContent).toContain("La conexión tardó demasiado. Intentá nuevamente. Lo que ya cargaste se conserva.");
    expect(container.textContent).not.toContain("No pudimos actualizar los comentarios.");
  });
  it("una conexión caída al actualizar los comentarios conserva el texto de siempre (T150)", async () => {
    const api = apis([comment(5)], { comments: { list: vi.fn().mockResolvedValueOnce(ok([comment(5)])).mockResolvedValueOnce(fail("network", { code: "NetworkError" })) } });
    const container = await render(api);
    await click(button(container, "Actualizar comentarios"));
    expect(container.textContent).toContain("No pudimos actualizar los comentarios. Lo que ya cargaste se conserva.");
    expect(container.textContent).not.toContain("tardó demasiado");
  });
  it("un timeout al cargar los me gusta lo dice y conserva la promesa de los contadores (T150)", async () => {
    const api = apis([comment(5)], { likes: { summary: vi.fn().mockResolvedValue(fail("network", { code: "TimeoutError" })) } });
    const container = await render(api);
    expect(container.textContent).toContain("La conexión tardó demasiado. Intentá nuevamente. Los comentarios se muestran sin contadores.");
    expect(container.textContent).not.toContain("No pudimos cargar los me gusta.");
    expect(button(container, "Reintentar me gusta")).toBeDefined();
  });
  it("shows the comments with the like buttons disabled and a retry when only the likes fail", async () => {
    const api = apis([comment(5)], { likes: { summary: vi.fn().mockResolvedValueOnce(fail("network")).mockResolvedValueOnce(ok(summary({ comments: { [itineraryId(5)]: { count: 2, likedByMe: false } } }))) } });
    const container = await render(api);
    expect(order(container)).toEqual(["Comentario 5"]);
    expect(container.textContent).toContain("No pudimos cargar los me gusta.");
    expect(likeOf(container, "post").disabled).toBe(true);
    expect(likeOf(container, `comment:${itineraryId(5)}`).disabled).toBe(true);
    expect(likeOf(container, `comment:${itineraryId(5)}`).textContent).not.toMatch(/\d/);
    await click(button(container, "Reintentar me gusta"));
    expect(likeOf(container, `comment:${itineraryId(5)}`).disabled).toBe(false);
    expect(likeOf(container, `comment:${itineraryId(5)}`).textContent).toBe("Me gusta 2");
  });
});

describe("comments panel: authors", () => {
  it("names the author as former member, you, a current member or just member", async () => {
    const container = await render(apis([comment(5, { authorIsFormerMember: true, authorId: other }), comment(6, { authorId: me }), comment(7, { authorId: other }), comment(8, { authorId: stranger })]));
    const author = (n: number) => item(container, n).querySelector(".comment-author strong")?.textContent;
    expect([author(5), author(6), author(7), author(8)]).toEqual(["Ex integrante", "Vos", "Marta", "Integrante"]);
  });
  it("does not block when the members cannot be read", async () => {
    const container = await render(apis([comment(5, { authorId: other })], { members: { list: vi.fn().mockResolvedValue(fail("server")) } }));
    expect(item(container, 5).querySelector(".comment-author strong")?.textContent).toBe("Integrante");
    expect(field(container, NEW)).toBeTruthy();
  });
});

describe("comments panel: create", () => {
  it("publishes the trimmed text, adds it, clears the draft, focuses the field and announces it", async () => {
    const created = comment(9, { authorId: me, text: "hola" });
    const api = apis([comment(5)], { comments: { create: vi.fn().mockResolvedValue(ok(created)) } });
    const container = await render(api);
    await type(container, NEW, "  hola  ");
    button(container, "Comentar")!.focus();
    await click(button(container, "Comentar"));
    expect(api.comments.create).toHaveBeenCalledExactlyOnceWith(tripId, postId, "hola");
    expect(order(container)).toEqual(["Comentario 5", "hola"]);
    expect(field(container, NEW)?.value).toBe("");
    expect(document.activeElement).toBe(field(container, NEW));
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Comentario publicado");
    expect(button(container, "Comentar")?.disabled).toBe(true);
    expect(api.likes.summary).toHaveBeenCalledTimes(2);
  });
  it("starts the new comment without likes and enabled", async () => {
    const created = comment(9, { authorId: me, text: "hola" });
    const api = apis([], { comments: { create: vi.fn().mockResolvedValue(ok(created)) }, likes: { summary: vi.fn().mockResolvedValueOnce(ok(summary())).mockReturnValueOnce(new Promise(() => undefined)) } });
    const container = await render(api);
    await type(container, NEW, "hola");
    await click(button(container, "Comentar"));
    const like = likeOf(container, `comment:${itineraryId(9)}`);
    expect(like.textContent).toBe("Me gusta 0");
    expect(like.getAttribute("aria-pressed")).toBe("false");
  });
  it.each([["empty", ""], ["only spaces", "  \n "], ["over the limit", "a".repeat(2001)], ["emoji over the limit", "😀".repeat(2001)]])("disables publishing for %s", async (_name, text) => {
    const api = apis([]);
    const container = await render(api);
    await type(container, NEW, text);
    expect(button(container, "Comentar")?.disabled).toBe(true);
    expect(field(container, NEW)?.getAttribute("aria-describedby")).toBeTruthy();
    expect(field(container, NEW)?.value).toBe(text);
    await click(button(container, "Comentar"));
    expect(api.comments.create).not.toHaveBeenCalled();
  });
  it("explains the limit and counts code points", async () => {
    const container = await render(apis([]));
    await type(container, NEW, "😀😀");
    expect(container.textContent).toContain("2 / 2000");
    await type(container, NEW, "😀".repeat(2000));
    expect(container.textContent).toContain("2000 / 2000");
    expect(button(container, "Comentar")?.disabled).toBe(false);
    await type(container, NEW, "a".repeat(2001));
    expect(container.textContent).toContain("2001 / 2000");
    expect(container.textContent).toContain("El comentario supera el máximo de 2000 caracteres.");
    expect(field(container, NEW)?.value).toHaveLength(2001);
  });
  it("sends once when the button is pressed twice quickly and marks it busy", async () => {
    const pending = deferred<unknown>();
    const api = apis([], { comments: { create: vi.fn().mockReturnValue(pending.promise) } });
    const container = await render(api);
    await type(container, NEW, "hola");
    await clickTwice(button(container, "Comentar"));
    expect(api.comments.create).toHaveBeenCalledTimes(1);
    const busy = container.querySelector("form button[type=submit]") as HTMLButtonElement;
    expect(busy.getAttribute("aria-disabled")).toBe("true"); expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(field(container, NEW)?.disabled).toBe(false);
    await act(async () => pending.resolve(ok(comment(9, { authorId: me, text: "hola" }))));
    expect(api.comments.create).toHaveBeenCalledTimes(1);
  });
  it("keeps what was typed while publishing: the sent comment appears and the field keeps the current text", async () => {
    const pending = deferred<unknown>();
    const api = apis([], { comments: { create: vi.fn().mockReturnValue(pending.promise) } });
    const container = await render(api);
    await type(container, NEW, "A");
    await click(button(container, "Comentar"));
    await type(container, NEW, "AB");
    await act(async () => pending.resolve(ok(comment(9, { authorId: me, text: "A" }))));
    expect(api.comments.create).toHaveBeenCalledExactlyOnceWith(tripId, postId, "A");
    expect(order(container)).toEqual(["A"]);
    expect(field(container, NEW)?.value).toBe("AB");
    expect(button(container, "Comentar")?.disabled).toBe(false);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it("clears the draft when nothing was typed while publishing", async () => {
    const pending = deferred<unknown>();
    const api = apis([], { comments: { create: vi.fn().mockReturnValue(pending.promise) } });
    const container = await render(api);
    await type(container, NEW, "A");
    await click(button(container, "Comentar"));
    await act(async () => pending.resolve(ok(comment(9, { authorId: me, text: "A" }))));
    expect(order(container)).toEqual(["A"]);
    expect(field(container, NEW)?.value).toBe("");
  });
  it("keeps the text typed after a failed publish too", async () => {
    const pending = deferred<unknown>();
    const api = apis([], { comments: { create: vi.fn().mockReturnValue(pending.promise) } });
    const container = await render(api);
    await type(container, NEW, "A");
    await click(button(container, "Comentar"));
    await type(container, NEW, "AB");
    await act(async () => pending.resolve(fail("network")));
    expect(field(container, NEW)?.value).toBe("AB");
    expect(order(container)).toEqual([]);
  });
  it("keeps the text and warns that it could not be confirmed on a network failure", async () => {
    const api = apis([], { comments: { create: vi.fn().mockResolvedValue(fail("network")) } });
    const container = await render(api);
    await type(container, NEW, "hola");
    await click(button(container, "Comentar"));
    expect(field(container, NEW)?.value).toBe("hola");
    expect(container.textContent).toContain("No pudimos confirmar si se publicó. Revisá los comentarios antes de reintentar.");
    expect(container.textContent).toContain("Tu texto se conserva.");
    expect(order(container)).toEqual([]);
  });
  it("on retry reloads the list first and does not duplicate a comment the server already saved", async () => {
    const saved = comment(9, { authorId: me, text: "hola" });
    const list = vi.fn().mockResolvedValueOnce(ok([])).mockResolvedValueOnce(ok([saved]));
    const create = vi.fn().mockResolvedValue(fail("network"));
    const api = apis([], { comments: { list, create } });
    const container = await render(api);
    await type(container, NEW, "hola");
    await click(button(container, "Comentar"));
    await click(button(container, "Comentar"));
    expect(list).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledTimes(1);
    expect(order(container)).toEqual(["hola"]);
    expect(field(container, NEW)?.value).toBe("hola");
    expect(container.textContent).toContain("Actualizamos los comentarios.");
  });
  it("sends again after the reload when the comment did not appear", async () => {
    const create = vi.fn().mockResolvedValueOnce(fail("server")).mockResolvedValueOnce(ok(comment(9, { authorId: me, text: "hola" })));
    const api = apis([], { comments: { create } });
    const container = await render(api);
    await type(container, NEW, "hola");
    await click(button(container, "Comentar"));
    await click(button(container, "Comentar"));
    expect(create).toHaveBeenCalledTimes(1);
    await click(button(container, "Comentar"));
    expect(create).toHaveBeenCalledTimes(2);
    expect(order(container)).toEqual(["hola"]);
    expect(field(container, NEW)?.value).toBe("");
  });
  it("treats a rejected create like a network failure", async () => {
    const api = apis([], { comments: { create: vi.fn().mockRejectedValue(new Error("down")) } });
    const container = await render(api);
    await type(container, NEW, "hola");
    await click(button(container, "Comentar"));
    expect(field(container, NEW)?.value).toBe("hola");
    expect(container.textContent).toContain("No pudimos confirmar si se publicó.");
  });
  it.each([["required", "El comentario no puede estar vacío."], ["too_long", "El comentario supera el máximo de 2000 caracteres."], ["invalid", "El comentario no es válido."]])(
    "shows the %s validation of the server, keeps the text and allows a direct retry", async (code, message) => {
      const create = vi.fn().mockResolvedValueOnce(fail("validation", { fields: [{ field: "text", code, message: "x" }] })).mockResolvedValueOnce(ok(comment(9, { authorId: me, text: "hola" })));
      const container = await render(apis([], { comments: { create } }));
      await type(container, NEW, "hola");
      await click(button(container, "Comentar"));
      expect(container.textContent).toContain(message);
      expect(field(container, NEW)?.value).toBe("hola");
      expect(container.textContent).not.toContain("No pudimos confirmar");
      await click(button(container, "Comentar"));
      expect(create).toHaveBeenCalledTimes(2);
    });
  it.each([["forbidden"], ["not-found"]])("on %s says there is no access and keeps the text", async (kind) => {
    const container = await render(apis([], { comments: { create: vi.fn().mockResolvedValue(fail(kind)) } }));
    await type(container, NEW, "hola");
    await click(button(container, "Comentar"));
    expect(container.textContent).toContain("Ya no podés comentar en este recuerdo.");
    expect(field(container, NEW)?.value).toBe("hola");
  });
  it("on 401 asks to sign in again and keeps the text", async () => {
    const container = await render(apis([], { comments: { create: vi.fn().mockResolvedValue(fail("unauthorized")) } }));
    await type(container, NEW, "hola");
    await click(button(container, "Comentar"));
    expect(container.textContent).toContain("Tu sesión venció. Volvé a iniciar sesión.");
    expect(container.querySelector('a[href="/login"]')).toBeTruthy();
    expect(field(container, NEW)?.value).toBe("hola");
  });
  it("keeps the unsent text when the panel is remounted under the same provider", async () => {
    const container = await render(apis([]));
    await type(container, NEW, "borrador");
    await click(container.querySelector('[data-action="toggle"]'));
    expect(field(container, NEW)).toBeNull();
    await click(container.querySelector('[data-action="toggle"]'));
    expect(field(container, NEW)?.value).toBe("borrador");
  });
});

describe("comments panel: edit", () => {
  it("opens the field with the current text and replaces the comment in place keeping the order and the focus on Editar", async () => {
    const update = vi.fn().mockResolvedValue(ok(own(6, { text: "Corregido" })));
    const api = apis([own(5), own(6), own(7)], { comments: { update } });
    const container = await render(api);
    await click(button(item(container, 6), "Editar"));
    const edit = field(container, `comment-edit-${itineraryId(6)}`);
    expect(edit?.value).toBe("Comentario 6");
    expect(document.activeElement).toBe(edit);
    await type(container, `comment-edit-${itineraryId(6)}`, "  Corregido ");
    button(item(container, 6), "Guardar")!.focus();
    await click(button(item(container, 6), "Guardar"));
    expect(update).toHaveBeenCalledExactlyOnceWith(tripId, postId, itineraryId(6), "Corregido");
    expect(order(container)).toEqual(["Comentario 5", "Corregido", "Comentario 7"]);
    expect(field(container, `comment-edit-${itineraryId(6)}`)).toBeNull();
    expect(document.activeElement).toBe(button(item(container, 6), "Editar"));
  });
  it("discards the changes on cancel and reopens with the original text", async () => {
    const api = apis([own(5)]);
    const container = await render(api);
    await click(button(item(container, 5), "Editar"));
    await type(container, `comment-edit-${itineraryId(5)}`, "otra cosa");
    await click(button(item(container, 5), "Cancelar"));
    expect(order(container)).toEqual(["Comentario 5"]);
    expect(document.activeElement).toBe(button(item(container, 5), "Editar"));
    await click(button(item(container, 5), "Editar"));
    expect(field(container, `comment-edit-${itineraryId(5)}`)?.value).toBe("Comentario 5");
    expect(api.comments.update).not.toHaveBeenCalled();
  });
  it("does not call the API when nothing changed", async () => {
    const api = apis([own(5)]);
    const container = await render(api);
    await click(button(item(container, 5), "Editar"));
    await type(container, `comment-edit-${itineraryId(5)}`, "Comentario 5  ");
    await click(button(item(container, 5), "Guardar"));
    expect(api.comments.update).not.toHaveBeenCalled();
    expect(field(container, `comment-edit-${itineraryId(5)}`)).toBeNull();
  });
  it("blocks saving an empty or too long text", async () => {
    const container = await render(apis([own(5)]));
    await click(button(item(container, 5), "Editar"));
    await type(container, `comment-edit-${itineraryId(5)}`, "   ");
    expect(button(item(container, 5), "Guardar")?.disabled).toBe(true);
    await type(container, `comment-edit-${itineraryId(5)}`, "a".repeat(2001));
    expect(button(item(container, 5), "Guardar")?.disabled).toBe(true);
  });
  it("keeps the edit draft and shows the validation on a 422", async () => {
    const update = vi.fn().mockResolvedValue(fail("validation", { fields: [{ field: "text", code: "too_long", message: "x" }] }));
    const container = await render(apis([own(5)], { comments: { update } }));
    await click(button(item(container, 5), "Editar"));
    await type(container, `comment-edit-${itineraryId(5)}`, "nuevo");
    await click(button(item(container, 5), "Guardar"));
    expect(item(container, 5).textContent).toContain("El comentario supera el máximo de 2000 caracteres.");
    expect(field(container, `comment-edit-${itineraryId(5)}`)?.value).toBe("nuevo");
  });
  it("says the comment is no longer available on CommentNotFoundError", async () => {
    const update = vi.fn().mockResolvedValue(fail("not-found", { code: "CommentNotFoundError" }));
    const container = await render(apis([own(5)], { comments: { update } }));
    await click(button(item(container, 5), "Editar"));
    await type(container, `comment-edit-${itineraryId(5)}`, "nuevo");
    await click(button(item(container, 5), "Guardar"));
    expect(item(container, 5).textContent).toContain("Este comentario ya no está disponible.");
    expect(field(container, `comment-edit-${itineraryId(5)}`)?.value).toBe("nuevo");
  });
  it("keeps the text and lets the same save be retried after a network failure", async () => {
    const update = vi.fn().mockResolvedValueOnce(fail("network")).mockResolvedValueOnce(ok(own(5, { text: "nuevo" })));
    const container = await render(apis([own(5)], { comments: { update } }));
    await click(button(item(container, 5), "Editar"));
    await type(container, `comment-edit-${itineraryId(5)}`, "nuevo");
    await click(button(item(container, 5), "Guardar"));
    expect(item(container, 5).textContent).toContain("Tu texto se conserva.");
    expect(field(container, `comment-edit-${itineraryId(5)}`)?.value).toBe("nuevo");
    await click(button(item(container, 5), "Guardar"));
    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[1]).toEqual(update.mock.calls[0]);
    expect(order(container)).toEqual(["nuevo"]);
  });
  it("sends once when Guardar is pressed twice quickly", async () => {
    const pending = deferred<unknown>();
    const update = vi.fn().mockReturnValue(pending.promise);
    const container = await render(apis([own(5)], { comments: { update } }));
    await click(button(item(container, 5), "Editar"));
    await type(container, `comment-edit-${itineraryId(5)}`, "nuevo");
    await clickTwice(button(item(container, 5), "Guardar"));
    expect(update).toHaveBeenCalledTimes(1);
    expect(item(container, 5).querySelector("form button[type=submit]")?.getAttribute("aria-busy")).toBe("true");
    await act(async () => pending.resolve(ok(own(5, { text: "nuevo" }))));
  });
  it("keeps the edit open with the text added while saving", async () => {
    const pending = deferred<unknown>();
    const update = vi.fn().mockReturnValue(pending.promise);
    const container = await render(apis([own(5)], { comments: { update } }));
    const name = `comment-edit-${itineraryId(5)}`;
    await click(button(item(container, 5), "Editar"));
    await type(container, name, "nuevo");
    await click(button(item(container, 5), "Guardar"));
    await type(container, name, "nuevo y más");
    await act(async () => pending.resolve(ok(own(5, { text: "nuevo" }))));
    expect(update).toHaveBeenCalledExactlyOnceWith(tripId, postId, itineraryId(5), "nuevo");
    expect(container.querySelectorAll("[data-comment]")).toHaveLength(1);
    expect(field(container, name)?.value).toBe("nuevo y más");
    expect(item(container, 5).querySelector("form button[type=submit]")?.getAttribute("aria-busy")).not.toBe("true");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it("closes and clears the edit when nothing was typed while saving", async () => {
    const pending = deferred<unknown>();
    const update = vi.fn().mockReturnValue(pending.promise);
    const container = await render(apis([own(5)], { comments: { update } }));
    const name = `comment-edit-${itineraryId(5)}`;
    await click(button(item(container, 5), "Editar"));
    await type(container, name, "nuevo");
    await click(button(item(container, 5), "Guardar"));
    await act(async () => pending.resolve(ok(own(5, { text: "nuevo" }))));
    expect(field(container, name)).toBeNull();
    expect(order(container)).toEqual(["nuevo"]);
    await click(button(item(container, 5), "Editar"));
    expect(field(container, name)?.value).toBe("nuevo");
  });
  it("allows editing several comments at once and keeps each draft", async () => {
    const container = await render(apis([own(5), own(6)]));
    await click(button(item(container, 5), "Editar"));
    await click(button(item(container, 6), "Editar"));
    await type(container, `comment-edit-${itineraryId(5)}`, "uno");
    await type(container, `comment-edit-${itineraryId(6)}`, "dos");
    expect(field(container, `comment-edit-${itineraryId(5)}`)?.value).toBe("uno");
    expect(field(container, `comment-edit-${itineraryId(6)}`)?.value).toBe("dos");
  });
  it("restores an open edit draft when the panel is remounted", async () => {
    const container = await render(apis([own(5)]));
    await click(button(item(container, 5), "Editar"));
    await type(container, `comment-edit-${itineraryId(5)}`, "a medias");
    await click(container.querySelector('[data-action="toggle"]'));
    await click(container.querySelector('[data-action="toggle"]'));
    expect(field(container, `comment-edit-${itineraryId(5)}`)?.value).toBe("a medias");
  });
});

describe("likes", () => {
  const withLikes = (extra: Partial<LikesSummary> = {}, list: unknown[] = [comment(5), comment(6)], over: Partial<Record<string, unknown>> = {}) =>
    apis(list, { likes: { summary: vi.fn().mockResolvedValue(ok(summary(extra))), ...(over.likes as object) } });
  it("shows the counters of the summary and the pressed state", async () => {
    const container = await render(withLikes({ post: { count: 4, likedByMe: true }, comments: { [itineraryId(5)]: { count: 2, likedByMe: false }, [itineraryId(6)]: { count: 1, likedByMe: true } } }));
    expect(likeOf(container, "post").textContent).toBe("Quitar me gusta 4");
    expect(likeOf(container, "post").getAttribute("aria-pressed")).toBe("true");
    expect(likeOf(container, `comment:${itineraryId(5)}`).textContent).toBe("Me gusta 2");
    expect(likeOf(container, `comment:${itineraryId(5)}`).getAttribute("aria-pressed")).toBe("false");
    expect(likeOf(container, `comment:${itineraryId(6)}`).textContent).toBe("Quitar me gusta 1");
  });
  it("paints the state the server returns and keeps post and comment independent", async () => {
    const api = withLikes({ comments: { [itineraryId(5)]: { count: 2, likedByMe: false }, [itineraryId(6)]: { count: 0, likedByMe: false } } },
      [comment(5), comment(6)], { likes: { setCommentLike: vi.fn().mockResolvedValue(ok({ liked: true, count: 7 })) } });
    const container = await render(api);
    await click(likeOf(container, `comment:${itineraryId(5)}`));
    expect(api.likes.setCommentLike).toHaveBeenCalledExactlyOnceWith(tripId, postId, itineraryId(5), true);
    expect(likeOf(container, `comment:${itineraryId(5)}`).textContent).toBe("Quitar me gusta 7");
    expect(likeOf(container, `comment:${itineraryId(5)}`).getAttribute("aria-pressed")).toBe("true");
    expect(likeOf(container, `comment:${itineraryId(6)}`).textContent).toBe("Me gusta 0");
    expect(likeOf(container, "post").textContent).toBe("Me gusta 0");
    expect(api.likes.setPostLike).not.toHaveBeenCalled();
  });
  it("removes a like with the opposite operation", async () => {
    const api = withLikes({ post: { count: 3, likedByMe: true } }, [], { likes: { setPostLike: vi.fn().mockResolvedValue(ok({ liked: false, count: 2 })) } });
    const container = await render(api);
    await click(likeOf(container, "post"));
    expect(api.likes.setPostLike).toHaveBeenCalledExactlyOnceWith(tripId, postId, false);
    expect(likeOf(container, "post").textContent).toBe("Me gusta 2");
  });
  it("waits for the server: while pending it keeps the confirmed state, is disabled and busy, and ignores a second press", async () => {
    const pending = deferred<unknown>();
    const api = withLikes({ post: { count: 3, likedByMe: false } }, [], { likes: { setPostLike: vi.fn().mockReturnValue(pending.promise) } });
    const container = await render(api);
    await clickTwice(likeOf(container, "post"));
    expect(api.likes.setPostLike).toHaveBeenCalledTimes(1);
    expect(likeOf(container, "post").textContent).toBe("Me gusta 3");
    expect(likeOf(container, "post").getAttribute("aria-pressed")).toBe("false");
    expect(likeOf(container, "post").getAttribute("aria-disabled")).toBe("true");
    expect(likeOf(container, "post").getAttribute("aria-busy")).toBe("true");
    await act(async () => pending.resolve(ok({ liked: true, count: 4 })));
    expect(likeOf(container, "post").textContent).toBe("Quitar me gusta 4");
    expect(likeOf(container, "post").disabled).toBe(false);
    expect(likeOf(container, "post").getAttribute("aria-disabled")).toBeNull();
    expect(likeOf(container, "post").getAttribute("aria-busy")).toBeNull();
  });
  it("keeps the state on error, warns next to the button and retries the same operation", async () => {
    const set = vi.fn().mockResolvedValueOnce(fail("network")).mockResolvedValueOnce(ok({ liked: true, count: 3 }));
    const api = withLikes({ comments: { [itineraryId(5)]: { count: 2, likedByMe: false } } }, [comment(5)], { likes: { setCommentLike: set } });
    const container = await render(api);
    await click(likeOf(container, `comment:${itineraryId(5)}`));
    expect(item(container, 5).textContent).toContain("No pudimos actualizar el me gusta.");
    expect(likeOf(container, `comment:${itineraryId(5)}`).textContent).toBe("Me gusta 2");
    expect(likeOf(container, `comment:${itineraryId(5)}`).disabled).toBe(false);
    await click(likeOf(container, `comment:${itineraryId(5)}`));
    expect(set.mock.calls).toEqual([[tripId, postId, itineraryId(5), true], [tripId, postId, itineraryId(5), true]]);
    expect(likeOf(container, `comment:${itineraryId(5)}`).textContent).toBe("Quitar me gusta 3");
    expect(item(container, 5).textContent).not.toContain("No pudimos actualizar el me gusta.");
  });
  it("un timeout al dar me gusta tiene su propio texto y lo deja reintentable (T150)", async () => {
    const set = vi.fn().mockResolvedValueOnce(fail("network", { code: "TimeoutError" })).mockResolvedValueOnce(ok({ liked: true, count: 3 }));
    const api = withLikes({ comments: { [itineraryId(5)]: { count: 2, likedByMe: false } } }, [comment(5)], { likes: { setCommentLike: set } });
    const container = await render(api);
    await click(likeOf(container, `comment:${itineraryId(5)}`));
    expect(item(container, 5).textContent).toContain("La conexión tardó demasiado. Intentá nuevamente.");
    expect(item(container, 5).textContent).not.toContain("No pudimos actualizar el me gusta.");
    await click(likeOf(container, `comment:${itineraryId(5)}`));
    expect(likeOf(container, `comment:${itineraryId(5)}`).textContent).toBe("Quitar me gusta 3");
  });
  it("una conexión caída al dar me gusta conserva el texto de siempre (T150)", async () => {
    const api = withLikes({}, [], { likes: { setPostLike: vi.fn().mockResolvedValue(fail("network", { code: "NetworkError" })) } });
    const container = await render(api);
    await click(likeOf(container, "post"));
    expect(container.textContent).toContain("No pudimos actualizar el me gusta. Intentá nuevamente.");
    expect(container.textContent).not.toContain("tardó demasiado");
  });
  it("treats a rejected like as a network failure", async () => {
    const api = withLikes({}, [], { likes: { setPostLike: vi.fn().mockRejectedValue(new Error("down")) } });
    const container = await render(api);
    await click(likeOf(container, "post"));
    expect(container.textContent).toContain("No pudimos actualizar el me gusta.");
    expect(likeOf(container, "post").disabled).toBe(false);
  });
  it("disables the likes with a notice when the post is no longer available", async () => {
    const api = withLikes({}, [comment(5)], { likes: { setPostLike: vi.fn().mockResolvedValue(fail("not-found")) } });
    api.likes.summary.mockResolvedValue(ok(summary({ comments: { [itineraryId(5)]: { count: 0, likedByMe: false } } })));
    const container = await render(api);
    await click(likeOf(container, "post"));
    expect(container.textContent).toContain("Ya no podés ver este recuerdo.");
    expect(likeOf(container, "post").disabled).toBe(true);
    expect(likeOf(container, `comment:${itineraryId(5)}`).disabled).toBe(true);
  });
  it("says the comment is no longer available when its like gets CommentNotFoundError", async () => {
    const api = withLikes({ comments: { [itineraryId(5)]: { count: 0, likedByMe: false } } }, [comment(5)],
      { likes: { setCommentLike: vi.fn().mockResolvedValue(fail("not-found", { code: "CommentNotFoundError" })) } });
    const container = await render(api);
    await click(likeOf(container, `comment:${itineraryId(5)}`));
    expect(item(container, 5).textContent).toContain("Este comentario ya no está disponible.");
    expect(likeOf(container, "post").disabled).toBe(false);
  });
  it("keeps a comment missing from the summary disabled until the summary is requested again", async () => {
    const api = withLikes({ comments: {} }, [comment(5)]);
    const container = await render(api);
    expect(likeOf(container, `comment:${itineraryId(5)}`).disabled).toBe(true);
    api.likes.summary.mockResolvedValue(ok(summary({ comments: { [itineraryId(5)]: { count: 1, likedByMe: true } } })));
    await click(button(container, "Actualizar comentarios"));
    expect(likeOf(container, `comment:${itineraryId(5)}`).disabled).toBe(false);
    expect(likeOf(container, `comment:${itineraryId(5)}`).textContent).toBe("Quitar me gusta 1");
  });
});

describe("focus stays on the pressed button while busy and afterwards", () => {
  const focused = (element: HTMLElement | undefined | null) => { expect(element).toBeTruthy(); element!.focus(); expect(document.activeElement).toBe(element); return element!; };
  const stays = (element: HTMLElement) => { expect(document.activeElement).toBe(element); expect(element.getAttribute("aria-disabled")).toBe("true"); expect(element.hasAttribute("disabled")).toBe(false); };
  const withLikes = (over: Record<string, unknown>) => apis([own(5)], { likes: { summary: vi.fn().mockResolvedValue(ok(summary({ post: { count: 3, likedByMe: false },
    comments: { [itineraryId(5)]: { count: 2, likedByMe: false } } }))), ...over } });
  it.each([["post", "setPostLike"], [`comment:${itineraryId(5)}`, "setCommentLike"]])("like %s: pending, error and confirmation", async (key, method) => {
    const pending = deferred<unknown>();
    const set = vi.fn().mockReturnValueOnce(pending.promise).mockReturnValueOnce(Promise.resolve(fail("network"))).mockResolvedValue(ok({ liked: true, count: 9 }));
    const container = await render(withLikes({ [method]: set }));
    const like = focused(likeOf(container, key));
    await click(like);
    stays(like);
    await act(async () => pending.resolve(fail("network")));
    expect(document.activeElement).toBe(like); expect(like.hasAttribute("disabled")).toBe(false); expect(like.getAttribute("aria-disabled")).toBeNull();
    await click(like);
    expect(document.activeElement).toBe(like);
    await click(like);
    expect(likeOf(container, key).textContent).toBe("Quitar me gusta 9");
    expect(document.activeElement).toBe(likeOf(container, key));
  });
  it("Comentar: pending and after a failure", async () => {
    const pending = deferred<unknown>();
    const container = await render(apis([], { comments: { create: vi.fn().mockReturnValueOnce(pending.promise) } }));
    await type(container, NEW, "hola");
    const submit = focused(button(container, "Comentar"));
    await click(submit);
    stays(submit);
    await act(async () => pending.resolve(fail("validation", { fields: [{ field: "text", code: "required", message: "x" }] })));
    expect(document.activeElement).toBe(button(container, "Comentar"));
    expect(button(container, "Comentar")?.getAttribute("aria-disabled")).toBeNull();
  });
  it("Guardar: pending and after a failure", async () => {
    const pending = deferred<unknown>();
    const container = await render(apis([own(5)], { comments: { update: vi.fn().mockReturnValueOnce(pending.promise) } }));
    await click(button(item(container, 5), "Editar"));
    await type(container, `comment-edit-${itineraryId(5)}`, "nuevo");
    const save = focused(button(item(container, 5), "Guardar"));
    await click(save);
    stays(save);
    await act(async () => pending.resolve(fail("network")));
    expect(document.activeElement).toBe(button(item(container, 5), "Guardar"));
    expect(button(item(container, 5), "Guardar")?.getAttribute("aria-disabled")).toBeNull();
  });
});

describe("the focus is only moved after a success when it was still inside the form", () => {
  const withLike = (over: Record<string, unknown>) => apis([own(5)], { likes: { summary: vi.fn().mockResolvedValue(ok(summary({ post: { count: 3, likedByMe: false } }))) }, ...over });
  it("publishing from Comentar leaves the focus in the field", async () => {
    const pending = deferred<unknown>();
    const container = await render(withLike({ comments: { create: vi.fn().mockReturnValue(pending.promise) } }));
    await type(container, NEW, "hola");
    button(container, "Comentar")!.focus();
    await click(button(container, "Comentar"));
    await act(async () => pending.resolve(ok(own(9, { authorId: me, text: "hola" }))));
    expect(document.activeElement).toBe(field(container, NEW));
  });
  it("publishing does not steal the focus from a like the user moved to meanwhile", async () => {
    const pending = deferred<unknown>();
    const container = await render(withLike({ comments: { create: vi.fn().mockReturnValue(pending.promise) } }));
    await type(container, NEW, "hola");
    button(container, "Comentar")!.focus();
    await click(button(container, "Comentar"));
    likeOf(container, "post").focus();
    await act(async () => pending.resolve(ok(own(9, { authorId: me, text: "hola" }))));
    expect(document.activeElement).toBe(likeOf(container, "post"));
  });
  it("saving an edit returns the focus to Editar when it was inside the edit", async () => {
    const pending = deferred<unknown>();
    const container = await render(withLike({ comments: { update: vi.fn().mockReturnValue(pending.promise) } }));
    await click(button(item(container, 5), "Editar"));
    await type(container, `comment-edit-${itineraryId(5)}`, "nuevo");
    button(item(container, 5), "Guardar")!.focus();
    await click(button(item(container, 5), "Guardar"));
    await act(async () => pending.resolve(ok(own(5, { text: "nuevo" }))));
    expect(document.activeElement).toBe(button(item(container, 5), "Editar"));
  });
  it("saving an edit does not steal the focus from a like the user moved to meanwhile", async () => {
    const pending = deferred<unknown>();
    const container = await render(withLike({ comments: { update: vi.fn().mockReturnValue(pending.promise) } }));
    await click(button(item(container, 5), "Editar"));
    await type(container, `comment-edit-${itineraryId(5)}`, "nuevo");
    button(item(container, 5), "Guardar")!.focus();
    await click(button(item(container, 5), "Guardar"));
    likeOf(container, "post").focus();
    await act(async () => pending.resolve(ok(own(5, { text: "nuevo" }))));
    expect(order(container)).toEqual(["nuevo"]);
    expect(document.activeElement).toBe(likeOf(container, "post"));
  });
});

describe("Cancelar is ignored while saving", () => {
  const name = `comment-edit-${itineraryId(5)}`;
  async function saving(result: unknown) {
    const pending = deferred<unknown>();
    const container = await render(apis([own(5)], { comments: { update: vi.fn().mockReturnValue(pending.promise) } }));
    await click(button(item(container, 5), "Editar"));
    await type(container, name, "nuevo");
    await click(button(item(container, 5), "Guardar"));
    return { container, resolve: () => act(async () => pending.resolve(result)) };
  }
  it("is aria-disabled without a real disabled and pressing it keeps the edit and the draft", async () => {
    const { container, resolve } = await saving(ok(own(5, { text: "nuevo" })));
    const cancel = button(item(container, 5), "Cancelar")!;
    cancel.focus();
    expect(cancel.getAttribute("aria-disabled")).toBe("true");
    expect(cancel.hasAttribute("disabled")).toBe(false);
    await click(cancel);
    expect(field(container, name)?.value).toBe("nuevo");
    expect(document.activeElement).toBe(cancel);
    await resolve();
    expect(field(container, name)).toBeNull();
    expect(order(container)).toEqual(["nuevo"]);
  });
  it("keeps the text and shows the error when the save fails after pressing it", async () => {
    const { container, resolve } = await saving(fail("network"));
    await click(button(item(container, 5), "Cancelar"));
    await resolve();
    expect(field(container, name)?.value).toBe("nuevo");
    expect(item(container, 5).querySelector('[role="alert"]')).not.toBeNull();
    expect(button(item(container, 5), "Cancelar")?.getAttribute("aria-disabled")).toBeNull();
  });
  it("still cancels and clears when it is not busy", async () => {
    const container = await render(apis([own(5)]));
    await click(button(item(container, 5), "Editar"));
    await type(container, name, "otra cosa");
    expect(button(item(container, 5), "Cancelar")?.getAttribute("aria-disabled")).toBeNull();
    await click(button(item(container, 5), "Cancelar"));
    expect(field(container, name)).toBeNull();
    await click(button(item(container, 5), "Editar"));
    expect(field(container, name)?.value).toBe("Comentario 5");
  });
});

describe("a single assertive announcement", () => {
  const alerts = (container: HTMLElement) => Array.from(container.querySelectorAll('[role="alert"]'));
  const noLiveAlert = (container: HTMLElement) => expect(container.querySelectorAll('[role="alert"][aria-live]')).toHaveLength(0);
  it("summary error plus failed update: at most one alert", async () => {
    const list = vi.fn().mockResolvedValueOnce(ok([comment(5)])).mockResolvedValue(fail("network"));
    const container = await render(apis([], { comments: { list }, likes: { summary: vi.fn().mockResolvedValue(fail("network")) } }));
    await click(button(container, "Actualizar comentarios"));
    expect(container.textContent).toContain("No pudimos cargar los me gusta.");
    expect(container.textContent).toContain("No pudimos actualizar los comentarios.");
    expect(alerts(container).length).toBeLessThanOrEqual(1);
    noLiveAlert(container);
  });
  it("like notice, failed update and form error together: one alert, messages tied to their control", async () => {
    const list = vi.fn().mockResolvedValueOnce(ok([comment(5)])).mockResolvedValue(fail("network"));
    const create = vi.fn().mockResolvedValue(fail("validation", { fields: [{ field: "text", code: "too_long", message: "x" }] }));
    const container = await render(apis([], { comments: { list, create }, likes: { summary: vi.fn().mockResolvedValue(ok(summary({ comments: { [itineraryId(5)]: { count: 2, likedByMe: false } } }))),
      setPostLike: vi.fn().mockResolvedValue(fail("network")) } }));
    await click(likeOf(container, "post"));
    await click(button(container, "Actualizar comentarios"));
    await type(container, NEW, "hola");
    await click(button(container, "Comentar"));
    expect(container.textContent).toContain("No pudimos actualizar el me gusta.");
    expect(container.textContent).toContain("No pudimos actualizar los comentarios.");
    expect(container.textContent).toContain("El comentario supera el máximo de 2000 caracteres.");
    expect(alerts(container)).toHaveLength(1);
    noLiveAlert(container);
    const described = document.getElementById(likeOf(container, "post").getAttribute("aria-describedby") ?? "");
    expect(described?.textContent).toContain("No pudimos actualizar el me gusta.");
  });
});

describe("a summary read before a confirmed like does not undo it", () => {
  const harness = () => {
    const first = deferred<unknown>(), second = deferred<unknown>();
    const set = vi.fn().mockResolvedValue(ok({ liked: true, count: 4 }));
    const api = apis([], { likes: { summary: vi.fn().mockResolvedValueOnce(ok(summary({ post: { count: 3, likedByMe: false } }))).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise), setPostLike: set } });
    return { api, first, second };
  };
  it("keeps the confirmed count when the older GET answers after the PUT", async () => {
    const { api, first } = harness();
    const container = await render(api);
    await click(button(container, "Actualizar comentarios"));
    await click(likeOf(container, "post"));
    expect(likeOf(container, "post").textContent).toBe("Quitar me gusta 4");
    await act(async () => first.resolve(ok(summary({ post: { count: 3, likedByMe: false } }))));
    expect(likeOf(container, "post").textContent).toBe("Quitar me gusta 4");
  });
  it("keeps the confirmed count when the GET started before the PUT and answers while it is still pending", async () => {
    const { api, first } = harness();
    const pending = deferred<unknown>();
    api.likes.setPostLike.mockReturnValueOnce(pending.promise);
    const container = await render(api);
    await click(button(container, "Actualizar comentarios"));
    await click(likeOf(container, "post"));
    await act(async () => first.resolve(ok(summary({ post: { count: 3, likedByMe: false } }))));
    await act(async () => pending.resolve(ok({ liked: true, count: 4 })));
    expect(likeOf(container, "post").textContent).toBe("Quitar me gusta 4");
  });
  it("applies a summary requested after the PUT", async () => {
    const { api, first, second } = harness();
    const container = await render(api);
    await click(button(container, "Actualizar comentarios"));
    await act(async () => first.resolve(ok(summary({ post: { count: 3, likedByMe: false } }))));
    await click(likeOf(container, "post"));
    await click(button(container, "Actualizar comentarios"));
    await act(async () => second.resolve(ok(summary({ post: { count: 6, likedByMe: true } }))));
    expect(likeOf(container, "post").textContent).toBe("Quitar me gusta 6");
  });
});

describe("comments panel: edit by authorship (T125)", () => {
  const editButton = (container: HTMLElement, n: number) => Array.from(item(container, n).querySelectorAll("button")).find((node) => node.textContent === "Editar");
  it("offers «Editar» only on the comments of the current user", async () => {
    const container = await render(apis([own(5), comment(6), comment(7, { authorId: stranger }), comment(8, { authorIsFormerMember: true, authorId: other })]));
    expect(editButton(container, 5)).toBeTruthy();
    expect(editButton(container, 6)).toBeUndefined();
    expect(editButton(container, 7)).toBeUndefined();
    expect(editButton(container, 8)).toBeUndefined();
    // Likes stay available to everyone.
    expect(item(container, 6).querySelector("[data-like]")).not.toBeNull();
  });
  it("does not offer «Editar» on a comment marked as a former member even with the author's id", async () => {
    const container = await render(apis([own(5, { authorIsFormerMember: true })]));
    expect(editButton(container, 5)).toBeUndefined();
  });
  it("offers «Editar» while the member list is unknown (the server decides)", async () => {
    const container = await render(apis([comment(5)], { members: { list: vi.fn().mockResolvedValue(fail("server")) } }));
    expect(editButton(container, 5)).toBeTruthy();
  });
  it("on a 403 shows the authorship message as an alert, keeps the field and the text and allows retrying", async () => {
    const update = vi.fn().mockResolvedValueOnce(fail("forbidden")).mockResolvedValueOnce(ok(own(5, { text: "nuevo" })));
    const container = await render(apis([own(5)], { comments: { update } }));
    await click(button(item(container, 5), "Editar"));
    await type(container, `comment-edit-${itineraryId(5)}`, "nuevo");
    await click(button(item(container, 5), "Guardar"));
    const alert = item(container, 5).querySelector('[role="alert"]');
    expect(alert?.textContent).toBe("Solo el autor puede editar este comentario. Tu texto se conserva.");
    expect(field(container, `comment-edit-${itineraryId(5)}`)?.value).toBe("nuevo");
    await click(button(item(container, 5), "Guardar"));
    expect(update).toHaveBeenCalledTimes(2);
    expect(order(container)).toEqual(["nuevo"]);
  });
  it("keeps the previous message for a comment that no longer exists", async () => {
    const update = vi.fn().mockResolvedValue(fail("not-found"));
    const container = await render(apis([own(5)], { comments: { update } }));
    await click(button(item(container, 5), "Editar"));
    await type(container, `comment-edit-${itineraryId(5)}`, "nuevo");
    await click(button(item(container, 5), "Guardar"));
    expect(item(container, 5).querySelector('[role="alert"]')?.textContent).toBe("Ya no podés editar este comentario.");
  });
});

describe("comments panel: delete (T128)", () => {
  const roster = (role: "admin" | "participant") => ok({ currentUserId: me, members: [{ id: itineraryId(40), userId: me, name: "Yo", role, joinedAt: "2026-01-01T00:00:00.000Z" },
    { id: itineraryId(41), userId: other, name: "Marta", role: "participant", joinedAt: "2026-01-01T00:00:00.000Z" }] });
  const asParticipant = { list: vi.fn().mockResolvedValue(roster("participant")) };
  const delButton = (container: HTMLElement, n: number) => Array.from(item(container, n).querySelectorAll("button")).find((node) => node.textContent === "Eliminar") as HTMLButtonElement | undefined;
  const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement | null;
  const confirm = () => button(dialog() as HTMLElement, "Eliminar");
  const failure = (kind: string, extra: object = {}) => fail(kind, extra);
  const notice = (container: HTMLElement) => container.querySelector('[role="status"]');
  it("offers «Eliminar» to an admin on every comment and to a participant only on their own", async () => {
    const admin = await render(apis([own(5), comment(6)]));
    expect(delButton(admin, 5)).toBeTruthy();
    expect(delButton(admin, 6)).toBeTruthy();
    const participant = await render(apis([own(5), comment(6)], { members: asParticipant }));
    expect(delButton(participant, 5)).toBeTruthy();
    expect(delButton(participant, 6)).toBeUndefined();
  });
  it("labels the button with the author and uses the error style", async () => {
    const container = await render(apis([comment(6)]));
    expect(delButton(container, 6)?.getAttribute("aria-label")).toBe("Eliminar comentario de Marta");
    expect(delButton(container, 6)?.getAttribute("data-error")).toBe("true");
  });
  it("hides it for a former member's comment unless admin, and offers it while the member list is unknown", async () => {
    const former = await render(apis([own(5, { authorIsFormerMember: true })], { members: asParticipant }));
    expect(delButton(former, 5)).toBeUndefined();
    const unknown = await render(apis([comment(6)], { members: { list: vi.fn().mockResolvedValue(fail("server")) } }));
    expect(delButton(unknown, 6)).toBeTruthy();
  });
  it("is not shown while the comment is being edited", async () => {
    const container = await render(apis([own(5), own(6)]));
    await click(button(item(container, 5), "Editar"));
    expect(delButton(container, 5)).toBeUndefined();
    expect(delButton(container, 6)).toBeTruthy();
  });
  it("confirms in a dialog with the safe action focused, and cancelling deletes nothing and returns the focus", async () => {
    const api = apis([comment(6)]);
    const container = await render(api);
    await click(delButton(container, 6));
    expect(dialog()?.textContent).toContain("Eliminar comentario");
    expect(dialog()?.textContent).toContain("Se elimina el comentario y sus me gusta. No se puede deshacer.");
    expect(document.activeElement).toBe(button(dialog() as HTMLElement, "Cancelar"));
    await click(button(dialog() as HTMLElement, "Cancelar"));
    expect(dialog()).toBeNull();
    expect(api.comments.remove).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(delButton(container, 6));
    expect(order(container)).toEqual(["Comentario 6"]);
  });
  it("deletes once, removes it from the list, refreshes the likes, announces politely and moves the focus to the next «Eliminar»", async () => {
    const pending = deferred<unknown>();
    const api = apis([comment(5), comment(6), comment(7)], { comments: { remove: vi.fn().mockReturnValue(pending.promise) } });
    const container = await render(api);
    await click(delButton(container, 6));
    const summaries = api.likes.summary.mock.calls.length;
    await act(async () => { for (let i = 0; i < 2; i += 1) confirm()?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })); });
    expect(api.comments.remove).toHaveBeenCalledTimes(1);
    expect(api.comments.remove).toHaveBeenCalledWith(tripId, postId, itineraryId(6));
    await act(async () => pending.resolve(ok(undefined)));
    expect(dialog()).toBeNull();
    expect(order(container)).toEqual(["Comentario 5", "Comentario 7"]);
    expect(api.likes.summary.mock.calls.length).toBeGreaterThan(summaries);
    expect(notice(container)?.textContent).toBe("Comentario eliminado");
    expect(document.activeElement).toBe(delButton(container, 7));
  });
  it("moves the focus to the comment field when there is no next «Eliminar»", async () => {
    const api = apis([comment(5)], { comments: { remove: vi.fn().mockResolvedValue(ok(undefined)) } });
    const container = await render(api);
    await click(delButton(container, 5));
    await click(confirm());
    expect(order(container)).toEqual([]);
    expect(document.activeElement).toBe(field(container, NEW));
  });
  it("leaves the edit draft of another comment alone", async () => {
    const api = apis([own(5), own(6)], { comments: { remove: vi.fn().mockResolvedValue(ok(undefined)) } });
    const container = await render(api);
    await click(button(item(container, 6), "Editar"));
    await type(container, `comment-edit-${itineraryId(6)}`, "a medias");
    await click(delButton(container, 5));
    await click(confirm());
    expect(item(container, 5)).toBeNull();
    expect(field(container, `comment-edit-${itineraryId(6)}`)?.value).toBe("a medias");
  });
  it("treats a missing comment (404 with its code) as deleted: removes it and reloads the list", async () => {
    const remove = vi.fn().mockResolvedValue(failure("not-found", { code: "CommentNotFoundError" }));
    const api = apis([comment(5), comment(6)], { comments: { remove } });
    const container = await render(api);
    api.comments.list.mockResolvedValue(ok([comment(5)]));
    await click(delButton(container, 6));
    await click(confirm());
    expect(dialog()).toBeNull();
    expect(api.comments.list).toHaveBeenCalledTimes(2);
    expect(order(container)).toEqual(["Comentario 5"]);
    expect(notice(container)?.textContent).toBe("Este comentario ya no está disponible.");
  });
  it("on 403 explains it, re-reads the role and closes when it no longer applies", async () => {
    let demoted = false;
    const list = vi.fn().mockImplementation(async () => demoted ? roster("participant") : roster("admin"));
    const remove = vi.fn().mockImplementation(async () => { demoted = true; return failure("forbidden"); });
    const container = await render(apis([comment(6)], { members: { list }, comments: { remove } }));
    await click(delButton(container, 6));
    await click(confirm());
    expect(dialog()).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Ya no tenés permiso para eliminar este comentario.");
    expect(delButton(container, 6)).toBeUndefined();
    expect(order(container)).toEqual(["Comentario 6"]);
  });
  it("on 403 keeps the dialog with the message when the permission still seems valid", async () => {
    const container = await render(apis([comment(6)], { comments: { remove: vi.fn().mockResolvedValue(failure("forbidden")) } }));
    await click(delButton(container, 6));
    await click(confirm());
    expect(dialog()?.textContent).toContain("Ya no tenés permiso para eliminar este comentario.");
  });
  it("on 401 asks to sign in again", async () => {
    const container = await render(apis([comment(6)], { comments: { remove: vi.fn().mockResolvedValue(failure("unauthorized")) } }));
    await click(delButton(container, 6));
    await click(confirm());
    expect(dialog()?.textContent).toContain("Tu sesión venció. Volvé a iniciar sesión.");
    expect(Array.from((dialog() as HTMLElement).querySelectorAll("a")).find((a) => a.textContent === "Iniciar sesión")).toBeTruthy();
  });
  it("on a network failure keeps the dialog and the comment, and retries", async () => {
    const remove = vi.fn().mockResolvedValueOnce(failure("network")).mockResolvedValueOnce(ok(undefined));
    const container = await render(apis([comment(6)], { comments: { remove } }));
    await click(delButton(container, 6));
    await click(confirm());
    expect(dialog()?.textContent).toContain("No pudimos eliminar el comentario.");
    expect(order(container)).toEqual(["Comentario 6"]);
    await click(confirm());
    expect(remove).toHaveBeenCalledTimes(2);
    expect(dialog()).toBeNull();
    expect(order(container)).toEqual([]);
  });
  it("un timeout al eliminar tiene su propio texto en el diálogo (T150)", async () => {
    const container = await render(apis([comment(6)], { comments: { remove: vi.fn().mockResolvedValue(failure("network", { code: "TimeoutError" })) } }));
    await click(delButton(container, 6));
    await click(confirm());
    expect(dialog()?.textContent).toContain("La conexión tardó demasiado. Intentá nuevamente.");
    expect(dialog()?.textContent).not.toContain("No pudimos eliminar el comentario.");
    expect(order(container)).toEqual(["Comentario 6"]);
  });
  it("treats a thrown error like a network failure", async () => {
    const container = await render(apis([comment(6)], { comments: { remove: vi.fn().mockRejectedValue(new Error("x")) } }));
    await click(delButton(container, 6));
    await click(confirm());
    expect(dialog()?.textContent).toContain("No pudimos eliminar el comentario.");
  });
});
