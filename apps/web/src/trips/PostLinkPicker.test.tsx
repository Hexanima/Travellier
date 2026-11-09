// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, MemoryRouter, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PostLinkPicker } from "./PostLinkPicker.js";
import { MemoriesLayout } from "./TripMemoriesScreen.js";
import { itineraryId } from "./itinerary-test-fixture.js";
import type { PostDraft } from "./post-draft.js";
import type { PostResponse } from "./trip-post-api.js";
import { usePostDraft } from "./use-post-drafts.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
const tripId = itineraryId(1), selfId = itineraryId(30), childId = itineraryId(31), grandchildId = itineraryId(32), otherId = itineraryId(33), siblingId = itineraryId(34);
const activityA = itineraryId(40), activityB = itineraryId(41), transportId = itineraryId(50);
const post = (id: string, description: string | null, parentPostId: string | null = null): PostResponse => ({ id, tripId, authorId: itineraryId(20), description, mapsUrl: null,
  activityId: null, parentPostId, transportId: null, createdAt: "2026-01-02T15:30:00.000Z" });
const allPosts = [post(selfId, "Mi recuerdo"), post(childId, "Hijo", selfId), post(grandchildId, "Nieto", childId), post(otherId, "Otro recuerdo"), post(siblingId, null)];
const itineraryOf = () => ({ ok: true, value: { activities: [
  { id: activityB, title: "Visita al museo", scheduledAt: "2026-09-25T17:00:00.000Z", durationMinutes: null },
  { id: activityA, title: "Paseo por el centro", scheduledAt: "2026-09-25T15:00:00.000Z", durationMinutes: 60 }] } });
const seeded = (link: PostDraft["extras"]["link"] = null, transport: string | null = null): PostDraft =>
  ({ values: { description: "Texto tipeado", mapsUrl: "https://maps.example/x" }, extras: { link, transportId: transport, newActivity: null } });
let seed: PostDraft = seeded();
function Probe() {
  const { postId } = useParams(); const handle = usePostDraft(postId ? `edit:${postId}` : "new");
  const location = useLocation(); const navigate = useNavigate();
  return <div>
    <p data-testid="probe">{JSON.stringify({ draft: handle.draft ?? null, state: location.state, search: location.search, path: location.pathname })}</p>
    <button type="button" onClick={() => handle.setDraft(seed)}>sembrar</button>
    <button type="button" onClick={() => navigate(`${location.pathname}/link${location.search}`)}>ir</button>
  </div>;
}
type Mocks = { list?: ReturnType<typeof vi.fn>; itineraryGet?: ReturnType<typeof vi.fn>; onCreateSpontaneous?: () => void; spontaneousActivity?: boolean };
async function render(path: string, mocks: Mocks = {}) {
  const list = mocks.list ?? vi.fn().mockResolvedValue({ ok: true, value: allPosts });
  const get = vi.fn();
  const itineraryGet = mocks.itineraryGet ?? vi.fn().mockResolvedValue(itineraryOf());
  const picker = <PostLinkPicker posts={{ list, get }} itinerary={{ get: itineraryGet }} timeZone="America/Argentina/Buenos_Aires" onCreateSpontaneous={mocks.onCreateSpontaneous} spontaneousActivity={mocks.spontaneousActivity} />;
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/trips/:tripId/memories" element={<MemoriesLayout />}>
      <Route path="new" element={<Probe />} /><Route path="new/link" element={picker} /><Route path="new/activity" element={<Probe />} />
      <Route path=":postId/edit" element={<Probe />} /><Route path=":postId/edit/link" element={picker} /><Route path=":postId/edit/activity" element={<Probe />} />
    </Route></Routes></MemoryRouter>));
  return { container, list, get, itineraryGet };
}
const button = (container: ParentNode, label: string) => Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.trim() === label) as HTMLButtonElement | undefined;
const click = async (element: Element | undefined | null) => { expect(element).toBeTruthy(); await act(async () => element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))); };
const radio = (container: ParentNode, label: string) => {
  const found = Array.from(container.querySelectorAll("label")).find((item) => item.textContent?.trim().startsWith(label));
  return found?.querySelector('input[type="radio"]') as HTMLInputElement | undefined;
};
const probe = (container: HTMLElement) => JSON.parse(container.querySelector('[data-testid="probe"]')!.textContent!) as
  { draft: PostDraft | null; state: { focus?: string; notice?: string; fromComposer?: boolean } | null; search: string; path: string };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
const editPath = `/trips/${tripId}/memories/${selfId}/edit`, newPath = `/trips/${tripId}/memories/new`;
async function open(path: string, mocks: Mocks = {}, draft: PostDraft = seeded()) {
  seed = draft;
  const view = await render(path, mocks);
  await click(button(view.container, "sembrar")); await click(button(view.container, "ir"));
  return view;
}

describe("PostLinkPicker", () => {
  it("redirects to the composer when there is no draft", async () => {
    const { container } = await render(`${newPath}/link`);
    expect(container.querySelector('[data-testid="probe"]')).not.toBeNull();
    expect(container.querySelector('[role="radiogroup"]')).toBeNull();
  });
  it("moves the focus to the heading, offers exactly the three link types and loads nothing yet", async () => {
    const { container, list, itineraryGet } = await open(newPath);
    const heading = container.querySelector("h1")!;
    expect(document.activeElement).toBe(heading);
    const group = container.querySelector('[role="radiogroup"][aria-label="Vincular a"]')!;
    expect(Array.from(group.querySelectorAll("label")).map((item) => item.textContent?.trim())).toEqual(["Sin vínculo", "Post", "Actividad"]);
    expect(container.textContent).not.toMatch(/transporte/i);
    expect(list).not.toHaveBeenCalled(); expect(itineraryGet).not.toHaveBeenCalled();
  });
  it("lists every post when creating and only loads posts, with an accessible group", async () => {
    const { container, list, itineraryGet } = await open(newPath);
    await click(radio(container, "Post"));
    expect(list).toHaveBeenCalledExactlyOnceWith(tripId); expect(itineraryGet).not.toHaveBeenCalled();
    const group = container.querySelector('[role="radiogroup"][aria-label="Recuerdos disponibles"]')!;
    expect(Array.from(group.querySelectorAll("label")).map((item) => item.textContent?.trim()))
      .toEqual(["Mi recuerdo", "Hijo", "Nieto", "Otro recuerdo", "Recuerdo sin texto"]);
  });
  it("when editing, excludes the own post and its descendants", async () => {
    const { container } = await open(editPath);
    await click(radio(container, "Post"));
    const group = container.querySelector('[role="radiogroup"][aria-label="Recuerdos disponibles"]')!;
    expect(Array.from(group.querySelectorAll("label")).map((item) => item.textContent?.trim())).toEqual(["Otro recuerdo", "Recuerdo sin texto"]);
  });
  it("Accept writes the chosen post into the draft keeping the typed values, and returns focusing the link button", async () => {
    const { container } = await open(newPath);
    await click(radio(container, "Post")); await click(radio(container, "Otro recuerdo")); await click(button(container, "Aceptar"));
    const result = probe(container);
    expect(result.draft).toEqual({ values: { description: "Texto tipeado", mapsUrl: "https://maps.example/x" },
      extras: { link: { kind: "post", id: otherId, label: "Otro recuerdo" }, transportId: null, newActivity: null } });
    expect(result.state?.focus).toBe("link");
    expect(container.querySelector('[role="radiogroup"]')).toBeNull();
  });
  it("Cancel changes nothing and returns", async () => {
    const original = seeded({ kind: "activity", id: activityA, label: "Paseo" });
    const { container } = await open(newPath, {}, original);
    await click(radio(container, "Post")); await click(radio(container, "Otro recuerdo")); await click(button(container, "Cancelar"));
    expect(probe(container).draft).toEqual(original);
    expect(container.querySelector('[role="radiogroup"]')).toBeNull();
  });
  it("changes from a post to an activity", async () => {
    const { container, itineraryGet } = await open(newPath, {}, seeded({ kind: "post", id: otherId, label: "Otro recuerdo" }));
    expect((radio(container, "Post"))!.checked).toBe(true);
    await click(radio(container, "Actividad"));
    expect(itineraryGet).toHaveBeenCalledExactlyOnceWith(tripId);
    await click(radio(container, "Visita al museo")); await click(button(container, "Aceptar"));
    expect(probe(container).draft?.extras).toEqual({ link: { kind: "activity", id: activityB, label: expect.stringContaining("Visita al museo") }, transportId: null, newActivity: null });
  });
  it("removes the link with Sin vínculo", async () => {
    const { container } = await open(newPath, {}, seeded({ kind: "post", id: otherId }));
    await click(radio(container, "Sin vínculo")); await click(button(container, "Aceptar"));
    expect(probe(container).draft?.extras).toEqual({ link: null, transportId: null, newActivity: null });
    expect(probe(container).draft?.values.description).toBe("Texto tipeado");
  });
  it("lists the activities by date with title and time, and keeps the transport when choosing an activity", async () => {
    const { container } = await open(newPath, {}, seeded(null, transportId));
    await click(radio(container, "Actividad"));
    const group = container.querySelector('[role="radiogroup"][aria-label="Actividades disponibles"]')!;
    const labels = Array.from(group.querySelectorAll("label")).map((item) => item.textContent ?? "");
    expect(labels).toHaveLength(2);
    expect(labels[0]).toContain("Paseo por el centro"); expect(labels[0]).toContain("12:00");
    expect(labels[1]).toContain("Visita al museo"); expect(labels[1]).toContain("14:00");
    await click(radio(container, "Paseo")); await click(button(container, "Aceptar"));
    expect(probe(container).draft?.extras.transportId).toBe(transportId);
  });
  it("choosing a post drops the preloaded transport and says so", async () => {
    const { container } = await open(newPath, {}, seeded(null, transportId));
    await click(radio(container, "Post"));
    expect(container.textContent).toContain("se quitará el transporte");
    await click(radio(container, "Otro recuerdo")); await click(button(container, "Aceptar"));
    const result = probe(container);
    expect(result.draft?.extras).toEqual({ link: { kind: "post", id: otherId, label: "Otro recuerdo" }, transportId: null, newActivity: null });
    expect(result.state?.notice).toContain("Un recuerdo continuación no mantiene otro vínculo directo; se quitó el transporte.");
  });
  it("shows loading, then an empty message, for posts", async () => {
    const pending = deferred<unknown>();
    const { container } = await open(newPath, { list: vi.fn().mockReturnValue(pending.promise) });
    await click(radio(container, "Post"));
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Cargando recuerdos");
    await act(async () => pending.resolve({ ok: true, value: [] }));
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Todavía no hay otros recuerdos para vincular.");
  });
  it("says there is no other post when only the own post and descendants exist", async () => {
    const { container } = await open(editPath, { list: vi.fn().mockResolvedValue({ ok: true, value: allPosts.slice(0, 3) }) });
    await click(radio(container, "Post"));
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Todavía no hay otros recuerdos para vincular.");
  });
  it("shows an error with Retry for posts and recovers", async () => {
    const list = vi.fn().mockResolvedValueOnce({ ok: false, error: { kind: "network" } }).mockResolvedValueOnce({ ok: true, value: allPosts });
    const { container } = await open(newPath, { list });
    await click(radio(container, "Post"));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("No pudimos cargar los recuerdos");
    await click(button(container, "Reintentar"));
    expect(list).toHaveBeenCalledTimes(2);
    expect(radio(container, "Otro recuerdo")).toBeDefined();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it("shows loading and empty for activities and does not reload them when switching back", async () => {
    const pending = deferred<unknown>();
    const itineraryGet = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ ok: false, error: { kind: "server" } }).mockResolvedValueOnce(itineraryOf());
    const { container } = await open(newPath, { itineraryGet });
    await click(radio(container, "Actividad"));
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Cargando actividades");
    await act(async () => pending.resolve({ ok: true, value: { activities: [] } }));
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Este viaje todavía no tiene actividades.");
    await click(radio(container, "Post")); await click(radio(container, "Actividad"));
    expect(itineraryGet).toHaveBeenCalledTimes(1);
  });
  it("an activities failure does not affect posts or Sin vínculo and offers Retry", async () => {
    const itineraryGet = vi.fn().mockResolvedValueOnce({ ok: false, error: { kind: "network" } }).mockResolvedValueOnce(itineraryOf());
    const { container, list } = await open(newPath, { itineraryGet });
    await click(radio(container, "Actividad"));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("No pudimos cargar las actividades");
    await click(radio(container, "Post"));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(list).toHaveBeenCalledTimes(1); expect(radio(container, "Otro recuerdo")).toBeDefined();
    await click(radio(container, "Actividad"));
    await click(button(container, "Reintentar"));
    expect(itineraryGet).toHaveBeenCalledTimes(2);
    expect(radio(container, "Paseo")).toBeDefined();
    await click(radio(container, "Sin vínculo")); await click(button(container, "Aceptar"));
    expect(probe(container).draft?.extras.link).toBeNull();
  });
  it("offers the spontaneous activity disabled with a coming-soon note, and it does nothing", async () => {
    const { container } = await open(newPath);
    await click(radio(container, "Actividad"));
    const spontaneous = button(container, "Crear actividad espontánea — Disponible próximamente")!;
    expect(spontaneous.disabled).toBe(true); expect(spontaneous.getAttribute("aria-disabled")).toBe("true");
    await click(spontaneous);
    expect(container.querySelector('[role="radiogroup"]')).not.toBeNull();
  });
  it("offers the spontaneous activity only inside Actividad", async () => {
    const { container } = await open(newPath);
    expect(container.textContent).not.toContain("Crear actividad espontánea");
    await click(radio(container, "Post"));
    expect(container.textContent).not.toContain("Crear actividad espontánea");
  });
  it("with onCreateSpontaneous the button is enabled and calls it once", async () => {
    const onCreateSpontaneous = vi.fn();
    const { container } = await open(newPath, { onCreateSpontaneous });
    await click(radio(container, "Actividad"));
    const spontaneous = button(container, "Crear actividad espontánea")!;
    expect(spontaneous.disabled).toBe(false);
    await click(spontaneous);
    expect(onCreateSpontaneous).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("Disponible próximamente");
  });
  it("with spontaneousActivity the button opens the activity subform, replacing the picker, without writing the pending link", async () => {
    const { container } = await open(`${newPath}?transportId=${transportId}`, { spontaneousActivity: true }, seeded(null, transportId));
    await click(radio(container, "Actividad")); await click(radio(container, "Paseo"));
    const spontaneous = button(container, "Crear actividad espontánea")!;
    expect(spontaneous.disabled).toBe(false);
    expect(container.textContent).not.toContain("Disponible próximamente");
    await click(spontaneous);
    const result = probe(container);
    expect(result.path).toBe(`${newPath}/activity`);
    expect(result.search).toBe(`?transportId=${transportId}`);
    expect(result.state).toEqual({ fromComposer: false });
    expect(result.draft).toEqual(seeded(null, transportId));
  });
  it("on an edit the subform route keeps the post id, and the opening state of the picker is passed on", async () => {
    const { container } = await open(editPath, { spontaneousActivity: true });
    await click(radio(container, "Actividad"));
    await click(button(container, "Crear actividad espontánea"));
    expect(probe(container).path).toBe(`${editPath}/activity`);
  });
  it("keeps the search so the composer base stays the same on return", async () => {
    const { container } = await open(`${newPath}?transportId=${transportId}`, {}, seeded(null, transportId));
    await click(button(container, "Cancelar"));
    expect(probe(container).search).toBe(`?transportId=${transportId}`);
  });
  describe("with a real history (BrowserRouter, asynchronous popstate)", () => {
    function BrowserProbe() {
      const handle = usePostDraft("new"); const location = useLocation(); const navigate = useNavigate();
      return <div>
        <p data-testid="where">{location.pathname}</p>
        <p data-testid="returned">{JSON.stringify(handle.returned ?? null)}</p>
        <p data-testid="link">{JSON.stringify(handle.draft?.extras.link ?? null)}</p>
        <button type="button" onClick={() => handle.setDraft(seeded())}>sembrar</button>
        <button type="button" onClick={() => navigate(`${location.pathname}/link`, { state: { fromComposer: true } })}>ir</button>
      </div>;
    }
    const mountBrowser = async () => {
      window.history.replaceState(null, "", "/listado"); window.history.pushState(null, "", newPath);
      const get = vi.fn(); const list = vi.fn().mockResolvedValue({ ok: true, value: allPosts });
      const container = document.createElement("div"); document.body.append(container);
      const root = createRoot(container); roots.push(root);
      await act(async () => root.render(<BrowserRouter><Routes>
        <Route path="/listado" element={<p data-testid="where">/listado</p>} />
        <Route path="/trips/:tripId/memories" element={<MemoriesLayout />}>
          <Route path="new" element={<BrowserProbe />} />
          <Route path="new/link" element={<PostLinkPicker posts={{ list, get }} itinerary={{ get: vi.fn() }} />} />
        </Route></Routes></BrowserRouter>));
      await click(button(container, "sembrar")); await click(button(container, "ir"));
      return container;
    };
    const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    const where = (container: HTMLElement) => container.querySelector('[data-testid="where"]')?.textContent;
    it.each(["Aceptar", "Cancelar"])("a double tap on %s goes back once, to the composer", async (label) => {
      const container = await mountBrowser();
      const target = button(container, label)!;
      const go = vi.spyOn(window.history, "go");
      await act(async () => {
        target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      await settle();
      expect(go).toHaveBeenCalledTimes(1);
      go.mockRestore();
      expect(where(container)).toBe(newPath);
      expect(JSON.parse(container.querySelector('[data-testid="returned"]')!.textContent!)).toMatchObject({ focus: "link" });
    });
    it("Cancel followed at once by Accept does not write the chosen link and goes back once", async () => {
      const container = await mountBrowser();
      await click(radio(container, "Post")); await click(radio(container, "Otro recuerdo"));
      const cancel = button(container, "Cancelar")!, accept = button(container, "Aceptar")!;
      const go = vi.spyOn(window.history, "go");
      await act(async () => {
        cancel.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        accept.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      await settle();
      expect(go).toHaveBeenCalledTimes(1);
      go.mockRestore();
      expect(where(container)).toBe(newPath);
      expect(container.querySelector('[data-testid="link"]')?.textContent).toBe("null");
      expect(JSON.parse(container.querySelector('[data-testid="returned"]')!.textContent!)).toEqual({ focus: "link" });
    });
    it("the selector can be used again in a later visit", async () => {
      const container = await mountBrowser();
      await click(button(container, "Cancelar")); await settle();
      expect(where(container)).toBe(newPath);
      await click(button(container, "ir"));
      expect(container.querySelector("h1")?.textContent).toBe("Vincular recuerdo");
      await click(button(container, "Cancelar")); await settle();
      expect(where(container)).toBe(newPath);
    });
  });
});
