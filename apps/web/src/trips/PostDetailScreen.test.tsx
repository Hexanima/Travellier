// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
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
function Spy() { const location = useLocation(); seen.push({ pathname: location.pathname, search: location.search, state: location.state }); return null; }
const last = () => seen[seen.length - 1];
function Stub({ name }: { name: string }) { const location = useLocation(); return <p data-stub={name}>{name} {location.search}</p>; }
const tree = (get: ReturnType<typeof vi.fn>) => <Routes>
  <Route path="/trips/:tripId/memories" element={<MemoriesLayout />}>
    <Route index element={<Stub name="DIARIO" />} />
    <Route path="new" element={<Stub name="NUEVO" />} />
    <Route path=":postId" element={<PostDetailScreen posts={{ get }} timeZone={zone} />} />
  </Route>
  <Route path="/trips/:tripId/itinerary" element={<Stub name="ITINERARIO" />} />
  <Route path="/login" element={<Stub name="LOGIN" />} />
</Routes>;
type Entry = string | { pathname: string; state?: unknown };
async function render(get: ReturnType<typeof vi.fn>, entries: Entry[], index = entries.length - 1) {
  seen.length = 0;
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={entries} initialIndex={index}><Spy />{tree(get)}</MemoryRouter>));
  return { container, rerender: async (next: ReturnType<typeof vi.fn>) => act(async () => root.render(<MemoryRouter initialEntries={entries} initialIndex={index}><Spy />{tree(next)}</MemoryRouter>)) };
}
const open = (get: ReturnType<typeof vi.fn>, n = 5, state?: unknown) => render(get, [{ pathname: `${base}/${itineraryId(n)}`, state }]);
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
    expect(container.textContent).not.toMatch(/comentar|me gusta|like/i);
  });
  it("shows a placeholder for an entry without text", async () => {
    const { container } = await open(vi.fn().mockResolvedValue(ok(detail(5, { postExtra: { description: null } }))));
    expect(container.textContent).toContain("Recuerdo sin texto.");
  });
  it("shows the location as a safe link when there is one", async () => {
    const { container } = await open(vi.fn().mockResolvedValue(ok(detail(5, { postExtra: { mapsUrl: "https://maps.test/x" } }))));
    const link = container.querySelector('a[href="https://maps.test/x"]');
    expect(link?.textContent).toBe("Ver ubicación");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
  });
  it("shows generic link labels for an activity root and a transport", async () => {
    const withActivity = await open(vi.fn().mockResolvedValue(ok(detail(5, { rootActivityId: itineraryId(8) }))));
    expect(withActivity.container.textContent).toContain("Vinculado a una actividad");
    expect(withActivity.container.textContent).not.toContain("Vinculado a un transporte");
    const withTransport = await open(vi.fn().mockResolvedValue(ok(detail(5, { postExtra: { transportId: itineraryId(9) } }))));
    expect(withTransport.container.textContent).toContain("Vinculado a un transporte");
    expect(withTransport.container.textContent).not.toContain("Vinculado a una actividad");
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
