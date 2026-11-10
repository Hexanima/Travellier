// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, MemoryRouter, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpontaneousActivityForm } from "./SpontaneousActivityForm.js";
import { MemoriesLayout } from "./TripMemoriesScreen.js";
import { itineraryFixture, itineraryId } from "./itinerary-test-fixture.js";
import type { NewActivityDraft, PostDraft } from "./post-draft.js";
import { usePostDraft } from "./use-post-drafts.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); vi.useRealTimers(); });
const tripId = itineraryId(1), postId = itineraryId(30), zone = "America/Argentina/Buenos_Aires";
const newPath = `/trips/${tripId}/memories/new`, editPath = `/trips/${tripId}/memories/${postId}/edit`;
// The fixture's activity slice is 10:00-18:00Z (07:00-15:00 in Buenos Aires).
const itineraryOf = () => ({ ok: true, value: itineraryFixture() });
const seeded = (extras: Partial<PostDraft["extras"]> = {}): PostDraft =>
  ({ values: { description: "Texto tipeado", mapsUrl: "https://maps.example/x" }, extras: { link: null, transportId: null, newActivity: null, photos: [], ...extras } });
let seed: PostDraft = seeded();
function Probe() {
  const { postId: id } = useParams(); const handle = usePostDraft(id ? `edit:${id}` : "new");
  const location = useLocation(); const navigate = useNavigate();
  return <div>
    <p data-testid="probe">{JSON.stringify({ draft: handle.draft ?? null, state: location.state, search: location.search, path: location.pathname, returned: handle.returned ?? null })}</p>
    <button type="button" onClick={() => handle.setDraft(seed)}>sembrar</button>
    <button type="button" onClick={() => navigate(`${location.pathname}/activity${location.search}`, { state: { fromComposer: true } })}>ir</button>
    <button type="button" onClick={() => navigate(`${location.pathname}/activity${location.search}`)}>ir directo</button>
  </div>;
}
const probe = (container: HTMLElement) => JSON.parse(container.querySelector('[data-testid="probe"]')!.textContent!) as
  { draft: PostDraft | null; state: { focus?: string; notice?: string } | null; search: string; path: string; returned: { focus?: string; notice?: string } | null };
async function render(path: string, itineraryGet: ReturnType<typeof vi.fn>) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  const form = <SpontaneousActivityForm itinerary={{ get: itineraryGet }} timeZone={zone} />;
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/trips/:tripId/memories" element={<MemoriesLayout />}>
      <Route path="new" element={<Probe />} /><Route path="new/activity" element={form} />
      <Route path=":postId/edit" element={<Probe />} /><Route path=":postId/edit/activity" element={form} />
    </Route></Routes></MemoryRouter>));
  return container;
}
const button = (container: ParentNode, label: string) => Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.trim() === label) as HTMLButtonElement | undefined;
const click = async (element: Element | undefined | null) => { expect(element).toBeTruthy(); await act(async () => element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))); };
const field = (container: ParentNode, name: string) => container.querySelector(`[name="${name}"]`) as HTMLInputElement;
const type = async (element: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
const now = () => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-25T15:30:00.000Z")); };
/** Opens the subform the way the composer does: draft materialized, then `ir` with fromComposer. */
async function open(path = newPath, draft: PostDraft = seeded(), itineraryGet = vi.fn().mockResolvedValue(itineraryOf()), direct = false) {
  seed = draft; now();
  const container = await render(path, itineraryGet);
  await click(button(container, "sembrar")); await click(button(container, direct ? "ir directo" : "ir"));
  return { container, itineraryGet };
}
const created: NewActivityDraft = { title: "Cena", date: "2026-09-25", time: "12:30", durationHours: "", durationMinutes: "" };

describe("SpontaneousActivityForm", () => {
  it("redirects to the composer when there is no draft", async () => {
    now();
    const container = await render(`${newPath}/activity`, vi.fn().mockResolvedValue(itineraryOf()));
    expect(container.querySelector('[data-testid="probe"]')).not.toBeNull();
    expect(container.querySelector('input[name="title"]')).toBeNull();
  });
  it("preloads the current date and time in the device zone, with an empty title and duration", async () => {
    const { container } = await open();
    expect(field(container, "date").value).toBe("2026-09-25");
    expect(field(container, "time").value).toBe("12:30");
    expect(field(container, "title").value).toBe("");
    expect(field(container, "durationHours").value).toBe(""); expect(field(container, "durationMinutes").value).toBe("");
    expect(document.activeElement).toBe(container.querySelector("h1"));
  });
  it("has no mode selector, no description, no maps link and no window shortcut; the duration is optional", async () => {
    const { container } = await open();
    expect(container.querySelector('input[type="radio"]')).toBeNull();
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.querySelector('[name="description"], [name="mapsUrl"]')).toBeNull();
    expect(container.textContent).not.toMatch(/Usar inicio de franja|Descripción|Maps/);
    expect(container.querySelector("fieldset legend")?.textContent).toBe("Duración estimada · opcional");
    expect(Array.from(container.querySelectorAll("input")).map((input) => input.name)).toEqual(["title", "date", "time", "durationHours", "durationMinutes"]);
  });
  it("Accept stores the activity in the draft without a duration, drops nothing else and returns to the composer with a notice and focus", async () => {
    const { container, itineraryGet } = await open();
    await type(field(container, "title"), "Cena");
    await click(button(container, "Aceptar"));
    const result = probe(container);
    expect(result.path).toBe(newPath);
    expect(result.draft).toEqual({ values: seeded().values, extras: { link: null, transportId: null, newActivity: created } });
    // Back through history: the focus and the notice travel in the drafts context.
    expect(result.returned).toEqual({ focus: "link", notice: "Actividad nueva: Cena, 25/09/2026 12:30. Se creará al publicar." });
    expect(itineraryGet).toHaveBeenCalledExactlyOnceWith(tripId);
  });
  it("stores the typed duration, the new date and the time", async () => {
    const { container } = await open();
    await type(field(container, "title"), "Cena"); await type(field(container, "time"), "13:00");
    await type(field(container, "durationHours"), "1"); await type(field(container, "durationMinutes"), "30");
    await click(button(container, "Aceptar"));
    expect(probe(container).draft?.extras.newActivity).toEqual({ title: "Cena", date: "2026-09-25", time: "13:00", durationHours: "1", durationMinutes: "30" });
  });
  it("replaces an existing link and says so, keeping the transport", async () => {
    const link = { kind: "activity" as const, id: itineraryId(8), label: "Paseo" };
    const { container } = await open(newPath, seeded({ link, transportId: itineraryId(6) }));
    await type(field(container, "title"), "Cena"); await click(button(container, "Aceptar"));
    const result = probe(container);
    expect(result.draft?.extras).toEqual({ link: null, transportId: itineraryId(6), newActivity: created });
    expect(result.returned?.notice).toBe("Actividad nueva: Cena, 25/09/2026 12:30. Se creará al publicar. Se quitó el vínculo anterior.");
  });
  it("opened directly (no composer in the history) Accept replaces this entry with the composer and passes the notice in the location state", async () => {
    const { container } = await open(newPath, seeded(), undefined, true);
    await type(field(container, "title"), "Cena"); await click(button(container, "Aceptar"));
    const result = probe(container);
    expect(result.path).toBe(newPath);
    expect(result.state).toEqual({ focus: "link", notice: "Actividad nueva: Cena, 25/09/2026 12:30. Se creará al publicar." });
    expect(result.draft?.extras.newActivity).toEqual(created);
  });
  it("keeps the search on return", async () => {
    const { container } = await open(`${newPath}?transportId=${itineraryId(6)}`, seeded({ transportId: itineraryId(6) }), undefined, true);
    await type(field(container, "title"), "Cena"); await click(button(container, "Aceptar"));
    expect(probe(container).search).toBe(`?transportId=${itineraryId(6)}`);
  });
  it("Cancel returns without changing the draft or announcing anything", async () => {
    const { container } = await open();
    await type(field(container, "title"), "Cena");
    await click(button(container, "Cancelar"));
    const result = probe(container);
    expect(result.path).toBe(newPath);
    expect(result.draft).toEqual(seeded());
    expect(result.returned).toEqual({ focus: "link" });
  });
  it("preloads the activity already in the draft to edit it, instead of the current moment", async () => {
    const existing: NewActivityDraft = { title: "Museo", date: "2026-09-25", time: "13:00", durationHours: "2", durationMinutes: "" };
    const { container } = await open(editPath, seeded({ newActivity: existing }));
    expect(field(container, "title").value).toBe("Museo"); expect(field(container, "time").value).toBe("13:00");
    expect(field(container, "durationHours").value).toBe("2");
    await type(field(container, "title"), "Museo del arte"); await click(button(container, "Aceptar"));
    const result = probe(container);
    expect(result.path).toBe(editPath);
    expect(result.draft?.extras.newActivity).toEqual({ ...existing, title: "Museo del arte" });
  });
  it("shows an itinerary error with Retry, keeps Accept disabled and recovers", async () => {
    const itineraryGet = vi.fn().mockResolvedValueOnce({ ok: false, error: { kind: "network" } }).mockResolvedValueOnce(itineraryOf());
    const { container } = await open(newPath, seeded(), itineraryGet);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("No pudimos cargar el itinerario");
    expect(button(container, "Aceptar")!.disabled).toBe(true);
    await click(button(container, "Aceptar"));
    expect(container.querySelector('input[name="title"]')).not.toBeNull();
    await click(button(container, "Reintentar"));
    expect(itineraryGet).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(button(container, "Aceptar")!.disabled).toBe(false);
  });
  it("a rejected itinerary request is also an error with Retry", async () => {
    const { container } = await open(newPath, seeded(), vi.fn().mockRejectedValue(new Error("down")));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("No pudimos cargar el itinerario");
    expect(button(container, "Aceptar")!.disabled).toBe(true);
  });
  it("shows loading with Accept disabled until the itinerary is ready", async () => {
    const pending = deferred<unknown>();
    const { container } = await open(newPath, seeded(), vi.fn().mockReturnValue(pending.promise));
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Cargando itinerario");
    expect(button(container, "Aceptar")!.disabled).toBe(true);
    await act(async () => pending.resolve(itineraryOf()));
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(button(container, "Aceptar")!.disabled).toBe(false);
  });
  it("without a title shows one alert, focuses the title and writes nothing", async () => {
    const { container } = await open();
    await click(button(container, "Aceptar"));
    const alerts = container.querySelectorAll('[role="alert"]');
    expect(alerts).toHaveLength(1); expect(alerts[0]!.textContent).toBe("Ingresá un título para la actividad.");
    expect(document.activeElement).toBe(field(container, "title"));
    await click(button(container, "Cancelar"));
    expect(probe(container).draft).toEqual(seeded());
  });
  it("a start outside the activity slice shows the window message on the time, focuses it and keeps the draft", async () => {
    const { container } = await open();
    await type(field(container, "title"), "Cena"); await type(field(container, "time"), "20:00");
    await click(button(container, "Aceptar"));
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Elegí un horario dentro de la franja de actividad del destino.");
    expect(document.activeElement).toBe(field(container, "time"));
    expect(container.querySelector('input[name="title"]')).not.toBeNull();
    await click(button(container, "Cancelar"));
    expect(probe(container).draft).toEqual(seeded());
  });
  it("a duration that ends after the departure is reported on the duration and focuses it", async () => {
    const { container } = await open();
    await type(field(container, "title"), "Cena"); await type(field(container, "time"), "14:00"); await type(field(container, "durationHours"), "3");
    await click(button(container, "Aceptar"));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("La actividad terminaría después de la salida del destino");
    expect(document.activeElement).toBe(field(container, "durationMinutes"));
  });
  it("shows only the first error when several fields are invalid, and typing clears it", async () => {
    const { container } = await open();
    await type(field(container, "durationMinutes"), "75");
    await click(button(container, "Aceptar"));
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(document.activeElement).toBe(field(container, "title"));
    await type(field(container, "title"), "Cena");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it("the current moment outside the slice is preloaded as is and rejected on Accept, not corrected silently", async () => {
    seed = seeded(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-25T22:00:00.000Z"));
    const container = await render(newPath, vi.fn().mockResolvedValue(itineraryOf()));
    await click(button(container, "sembrar")); await click(button(container, "ir"));
    expect(field(container, "time").value).toBe("19:00");
    await type(field(container, "title"), "Cena"); await click(button(container, "Aceptar"));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Elegí un horario dentro de la franja de actividad del destino.");
  });

  describe("with a real history (BrowserRouter, asynchronous popstate)", () => {
    function BrowserProbe() {
      const handle = usePostDraft("new"); const location = useLocation(); const navigate = useNavigate();
      return <div>
        <p data-testid="where">{location.pathname}</p>
        <p data-testid="returned">{JSON.stringify(handle.returned ?? null)}</p>
        <p data-testid="activity">{JSON.stringify(handle.draft?.extras.newActivity ?? null)}</p>
        <button type="button" onClick={() => handle.setDraft(seeded())}>sembrar</button>
        <button type="button" onClick={() => navigate(`${location.pathname}/activity`, { state: { fromComposer: true } })}>ir</button>
      </div>;
    }
    const mountBrowser = async () => {
      now();
      window.history.replaceState(null, "", "/listado"); window.history.pushState(null, "", newPath);
      const container = document.createElement("div"); document.body.append(container);
      const root = createRoot(container); roots.push(root);
      await act(async () => root.render(<BrowserRouter><Routes>
        <Route path="/listado" element={<p data-testid="where">/listado</p>} />
        <Route path="/trips/:tripId/memories" element={<MemoriesLayout />}>
          <Route path="new" element={<BrowserProbe />} />
          <Route path="new/activity" element={<SpontaneousActivityForm itinerary={{ get: vi.fn().mockResolvedValue(itineraryOf()) }} timeZone={zone} />} />
        </Route></Routes></BrowserRouter>));
      await click(button(container, "sembrar")); await click(button(container, "ir"));
      return container;
    };
    const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    const where = (container: HTMLElement) => container.querySelector('[data-testid="where"]')?.textContent;
    it.each(["Aceptar", "Cancelar"])("a double tap on %s goes back once, to the composer", async (label) => {
      const container = await mountBrowser();
      await type(field(container, "title"), "Cena");
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
    it("Cancel followed at once by Accept does not write the activity and goes back once", async () => {
      const container = await mountBrowser();
      await type(field(container, "title"), "Cena");
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
      expect(container.querySelector('[data-testid="activity"]')!.textContent).toBe("null");
    });
  });
});
