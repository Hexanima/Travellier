// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Link, MemoryRouter, Route, Routes, useLocation, useNavigate, type NavigateFunction } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PostComposer } from "./PostComposer.js";
import { ignoreRetryIds } from "./post-composer-test-api.js";
import { PostLinkPicker } from "./PostLinkPicker.js";
import { SpontaneousActivityForm } from "./SpontaneousActivityForm.js";
import { MemoriesLayout } from "./TripMemoriesScreen.js";
import { itineraryFixture, itineraryId } from "./itinerary-test-fixture.js";
import type { PostResponse } from "./trip-post-api.js";

// Lets a test defer «navigate(-1)» (as BrowserRouter does: history.go is asynchronous) to reproduce the window before the popstate arrives.
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
afterEach(async () => { gate.defer = false; gate.back.length = 0; await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
const tripId = itineraryId(1), otherTripId = itineraryId(2), postId = itineraryId(30), otherPostId = itineraryId(33), activityId = itineraryId(40), transportId = itineraryId(50);
const itineraryResult = { ok: true, value: { activities: [{ id: activityId, title: "Paseo por el centro", scheduledAt: "2026-09-25T15:00:00.000Z", durationMinutes: null }] } };
const saved = (extra: Partial<PostResponse> = {}): PostResponse => ({ id: postId, tripId, authorId: itineraryId(20), description: "Atardecer", mapsUrl: null,
  activityId: null, parentPostId: null, transportId: null, createdAt: "2026-01-02T15:30:00.000Z", ...extra });
function Listing() { const location = useLocation(); return <p data-testid="listing">LISTADO {JSON.stringify(location.state)}</p>; }
function Detail() { const location = useLocation(); return <p data-testid="detail">DETALLE {location.pathname} {JSON.stringify(location.state)}</p>; }
function ActivityOrigin() { const location = useLocation(); return <p data-testid="activity-origin">ITINERARIO {location.pathname}{location.search} {JSON.stringify(location.state)}</p>; }
function Back() { const navigate = useNavigate(); return <button type="button" onClick={() => navigate(-1)}>atras</button>; }
function Forward() { const navigate = useNavigate(); return <button type="button" onClick={() => navigate(1)}>adelante</button>; }
type Entry = string | { pathname: string; search?: string; state?: unknown };
async function render(path: Entry | Entry[] = `/trips/${tripId}/memories/new`, overrides: Partial<Record<"create" | "update" | "get" | "list" | "itineraryGet", ReturnType<typeof vi.fn>>> = {}) {
  // Slice 10:00-18:00Z (07:00-15:00 in Buenos Aires) and the activities Paseo por el centro (12Z) and Visita al museo (14Z).
  const itineraryGet = overrides.itineraryGet ?? vi.fn().mockResolvedValue({ ok: true, value: itineraryFixture() });
  const itinerary = { get: itineraryGet };
  const list = overrides.list ?? vi.fn().mockResolvedValue({ ok: true, value: [saved(), saved({ id: otherPostId, description: "Otro recuerdo" })] });
  const picker = <PostLinkPicker posts={{ list, get: vi.fn() }} itinerary={{ get: vi.fn().mockResolvedValue(itineraryResult) }} timeZone="America/Argentina/Buenos_Aires" spontaneousActivity />;
  const subform = <SpontaneousActivityForm itinerary={itinerary} timeZone="America/Argentina/Buenos_Aires" />;
  const create = overrides.create ?? vi.fn().mockResolvedValue({ ok: true, value: saved() });
  const update = overrides.update ?? vi.fn().mockResolvedValue({ ok: true, value: saved({ description: "Editado" }) });
  const get = overrides.get ?? vi.fn().mockResolvedValue({ ok: true, value: { post: saved(), parent: null, children: [], rootActivityId: null } });
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={Array.isArray(path) ? path : [path]}>
    <Back /><Forward /><nav><Link to={`/trips/${tripId}/memories/new`}>nav-new</Link><Link to={`/trips/${tripId}/memories/${postId}/edit`}>nav-edit</Link><Link to={`/trips/${otherTripId}/memories/new`}>nav-other</Link></nav><Routes>
    <Route path="/trips/:tripId/memories" element={<MemoriesLayout />}>
      <Route index element={<Listing />} />
      <Route path=":postId" element={<Detail />} />
      <Route path="new" element={<PostComposer posts={ignoreRetryIds({ create, update, get })} itinerary={itinerary} timeZone="America/Argentina/Buenos_Aires" />} />
      <Route path=":postId/edit" element={<PostComposer posts={ignoreRetryIds({ create, update, get })} itinerary={itinerary} timeZone="America/Argentina/Buenos_Aires" />} />
      <Route path="new/link" element={picker} />
      <Route path=":postId/edit/link" element={picker} />
      <Route path="new/activity" element={subform} />
      <Route path=":postId/edit/activity" element={subform} />
    </Route>
    <Route path="/trips/:tripId/itinerary" element={<ActivityOrigin />} />
    <Route path="/login" element={<p>LOGIN</p>} />
  </Routes></MemoryRouter>));
  return { container, create, update, get, list, itineraryGet };
}
async function field(container: HTMLElement, name: string, value: string) {
  const element = container.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLTextAreaElement;
  expect(element, `Field ${name}`).not.toBeNull();
  const proto = element.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); });
}
const submit = async (container: HTMLElement) => act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
const button = (container: ParentNode, label: string) => Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.trim() === label) as HTMLButtonElement | undefined;
const click = async (element: Element | undefined) => { expect(element).toBeDefined(); await act(async () => element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))); };
const value = (container: HTMLElement, name: string) => (container.querySelector(`[name="${name}"]`) as HTMLInputElement).value;
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };

describe("PostComposer (create)", () => {
  it("has text and location but no date or time field, and a single submit at the end", async () => {
    const { container } = await render();
    expect(container.querySelector('[name="description"]')).not.toBeNull();
    expect(container.querySelector('[name="mapsUrl"]')).not.toBeNull();
    expect(container.querySelector('input[type="date"], input[type="time"], input[type="datetime-local"], [name="createdAt"], [name="dayId"]')).toBeNull();
    expect(container.querySelectorAll('button[type="submit"]')).toHaveLength(1);
    expect(container.querySelector('button[type="submit"]')?.textContent).toContain("Publicar recuerdo");
    expect(container.textContent).not.toContain("Publicado el");
  });
  it("publishes with only text", async () => {
    const { container, create } = await render();
    await field(container, "description", "  Hola  "); await submit(container);
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { description: "Hola" });
  });
  it("keeps the submit enabled without content; clicking it does not publish and shows an associated, focused message that clears on typing", async () => {
    const { container, create } = await render();
    await field(container, "description", "   ");
    const submitButton = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submitButton.disabled).toBe(false);
    await click(submitButton);
    expect(create).not.toHaveBeenCalled();
    const alerts = Array.from(container.querySelectorAll('[role="alert"]')).filter((item) => item.textContent?.includes("Escribí un texto o agregá una ubicación."));
    expect(alerts).toHaveLength(1);
    const input = container.querySelector('[name="description"]') as HTMLTextAreaElement;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(alerts[0].id);
    expect(document.getElementById(input.getAttribute("aria-describedby")!)).toBe(alerts[0]);
    expect(document.activeElement).toBe(input);
    await field(container, "mapsUrl", "https://maps.example/x");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(input.getAttribute("aria-invalid")).toBe("false");
  });
  it("publishes with only a location", async () => {
    const { container, create } = await render();
    await field(container, "mapsUrl", " https://maps.app.goo.gl/x "); await submit(container);
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { mapsUrl: "https://maps.app.goo.gl/x" });
  });
  it("blocks a double submit in the same tick with a single create call", async () => {
    const pending = deferred<unknown>();
    const create = vi.fn().mockReturnValue(pending.promise);
    const { container } = await render(undefined, { create });
    await field(container, "description", "Hola");
    await act(async () => {
      const form = container.querySelector("form")!;
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect((container.querySelector('[name="description"]') as HTMLTextAreaElement).disabled).toBe(true);
    expect(container.querySelector('button[type="submit"]')?.hasAttribute("disabled") || container.querySelector('button[type="submit"]')?.getAttribute("aria-busy") === "true").toBe(true);
    await act(async () => pending.resolve({ ok: true, value: saved() }));
  });
  it("on success clears the draft, goes to the list with the saved post and confirms it", async () => {
    const { container } = await render();
    await field(container, "description", "Atardecer"); await submit(container);
    expect(container.querySelector('[data-testid="listing"]')?.textContent).toContain(postId);
    expect(container.querySelector('[data-testid="listing"]')?.textContent).toContain("Atardecer");
  });
  it("keeps the draft while navigating away and back, and clears it after a successful save", async () => {
    const { container } = await render();
    const link = (label: string) => Array.from(container.querySelectorAll("a")).find((item) => item.textContent === label);
    await field(container, "description", "Borrador persistente");
    await click(link("nav-edit")); await click(link("nav-new"));
    expect(value(container, "description")).toBe("Borrador persistente");
    await submit(container);
    await click(link("nav-new"));
    expect(value(container, "description")).toBe("");
  });
  it("keeps text and location and allows retrying after a network error", async () => {
    const create = vi.fn().mockResolvedValueOnce({ ok: false, error: { kind: "network" } }).mockResolvedValueOnce({ ok: true, value: saved() });
    const { container } = await render(undefined, { create });
    await field(container, "description", "Hola"); await field(container, "mapsUrl", "https://maps.example/x"); await submit(container);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("No pudimos guardar el recuerdo");
    expect(value(container, "description")).toBe("Hola"); expect(value(container, "mapsUrl")).toBe("https://maps.example/x");
    expect(container.querySelector('button[type="submit"]')?.hasAttribute("disabled")).toBe(false);
    await submit(container);
    expect(create).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-testid="listing"]')).not.toBeNull();
  });
  it("shows a field error for mapsUrl on 422, keeps the draft and focuses the field", async () => {
    const create = vi.fn().mockResolvedValue({ ok: false, error: { kind: "validation", fields: [{ field: "mapsUrl", code: "invalid", message: "x" }] } });
    const { container } = await render(undefined, { create });
    await field(container, "description", "Hola"); await field(container, "mapsUrl", "???"); await submit(container);
    const input = container.querySelector('[name="mapsUrl"]') as HTMLInputElement;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent?.length).toBeGreaterThan(0);
    expect(document.activeElement).toBe(input);
    expect(value(container, "description")).toBe("Hola"); expect(input.value).toBe("???");
  });
  it("clears a field error when the field changes", async () => {
    const create = vi.fn().mockResolvedValue({ ok: false, error: { kind: "validation", fields: [{ field: "mapsUrl", code: "invalid", message: "x" }] } });
    const { container } = await render(undefined, { create });
    await field(container, "mapsUrl", "???"); await submit(container);
    await field(container, "mapsUrl", "https://x.example");
    expect((container.querySelector('[name="mapsUrl"]') as HTMLInputElement).getAttribute("aria-invalid")).toBe("false");
  });
  it("shows a generic error for validation without a known field", async () => {
    const create = vi.fn().mockResolvedValue({ ok: false, error: { kind: "validation", fields: [{ field: "other", code: "invalid", message: "x" }] } });
    const { container } = await render(undefined, { create });
    await field(container, "description", "Hola"); await submit(container);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Revisá los datos");
  });
  it("tells that the memory is unavailable on 403 and links back to the list", async () => {
    const create = vi.fn().mockResolvedValue({ ok: false, error: { kind: "forbidden" } });
    const { container } = await render(undefined, { create });
    await field(container, "description", "Hola"); await submit(container);
    expect(container.textContent).toContain("Este recuerdo ya no está disponible para tu cuenta.");
    expect(container.querySelector(`a[href="/trips/${tripId}/memories"]`)).not.toBeNull();
  });
  it("offers to log in again on 401", async () => {
    const create = vi.fn().mockResolvedValue({ ok: false, error: { kind: "unauthorized" } });
    const { container } = await render(undefined, { create });
    await field(container, "description", "Hola"); await submit(container);
    expect(container.textContent).toContain("Tu sesión venció");
    expect(container.querySelector('a[href="/login"]')).not.toBeNull();
  });
  it("does not depend on the itinerary: it publishes without loading anything else", async () => {
    const { container, create, get, itineraryGet } = await render();
    await field(container, "description", "Sin itinerario"); await submit(container);
    expect(create).toHaveBeenCalledTimes(1); expect(get).not.toHaveBeenCalled(); expect(itineraryGet).not.toHaveBeenCalled();
  });
});

describe("PostComposer (discard)", () => {
  it("leaves directly without changes", async () => {
    const { container } = await render();
    await click(button(container, "Cancelar"));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[data-testid="listing"]')).not.toBeNull();
  });
  it("asks for confirmation with changes; keep editing preserves the draft and focuses the safe action", async () => {
    const { container } = await render();
    await field(container, "description", "Borrador"); await click(button(container, "Cancelar"));
    const dialog = container.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Descartar cambios");
    expect(document.activeElement?.textContent).toBe("Seguir editando");
    await click(button(dialog as HTMLElement, "Seguir editando"));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(value(container, "description")).toBe("Borrador");
  });
  it("Escape behaves as keep editing", async () => {
    const { container } = await render();
    await field(container, "description", "Borrador"); await click(button(container, "Cancelar"));
    await act(async () => container.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(value(container, "description")).toBe("Borrador");
    expect(container.querySelector('[data-testid="listing"]')).toBeNull();
  });
  it("discarding leaves and clears the draft", async () => {
    const { container } = await render();
    await field(container, "description", "Borrador"); await click(button(container, "Cancelar"));
    await click(button(container.querySelector('[role="dialog"]') as HTMLElement, "Descartar"));
    expect(container.querySelector('[data-testid="listing"]')).not.toBeNull();
    await click(Array.from(container.querySelectorAll("a")).find((item) => item.textContent === "nav-new"));
    expect(value(container, "description")).toBe(""); expect(value(container, "mapsUrl")).toBe("");
  });
  it("discards the draft when switching to another trip, and it is not back when returning", async () => {
    const { container } = await render();
    const link = (label: string) => Array.from(container.querySelectorAll("a")).find((item) => item.textContent === label);
    await field(container, "description", "Borrador de A");
    await click(link("nav-other"));
    expect(value(container, "description")).toBe("");
    await click(link("nav-new"));
    expect(value(container, "description")).toBe("");
  });
});

describe("PostComposer (edit)", () => {
  const editPath = `/trips/${tripId}/memories/${postId}/edit`;
  it("loads the post, shows the server publication date read-only and no date field", async () => {
    const { container, get } = await render(editPath);
    expect(get).toHaveBeenCalledExactlyOnceWith(tripId, postId);
    expect(value(container, "description")).toBe("Atardecer");
    expect(container.textContent).toMatch(/Publicado el .*2026.*12:30/);
    expect(container.querySelector('input[type="date"], input[type="time"], input[type="datetime-local"], [name="createdAt"]')).toBeNull();
    expect(container.querySelector('button[type="submit"]')?.textContent).toContain("Guardar cambios");
  });
  it("shows loading and then a retry when loading fails", async () => {
    const get = vi.fn().mockResolvedValueOnce({ ok: false, error: { kind: "network" } })
      .mockResolvedValueOnce({ ok: true, value: { post: saved(), parent: null, children: [], rootActivityId: null } });
    const { container } = await render(editPath, { get });
    expect(container.textContent).toContain("No pudimos cargar el recuerdo");
    await click(button(container, "Reintentar"));
    expect(value(container, "description")).toBe("Atardecer");
  });
  it("is unavailable on 404 from the load", async () => {
    const get = vi.fn().mockResolvedValue({ ok: false, error: { kind: "not-found" } });
    const { container } = await render(editPath, { get });
    expect(container.textContent).toContain("Este recuerdo ya no está disponible para tu cuenta.");
  });
  it("sends only the changed content, never createdAt or dayId, and keeps the server date", async () => {
    const { container, update } = await render(editPath);
    await field(container, "description", "Editado"); await submit(container);
    expect(update).toHaveBeenCalledExactlyOnceWith(tripId, postId, { description: "Editado" });
    const listing = container.querySelector('[data-testid="listing"]')?.textContent ?? "";
    expect(listing).toContain("Editado"); expect(listing).not.toContain("dayId");
  });
  it("says there is nothing to save without calling the API", async () => {
    const { container, update } = await render(editPath);
    await submit(container);
    expect(update).not.toHaveBeenCalled();
    expect(container.textContent).toContain("No hay cambios para guardar.");
  });
  it("does not allow emptying both: the save stays enabled, does not call update and shows an associated message that clears on typing", async () => {
    const { container, update } = await render(editPath);
    await field(container, "description", "");
    const saveButton = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(saveButton.disabled).toBe(false);
    await click(saveButton);
    expect(update).not.toHaveBeenCalled();
    const alerts = Array.from(container.querySelectorAll('[role="alert"]')).filter((item) => item.textContent?.includes("Escribí un texto o agregá una ubicación."));
    expect(alerts).toHaveLength(1);
    const input = container.querySelector('[name="description"]') as HTMLTextAreaElement;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(alerts[0].id);
    expect(document.getElementById(input.getAttribute("aria-describedby")!)).toBe(alerts[0]);
    expect(document.activeElement).toBe(input);
    await field(container, "description", "Nuevo");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it("keeps an existing edit draft instead of overwriting it when the screen is mounted again", async () => {
    const { container } = await render(editPath);
    const link = (label: string) => Array.from(container.querySelectorAll("a")).find((item) => item.textContent === label);
    await field(container, "description", "Cambio sin guardar");
    await click(link("nav-new")); await click(link("nav-edit"));
    expect(value(container, "description")).toBe("Cambio sin guardar");
  });
});

const radio = (container: ParentNode, label: string) => Array.from(container.querySelectorAll("label")).find((item) => item.textContent?.trim().startsWith(label))?.querySelector('input[type="radio"]') as HTMLInputElement | undefined;
const alerts = (container: HTMLElement) => Array.from(container.querySelectorAll('[role="alert"]'));
const linkButton = (container: HTMLElement) => button(container, "Vincular a")!;
async function chooseLink(container: HTMLElement, kind: "Post" | "Actividad" | "Sin vínculo", option?: string) {
  await click(linkButton(container)); await click(radio(container, kind));
  if (option) await click(radio(container, option));
  await click(button(container, "Aceptar"));
}
const editPath = `/trips/${tripId}/memories/${postId}/edit`, newPath = `/trips/${tripId}/memories/new`;

describe("PostComposer (link)", () => {
  it("shows the link summary, and the Vincular a button is described by it", async () => {
    const { container } = await render();
    const summary = container.querySelector("#post-link-summary")!;
    expect(summary.textContent).toBe("Sin vínculo");
    expect(linkButton(container).getAttribute("aria-describedby")).toContain(summary.id);
    expect(container.textContent).not.toContain("Vinculado a un transporte");
  });
  it("keeps the typed text and location when going to the selector and coming back (create)", async () => {
    const { container } = await render();
    await field(container, "description", "Texto tipeado"); await field(container, "mapsUrl", "https://maps.example/x");
    await click(linkButton(container));
    expect(container.querySelector('[name="description"]')).toBeNull();
    await click(button(container, "Cancelar"));
    expect(value(container, "description")).toBe("Texto tipeado"); expect(value(container, "mapsUrl")).toBe("https://maps.example/x");
  });
  it("keeps the typed text and location when going to the selector and coming back (edit), materializing the draft", async () => {
    const { container } = await render(editPath);
    await field(container, "description", "Cambio nuevo"); await field(container, "mapsUrl", "https://maps.example/y");
    await click(linkButton(container));
    expect(container.querySelector('[role="radiogroup"][aria-label="Vincular a"]')).not.toBeNull();
    await click(radio(container, "Sin vínculo")); await click(button(container, "Aceptar"));
    expect(value(container, "description")).toBe("Cambio nuevo"); expect(value(container, "mapsUrl")).toBe("https://maps.example/y");
  });
  it("opens the selector from an edit without changes on the text (the draft does not exist yet)", async () => {
    const { container } = await render(editPath);
    await click(linkButton(container));
    expect(container.querySelector('[role="radiogroup"][aria-label="Vincular a"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="listing"]')).toBeNull();
  });
  it("returns focusing the Vincular a button, announcing the result and showing the summary", async () => {
    const { container } = await render();
    await field(container, "description", "Hola");
    await chooseLink(container, "Post", "Otro recuerdo");
    expect(document.activeElement).toBe(linkButton(container));
    expect(container.querySelector("#post-link-summary")?.textContent).toBe("Recuerdo: Otro recuerdo");
    expect(Array.from(container.querySelectorAll('[role="status"]')).some((item) => item.textContent?.includes("Vínculo actualizado: Recuerdo: Otro recuerdo."))).toBe(true);
  });
  it("publishes a continuation memory with only parentPostId", async () => {
    const { container, create } = await render();
    await field(container, "description", "Hola");
    await chooseLink(container, "Post", "Otro recuerdo"); await submit(container);
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { description: "Hola", parentPostId: otherPostId });
  });
  it("publishes linked to an activity", async () => {
    const { container, create } = await render();
    await field(container, "description", "Hola");
    await chooseLink(container, "Actividad", "Paseo por el centro"); await submit(container);
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { description: "Hola", activityId });
  });
  it("preloads the transport from ?transportId=, shows it apart from the selector and publishes it", async () => {
    const { container, create } = await render(`${newPath}?transportId=${transportId}`);
    expect(container.textContent).toContain("Vinculado a un transporte");
    expect(container.querySelector('button[type="submit"]')?.textContent).toContain("Publicar recuerdo");
    await click(linkButton(container));
    const group = container.querySelector('[role="radiogroup"][aria-label="Vincular a"]')!;
    expect(Array.from(group.querySelectorAll("label")).map((item) => item.textContent?.trim())).toEqual(["Sin vínculo", "Post", "Actividad"]);
    await click(button(container, "Cancelar"));
    await field(container, "description", "En camino"); await submit(container);
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { description: "En camino", transportId });
  });
  it("does not count the preloaded transport as a change and cancels without confirmation", async () => {
    const { container } = await render(`${newPath}?transportId=${transportId}`);
    await click(button(container, "Cancelar"));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[data-testid="listing"]')).not.toBeNull();
  });
  it("removes the preloaded transport with Quitar transporte", async () => {
    const { container, create } = await render(`${newPath}?transportId=${transportId}`);
    await click(button(container, "Quitar transporte"));
    expect(container.textContent).not.toContain("Vinculado a un transporte");
    await field(container, "description", "Hola"); await submit(container);
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { description: "Hola" });
  });
  it("ignores an invalid transportId without breaking", async () => {
    const { container, create } = await render(`${newPath}?transportId=nope`);
    expect(container.textContent).not.toContain("Vinculado a un transporte");
    await field(container, "description", "Hola"); await submit(container);
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { description: "Hola" });
  });
  it("choosing Post with a preloaded transport drops the transport, announces it, and the POST has the parent and no transport", async () => {
    const { container, create } = await render(`${newPath}?transportId=${transportId}`);
    await field(container, "description", "Hola");
    await chooseLink(container, "Post", "Otro recuerdo");
    expect(container.textContent).not.toContain("Vinculado a un transporte");
    expect(Array.from(container.querySelectorAll('[role="status"]')).some((item) => item.textContent?.includes("Un recuerdo continuación no mantiene otro vínculo directo; se quitó el transporte."))).toBe(true);
    await submit(container);
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { description: "Hola", parentPostId: otherPostId });
  });
  it("editing a post that has an activity and choosing a Post sends the parent and clears the activity explicitly", async () => {
    const get = vi.fn().mockResolvedValue({ ok: true, value: { post: saved({ activityId }), parent: null, children: [], rootActivityId: activityId } });
    const { container, update } = await render(editPath, { get });
    expect(container.querySelector("#post-link-summary")?.textContent).toContain("Actividad");
    await chooseLink(container, "Post", "Otro recuerdo"); await submit(container);
    expect(update).toHaveBeenCalledExactlyOnceWith(tripId, postId, { parentPostId: otherPostId, activityId: null });
  });
  it("editing a child and removing the link sends parentPostId null", async () => {
    const get = vi.fn().mockResolvedValue({ ok: true, value: { post: saved({ parentPostId: otherPostId }), parent: null, children: [], rootActivityId: null } });
    const { container, update } = await render(editPath, { get });
    await chooseLink(container, "Sin vínculo"); await submit(container);
    expect(update).toHaveBeenCalledExactlyOnceWith(tripId, postId, { parentPostId: null });
  });
  it("allows relinking an existing memory without text or location, but not emptying its fields", async () => {
    const get = vi.fn().mockResolvedValue({ ok: true, value: { post: saved({ description: null, mapsUrl: null }), parent: null, children: [], rootActivityId: null } });
    const { container, update } = await render(editPath, { get });
    await chooseLink(container, "Post", "Otro recuerdo"); await submit(container);
    expect(update).toHaveBeenCalledExactlyOnceWith(tripId, postId, { parentPostId: otherPostId });
  });
  it("still blocks creating with only a link, with the single missing-content notice", async () => {
    const { container, create } = await render();
    await chooseLink(container, "Post", "Otro recuerdo"); await submit(container);
    expect(create).not.toHaveBeenCalled();
    expect(alerts(container).filter((item) => item.textContent?.includes("Escribí un texto o agregá una ubicación."))).toHaveLength(1);
    expect(alerts(container)).toHaveLength(1);
  });
  it("asks for confirmation when cancelling after changing only the link", async () => {
    const { container } = await render();
    await chooseLink(container, "Post", "Otro recuerdo");
    await click(button(container, "Cancelar"));
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("Descartar cambios");
  });
  it.each([
    ["cycle", "Ese recuerdo no puede ser el vínculo: crearía un ciclo. Elegí otro."],
    ["self_reference", "Ese recuerdo no puede ser el vínculo: crearía un ciclo. Elegí otro."],
    ["conflict", "Un recuerdo continuación no puede tener otro vínculo directo."],
    ["other", "No pudimos aplicar el vínculo. Elegí otro."],
  ])("a 422 parentPostId/%s keeps the draft, shows one focused alert, does not navigate and allows retrying", async (code, message) => {
    const create = vi.fn().mockResolvedValueOnce({ ok: false, error: { kind: "validation", fields: [{ field: "parentPostId", code, message: "x" }] } })
      .mockResolvedValueOnce({ ok: true, value: saved() });
    const { container } = await render(undefined, { create });
    await field(container, "description", "Hola"); await field(container, "mapsUrl", "https://maps.example/x");
    await chooseLink(container, "Post", "Otro recuerdo"); await submit(container);
    expect(alerts(container)).toHaveLength(1);
    expect(alerts(container)[0]!.textContent).toBe(message);
    expect(container.querySelector('[data-testid="listing"]')).toBeNull();
    expect(value(container, "description")).toBe("Hola"); expect(value(container, "mapsUrl")).toBe("https://maps.example/x");
    expect(container.querySelector("#post-link-summary")?.textContent).toBe("Recuerdo: Otro recuerdo");
    expect(document.activeElement).toBe(linkButton(container));
    expect(linkButton(container).getAttribute("aria-describedby")).toContain(alerts(container)[0]!.id);
    await submit(container);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenLastCalledWith(tripId, { description: "Hola", mapsUrl: "https://maps.example/x", parentPostId: otherPostId });
    expect(container.querySelector('[data-testid="listing"]')).not.toBeNull();
  });
  it("a 422 on activityId shows the generic link message once", async () => {
    const create = vi.fn().mockResolvedValue({ ok: false, error: { kind: "validation", fields: [{ field: "activityId", code: "not_found", message: "x" }] } });
    const { container } = await render(undefined, { create });
    await field(container, "description", "Hola"); await chooseLink(container, "Actividad", "Paseo por el centro"); await submit(container);
    expect(alerts(container).map((item) => item.textContent)).toEqual(["No pudimos aplicar el vínculo. Elegí otro."]);
  });
  it("clears the link alert when the link changes", async () => {
    const create = vi.fn().mockResolvedValue({ ok: false, error: { kind: "validation", fields: [{ field: "parentPostId", code: "cycle", message: "x" }] } });
    const { container } = await render(undefined, { create });
    await field(container, "description", "Hola"); await chooseLink(container, "Post", "Otro recuerdo"); await submit(container);
    await chooseLink(container, "Sin vínculo");
    expect(alerts(container)).toHaveLength(0);
  });
  it("a 403 on a linked save shows the T65 message and keeps the draft", async () => {
    const create = vi.fn().mockResolvedValue({ ok: false, error: { kind: "forbidden" } });
    const { container } = await render(undefined, { create });
    await field(container, "description", "Hola"); await chooseLink(container, "Post", "Otro recuerdo"); await submit(container);
    expect(container.textContent).toContain("Este recuerdo ya no está disponible para tu cuenta.");
    const link = (label: string) => Array.from(container.querySelectorAll("a")).find((item) => item.textContent === label);
    await click(link("nav-edit")); await click(link("nav-new"));
    expect(value(container, "description")).toBe("Hola");
    expect(container.querySelector("#post-link-summary")?.textContent).toBe("Recuerdo: Otro recuerdo");
  });
  it("a network error on a linked save keeps the draft and the generic message", async () => {
    const create = vi.fn().mockResolvedValue({ ok: false, error: { kind: "network" } });
    const { container } = await render(undefined, { create });
    await field(container, "description", "Hola"); await chooseLink(container, "Post", "Otro recuerdo"); await submit(container);
    expect(alerts(container)[0]?.textContent).toContain("No pudimos guardar el recuerdo");
    expect(container.querySelector("#post-link-summary")?.textContent).toBe("Recuerdo: Otro recuerdo");
  });
});

describe("PostComposer (legacy data, edit preload and history)", () => {
  it("a legacy child with a transport does not show the transport and the PATCH clears it explicitly", async () => {
    const get = vi.fn().mockResolvedValue({ ok: true, value: { post: saved({ parentPostId: otherPostId, transportId }), parent: null, children: [], rootActivityId: null } });
    const { container, update } = await render(editPath, { get });
    expect(container.textContent).not.toContain("Vinculado a un transporte");
    await field(container, "description", "Editado"); await submit(container);
    expect(update).toHaveBeenCalledExactlyOnceWith(tripId, postId, { description: "Editado", transportId: null });
  });
  it("ignores ?transportId= when editing: no transport is shown and the PATCH does not send it", async () => {
    const { container, update } = await render(`${editPath}?transportId=${transportId}`);
    expect(container.textContent).not.toContain("Vinculado a un transporte");
    await click(linkButton(container)); await click(button(container, "Cancelar"));
    expect(container.textContent).not.toContain("Vinculado a un transporte");
    await field(container, "description", "Editado"); await submit(container);
    expect(update).toHaveBeenCalledExactlyOnceWith(tripId, postId, { description: "Editado" });
  });
  it("after Aceptar, going back from the composer reaches the listing and not another composer", async () => {
    const { container } = await render([`/trips/${tripId}/memories`, newPath]);
    await chooseLink(container, "Post", "Otro recuerdo");
    expect(container.querySelector('[name="description"]')).not.toBeNull();
    await click(button(container, "atras"));
    expect(container.querySelector('[data-testid="listing"]')).not.toBeNull();
  });
  it("after Cancelar, going back from the composer reaches the listing and not another composer", async () => {
    const { container } = await render([`/trips/${tripId}/memories`, newPath]);
    await click(linkButton(container)); await click(button(container, "Cancelar"));
    expect(document.activeElement).toBe(linkButton(container));
    await click(button(container, "atras"));
    expect(container.querySelector('[data-testid="listing"]')).not.toBeNull();
  });
});

const scheduledAt = "2026-09-25T15:00:00.000Z";
const newActivityBody = { title: "Cena", scheduledAt, durationMinutes: 90 };
const activityResponse = { id: itineraryId(60), tripId, dayId: itineraryId(4), title: "Cena", description: null, mapsUrl: null, scheduledAt, durationMinutes: 90,
  createdAt: "2026-09-25T10:00:00.123Z", createdBy: itineraryId(20) };
const participation = { id: itineraryId(61), tripId, activityId: itineraryId(60), userId: itineraryId(20), status: "going", updatedAt: "2026-09-25T12:00:00.123Z" };
const withActivity = (extra: Partial<PostResponse> = {}) => ({ ...saved(extra), activity: activityResponse, participation });
const confirmation = { confirmedConflicts: [{ activityId: itineraryId(8), reason: "overlap" as const, scheduledAt: "2026-09-25T14:30:00.000Z", durationMinutes: 60 }],
  confirmedActivity: { scheduledAt, durationMinutes: 90 } };
const conflict = { ok: false, error: { kind: "participation-conflict", confirmation } };
const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement | null;
const summary = (container: HTMLElement) => container.querySelector("#post-link-summary")?.textContent;
/** Opens the picker, then the subform from «Crear actividad espontánea», fills it and accepts: back at the composer. */
async function addActivity(container: HTMLElement, values: { title?: string; time?: string; date?: string; hours?: string; minutes?: string } = {}) {
  await click(linkButton(container)); await click(radio(container, "Actividad")); await click(button(container, "Crear actividad espontánea"));
  await field(container, "title", values.title ?? "Cena"); await field(container, "date", values.date ?? "2026-09-25"); await field(container, "time", values.time ?? "12:00");
  await field(container, "durationHours", values.hours ?? "1"); await field(container, "durationMinutes", values.minutes ?? "30");
  await click(button(container, "Aceptar"));
}

describe("PostComposer (new activity)", () => {
  it("creates the activity from the link area with no mode selector, and shows it in the summary with edit and remove", async () => {
    const { container } = await render();
    await field(container, "description", "Hola");
    await addActivity(container);
    expect(container.querySelector('[name="description"]')).not.toBeNull();
    expect(summary(container)).toBe("Actividad nueva: Cena · 25/09/2026 12:00 · 1 h 30 min");
    expect(button(container, "Editar actividad nueva")).toBeDefined(); expect(button(container, "Quitar actividad nueva")).toBeDefined();
    expect(document.activeElement).toBe(linkButton(container));
    expect(Array.from(container.querySelectorAll('[role="status"]')).some((item) => item.textContent?.includes("Actividad nueva: Cena, 25/09/2026 12:00. Se creará al publicar."))).toBe(true);
    expect(container.querySelector('[type="radio"]')).toBeNull();
  });
  it("publishes memory, activity and participation in a single create without dayId, and confirms both", async () => {
    const create = vi.fn().mockResolvedValue({ ok: true, value: withActivity() });
    const { container } = await render(undefined, { create });
    await field(container, "description", "Hola"); await addActivity(container); await submit(container);
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { description: "Hola", newActivity: newActivityBody });
    const listing = container.querySelector('[data-testid="listing"]')?.textContent ?? "";
    expect(listing).toContain('"notice":"created-activity"'); expect(listing).toContain('"going":true'); expect(listing).toContain(postId);
    expect(listing).not.toContain("dayId");
    await click(Array.from(container.querySelectorAll("a")).find((item) => item.textContent === "nav-new"));
    expect(value(container, "description")).toBe("");
    expect(summary(container)).toBe("Sin vínculo");
  });
  it("omits the duration when none was typed and keeps the preloaded transport next to the activity", async () => {
    const create = vi.fn().mockResolvedValue({ ok: true, value: withActivity({ transportId }) });
    const { container } = await render(`${newPath}?transportId=${transportId}`, { create });
    await field(container, "description", "Hola"); await addActivity(container, { hours: "", minutes: "" }); await submit(container);
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { description: "Hola", transportId, newActivity: { title: "Cena", scheduledAt } });
  });
  it("keeps the content rule: creating still needs text or a location even with a new activity", async () => {
    const { container, create } = await render();
    await addActivity(container); await submit(container);
    expect(create).not.toHaveBeenCalled();
    expect(alerts(container)).toHaveLength(1);
    expect(alerts(container)[0]!.textContent).toBe("Escribí un texto o agregá una ubicación.");
  });
  it("asks for confirmation when cancelling after adding only a new activity", async () => {
    const { container } = await render();
    await addActivity(container); await click(button(container, "Cancelar"));
    expect(dialog()?.textContent).toContain("Descartar cambios");
  });
  it("Quitar actividad nueva goes back to Sin vínculo and publishes without it", async () => {
    const { container, create } = await render();
    await field(container, "description", "Hola"); await addActivity(container);
    await click(button(container, "Quitar actividad nueva"));
    expect(summary(container)).toBe("Sin vínculo");
    expect(button(container, "Quitar actividad nueva")).toBeUndefined();
    await submit(container);
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { description: "Hola" });
  });
  it("Editar actividad nueva reopens the subform with the loaded activity and the changes come back", async () => {
    const create = vi.fn().mockResolvedValue({ ok: true, value: withActivity() });
    const { container } = await render(undefined, { create });
    await field(container, "description", "Hola"); await addActivity(container);
    await click(button(container, "Editar actividad nueva"));
    expect(value(container, "title")).toBe("Cena"); expect(value(container, "time")).toBe("12:00"); expect(value(container, "durationHours")).toBe("1");
    await field(container, "title", "Cena larga"); await click(button(container, "Aceptar"));
    expect(summary(container)).toBe("Actividad nueva: Cena larga · 25/09/2026 12:00 · 1 h 30 min");
    expect(value(container, "description")).toBe("Hola");
    await submit(container);
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { description: "Hola", newActivity: { ...newActivityBody, title: "Cena larga" } });
  });
  it("cancelling the subform keeps the memory draft untouched", async () => {
    const { container } = await render();
    await field(container, "description", "Hola");
    await click(linkButton(container)); await click(radio(container, "Actividad")); await click(button(container, "Crear actividad espontánea"));
    await field(container, "title", "No guardar"); await click(button(container, "Cancelar"));
    expect(value(container, "description")).toBe("Hola"); expect(summary(container)).toBe("Sin vínculo");
  });
  it.each([["Post", "Otro recuerdo", "Recuerdo: Otro recuerdo", { parentPostId: otherPostId }], ["Actividad", "Paseo por el centro", "Actividad: Paseo por el centro — 25 sept, 12:00", { activityId }]])(
    "choosing an existing %s discards the new activity with a notice and publishes only the link", async (kind, option, label, body) => {
      const { container, create } = await render();
      await field(container, "description", "Hola"); await addActivity(container);
      await chooseLink(container, kind as "Post" | "Actividad", option);
      expect(summary(container)).toBe(label);
      expect(button(container, "Quitar actividad nueva")).toBeUndefined();
      expect(Array.from(container.querySelectorAll('[role="status"]')).some((item) => item.textContent?.includes("Se descartó la actividad nueva."))).toBe(true);
      await submit(container);
      expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { description: "Hola", ...body });
    });
  it("opening the picker and accepting without choosing anything keeps the new activity", async () => {
    const { container } = await render();
    await field(container, "description", "Hola"); await addActivity(container);
    await click(linkButton(container)); await click(button(container, "Aceptar"));
    expect(summary(container)).toBe("Actividad nueva: Cena · 25/09/2026 12:00 · 1 h 30 min");
  });
  it("creating the activity replaces the link chosen before and says so", async () => {
    const { container, create } = await render();
    await field(container, "description", "Hola"); await chooseLink(container, "Post", "Otro recuerdo"); await addActivity(container);
    expect(summary(container)).toBe("Actividad nueva: Cena · 25/09/2026 12:00 · 1 h 30 min");
    expect(Array.from(container.querySelectorAll('[role="status"]')).some((item) => item.textContent?.includes("Se quitó el vínculo anterior."))).toBe(true);
    create.mockResolvedValue({ ok: true, value: withActivity() });
    await submit(container);
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { description: "Hola", newActivity: newActivityBody });
  });

  describe("conflict confirmation", () => {
    const publish = async (create: ReturnType<typeof vi.fn>) => {
      const view = await render(undefined, { create });
      await field(view.container, "description", "Hola"); await addActivity(view.container); await submit(view.container);
      return view;
    };
    it("opens the modal with the titles from the itinerary, publishing and navigating nothing yet", async () => {
      const create = vi.fn().mockResolvedValue(conflict);
      const { container } = await publish(create);
      expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { description: "Hola", newActivity: newActivityBody });
      expect(dialog()?.textContent).toContain("Cambiar de plan");
      expect(dialog()?.textContent).toContain("Paseo por el centro");
      expect(dialog()?.textContent).toContain("Se superpone");
      expect(container.querySelector('[data-testid="listing"]')).toBeNull();
      expect(alerts(container)).toHaveLength(0);
    });
    it("falls back to a generic name when the itinerary has no such activity", async () => {
      const create = vi.fn().mockResolvedValue({ ok: false, error: { kind: "participation-conflict",
        confirmation: { ...confirmation, confirmedConflicts: [{ ...confirmation.confirmedConflicts[0]!, activityId: itineraryId(99) }] } } });
      await publish(create);
      expect(dialog()?.textContent).toContain("Otra actividad");
    });
    it("Conservar mi participación actual closes the modal, keeps the draft, does not publish or navigate, and returns the focus to the publish button", async () => {
      const create = vi.fn().mockResolvedValue(conflict);
      const { container } = await publish(create);
      await click(button(dialog()!, "Conservar mi participación actual"));
      expect(dialog()).toBeNull();
      expect(create).toHaveBeenCalledTimes(1);
      expect(container.querySelector('[data-testid="listing"]')).toBeNull();
      expect(value(container, "description")).toBe("Hola");
      expect(summary(container)).toBe("Actividad nueva: Cena · 25/09/2026 12:00 · 1 h 30 min");
      expect(document.activeElement).toBe(container.querySelector('button[type="submit"]'));
      expect(alerts(container)).toHaveLength(0);
    });
    it("Escape behaves as cancelling", async () => {
      const create = vi.fn().mockResolvedValue(conflict);
      const { container } = await publish(create);
      await act(async () => dialog()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      expect(dialog()).toBeNull(); expect(create).toHaveBeenCalledTimes(1); expect(container.querySelector('[data-testid="listing"]')).toBeNull();
    });
    it("a later publish after cancelling asks again, and confirming resends the same entry with the confirmation and then navigates", async () => {
      const create = vi.fn().mockResolvedValueOnce(conflict).mockResolvedValueOnce(conflict).mockResolvedValueOnce({ ok: true, value: withActivity() });
      const { container } = await publish(create);
      await click(button(dialog()!, "Conservar mi participación actual"));
      await submit(container);
      expect(create).toHaveBeenCalledTimes(2); expect(dialog()).not.toBeNull();
      await click(button(dialog()!, "Cambiar de plan"));
      expect(create).toHaveBeenCalledTimes(3);
      expect(create).toHaveBeenNthCalledWith(3, tripId, { description: "Hola", newActivity: newActivityBody }, confirmation);
      expect(create.mock.calls[2]![1]).toEqual(create.mock.calls[0]![1]);
      expect(dialog()).toBeNull();
      expect(container.querySelector('[data-testid="listing"]')?.textContent).toContain("created-activity");
    });
    it("a second 409 after confirming shows the stale notice in the same modal", async () => {
      const create = vi.fn().mockResolvedValue(conflict);
      await publish(create);
      expect(dialog()?.textContent).not.toContain("Los datos cambiaron");
      await click(button(dialog()!, "Cambiar de plan"));
      expect(create).toHaveBeenCalledTimes(2);
      expect(dialog()?.querySelector('[role="alert"]')?.textContent).toContain("Los datos cambiaron");
    });
    it.each([
      ["activity", { field: "durationMinutes", code: "outside_window" }, "Editar actividad nueva"],
      ["link", { field: "transportId", code: "not_found" }, "Vincular a"],
    ])("a 422 on the %s after confirming closes the modal and leaves the focus on the error, not on the publish button", async (_kind, item, focused) => {
      const create = vi.fn().mockResolvedValueOnce(conflict).mockResolvedValueOnce({ ok: false, error: { kind: "validation", fields: [{ ...item, message: "x" }] } });
      const { container } = await publish(create);
      await click(button(dialog()!, "Cambiar de plan"));
      expect(dialog()).toBeNull();
      expect(alerts(container)).toHaveLength(1);
      expect(document.activeElement).toBe(button(container, focused));
    });
    it("a double click on Cambiar de plan sends once", async () => {
      const pending = deferred<unknown>();
      const create = vi.fn().mockResolvedValueOnce(conflict).mockReturnValueOnce(pending.promise);
      await publish(create);
      const confirm = button(dialog()!, "Cambiar de plan")!;
      await act(async () => {
        confirm.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        confirm.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      expect(create).toHaveBeenCalledTimes(2);
      await act(async () => pending.resolve({ ok: true, value: withActivity() }));
    });
    it("a failure while confirming closes the modal, keeps the draft and shows the error without navigating", async () => {
      const create = vi.fn().mockResolvedValueOnce(conflict).mockResolvedValueOnce({ ok: false, error: { kind: "network" } });
      const { container } = await publish(create);
      await click(button(dialog()!, "Cambiar de plan"));
      expect(dialog()).toBeNull();
      expect(container.querySelector('[data-testid="listing"]')).toBeNull();
      expect(alerts(container)).toHaveLength(1);
      expect(alerts(container)[0]!.textContent).toContain("Podés reintentar: el recuerdo no se va a publicar dos veces.");
      expect(summary(container)).toBe("Actividad nueva: Cena · 25/09/2026 12:00 · 1 h 30 min");
    });
  });

  describe("errors", () => {
    const failWith = async (error: unknown, view?: { create: ReturnType<typeof vi.fn> }) => {
      const create = view?.create ?? vi.fn().mockResolvedValue({ ok: false, error });
      const rendered = await render(undefined, { create });
      await field(rendered.container, "description", "Hola"); await addActivity(rendered.container); await submit(rendered.container);
      return rendered;
    };
    it.each([
      [{ field: "scheduledAt", code: "outside_window" }, "Elegí un horario dentro de la franja de actividad del destino."],
      [{ field: "dayId", code: "ambiguous" }, "Elegí un horario dentro de la franja de actividad del destino."],
      [{ field: "durationMinutes", code: "outside_window" }, "La actividad terminaría después de la salida del destino. Acortá la duración o elegí otro horario."],
      [{ field: "durationMinutes", code: "invalid" }, "Revisá la duración estimada."],
      [{ field: "title", code: "required" }, "Ingresá un título para la actividad."],
    ])("a 422 on %j keeps the draft, shows one focused alert with an edit action and does not navigate", async (item, message) => {
      const { container, create } = await failWith({ kind: "validation", fields: [{ ...item, message: "x" }] });
      expect(create).toHaveBeenCalledTimes(1);
      expect(alerts(container)).toHaveLength(1);
      expect(alerts(container)[0]!.textContent).toBe(message);
      expect(container.querySelector('[data-testid="listing"]')).toBeNull();
      expect(document.activeElement).toBe(button(container, "Editar actividad nueva"));
      expect(summary(container)).toBe("Actividad nueva: Cena · 25/09/2026 12:00 · 1 h 30 min");
      expect(value(container, "description")).toBe("Hola");
      expect(container.textContent).not.toContain("Recuerdo publicado");
    });
    it("a 422 with several activity fields still shows a single alert", async () => {
      const { container } = await failWith({ kind: "validation", fields: [{ field: "title", code: "required", message: "x" }, { field: "durationMinutes", code: "invalid", message: "y" }] });
      expect(alerts(container)).toHaveLength(1);
    });
    it("a link error with a new activity keeps using the link message", async () => {
      const { container } = await failWith({ kind: "validation", fields: [{ field: "transportId", code: "not_found", message: "x" }] });
      expect(alerts(container).map((item) => item.textContent)).toEqual(["No pudimos aplicar el vínculo. Elegí otro."]);
    });
    it.each([["network"], ["server"]])("a %s error keeps the draft and says the retry is safe", async (kind) => {
      const { container } = await failWith({ kind });
      expect(alerts(container)).toHaveLength(1);
      expect(alerts(container)[0]!.textContent).toBe("No pudimos guardar el recuerdo. Revisá tu conexión e intentá nuevamente. Podés reintentar: el recuerdo no se va a publicar dos veces.");
      expect(summary(container)).toBe("Actividad nueva: Cena · 25/09/2026 12:00 · 1 h 30 min");
      expect(container.querySelector('[data-testid="listing"]')).toBeNull();
    });
    it("without a new activity the network message of a creation still says the retry is safe", async () => {
      const create = vi.fn().mockResolvedValue({ ok: false, error: { kind: "network" } });
      const { container } = await render(undefined, { create });
      await field(container, "description", "Hola"); await submit(container);
      expect(alerts(container)[0]!.textContent).toBe("No pudimos guardar el recuerdo. Revisá tu conexión e intentá nuevamente. Podés reintentar: el recuerdo no se va a publicar dos veces.");
    });
    it("a rejected request is treated as a network error with the suggestion", async () => {
      const { container } = await failWith(undefined, { create: vi.fn().mockRejectedValue(new Error("down")) });
      expect(alerts(container)[0]!.textContent).toContain("Podés reintentar");
    });
    it("a success response without the activity is not announced and does not navigate", async () => {
      const { container } = await failWith(undefined, { create: vi.fn().mockResolvedValue({ ok: true, value: saved() }) });
      expect(container.querySelector('[data-testid="listing"]')).toBeNull();
      expect(alerts(container)).toHaveLength(1);
      expect(summary(container)).toBe("Actividad nueva: Cena · 25/09/2026 12:00 · 1 h 30 min");
    });
    it("the composer revalidates an accepted draft against the itinerary it loads: nothing is sent, one alert, focus on the edit action and the draft stays", async () => {
      // The subform accepts the draft with the full slice; the composer then loads a shorter one (the exit moved up) and must not publish.
      const shorter = itineraryFixture(); shorter.days[1]!.endsAt = "2026-09-25T16:00:00.123Z";
      const itineraryGet = vi.fn().mockResolvedValueOnce({ ok: true, value: itineraryFixture() }).mockResolvedValue({ ok: true, value: shorter });
      const { container, create, update } = await render(undefined, { itineraryGet });
      await field(container, "description", "Hola"); await addActivity(container);
      await submit(container);
      expect(create).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
      expect(alerts(container)).toHaveLength(1);
      expect(alerts(container)[0]!.textContent).toBe("La actividad terminaría después de la salida del destino. Acortá la duración o elegí otro horario.");
      expect(document.activeElement).toBe(button(container, "Editar actividad nueva"));
      expect(summary(container)).toBe("Actividad nueva: Cena · 25/09/2026 12:00 · 1 h 30 min");
      expect(value(container, "description")).toBe("Hola");
    });
    it("the subform blocks a start outside the slice before the draft reaches the composer", async () => {
      const { container, create } = await render();
      await field(container, "description", "Hola"); await addActivity(container);
      // The draft is valid when accepted; here it is made invalid through the edit flow with the slice already known.
      await click(button(container, "Editar actividad nueva"));
      await field(container, "time", "22:00");
      await click(button(container, "Aceptar"));
      expect(alerts(container)[0]?.textContent).toBe("Elegí un horario dentro de la franja de actividad del destino.");
      expect(create).not.toHaveBeenCalled();
    });
    it("lets the server decide when the itinerary could not be loaded in the composer", async () => {
      const itineraryGet = vi.fn().mockResolvedValueOnce({ ok: true, value: itineraryFixture() }).mockResolvedValue({ ok: false, error: { kind: "network" } });
      const create = vi.fn().mockResolvedValue({ ok: true, value: withActivity() });
      const { container } = await render(undefined, { create, itineraryGet });
      await field(container, "description", "Hola"); await addActivity(container); await submit(container);
      expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { description: "Hola", newActivity: newActivityBody });
    });
  });

  describe("relink of an existing memory", () => {
    const withPost = (extra: Partial<PostResponse> = {}) => vi.fn().mockResolvedValue({ ok: true, value: { post: saved(extra), parent: null, children: [], rootActivityId: null } });
    it("sends newActivity in the PATCH, without activityId and without touching the text", async () => {
      const update = vi.fn().mockResolvedValue({ ok: true, value: withActivity() });
      const { container } = await render(editPath, { update });
      await addActivity(container); await submit(container);
      expect(update).toHaveBeenCalledExactlyOnceWith(tripId, postId, { newActivity: newActivityBody });
      expect(container.querySelector('[data-testid="listing"]')?.textContent).toContain("linked-activity");
    });
    it("sends parentPostId null when the memory was a continuation", async () => {
      const update = vi.fn().mockResolvedValue({ ok: true, value: withActivity() });
      const { container } = await render(editPath, { update, get: withPost({ parentPostId: otherPostId }) });
      await addActivity(container); await submit(container);
      expect(update).toHaveBeenCalledExactlyOnceWith(tripId, postId, { parentPostId: null, newActivity: newActivityBody });
    });
    it("tells that it replaces the current activity without deleting it, and never sends activityId", async () => {
      const update = vi.fn().mockResolvedValue({ ok: true, value: withActivity() });
      const { container } = await render(editPath, { update, get: withPost({ activityId }) });
      expect(container.textContent).not.toContain("Reemplaza el vínculo con la actividad actual");
      await addActivity(container);
      expect(container.textContent).toContain("Reemplaza el vínculo con la actividad actual");
      await submit(container);
      expect(update).toHaveBeenCalledExactlyOnceWith(tripId, postId, { newActivity: newActivityBody });
    });
    it("relinks a memory without text or location (existing rule) and confirms conflicts", async () => {
      const update = vi.fn().mockResolvedValueOnce(conflict).mockResolvedValueOnce({ ok: true, value: withActivity({ description: null }) });
      const { container } = await render(editPath, { update, get: withPost({ description: null, mapsUrl: null }) });
      await addActivity(container); await submit(container);
      expect(dialog()?.textContent).toContain("Paseo por el centro");
      await click(button(dialog()!, "Cambiar de plan"));
      expect(update).toHaveBeenNthCalledWith(2, tripId, postId, { newActivity: newActivityBody }, confirmation);
    });
    it("Cancel in the modal keeps the edit draft and the memory in place", async () => {
      const update = vi.fn().mockResolvedValue(conflict);
      const { container } = await render(editPath, { update });
      await addActivity(container); await submit(container);
      await click(button(dialog()!, "Conservar mi participación actual"));
      expect(update).toHaveBeenCalledTimes(1); expect(container.querySelector('[data-testid="listing"]')).toBeNull();
      expect(summary(container)).toBe("Actividad nueva: Cena · 25/09/2026 12:00 · 1 h 30 min");
    });
  });
});

describe("PostComposer (continuation from a memory detail)", () => {
  const detailPath = `/trips/${tripId}/memories/${otherPostId}`;
  const entry = (extra: { search?: string; state?: unknown } = {}) => ({ pathname: newPath, search: extra.search ?? `?parentPostId=${otherPostId}`,
    state: "state" in extra ? extra.state : { origin: { path: detailPath, label: "recuerdo" }, parentLabel: "Otro recuerdo" } });
  const stateOf = (container: HTMLElement, testid: string) => container.querySelector(`[data-testid="${testid}"]`)?.textContent ?? "";

  it("preloads the parent as the link with the label sent by the detail", async () => {
    const { container } = await render(entry());
    expect(summary(container)).toBe("Recuerdo: Otro recuerdo");
    expect(container.textContent).not.toContain("Vinculado a un transporte");
  });
  it("shows a neutral label when the detail sent none", async () => {
    const { container } = await render(entry({ state: { origin: { path: detailPath, label: "recuerdo" } } }));
    expect(summary(container)).toBe("Recuerdo: recuerdo seleccionado");
  });
  it("does not count the preloaded parent as a change", async () => {
    const { container } = await render(entry({ state: undefined }));
    await click(button(container, "Cancelar"));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[data-testid="listing"]')).not.toBeNull();
  });
  it("publishes with only parentPostId and returns to the diary with the notice", async () => {
    const { container, create } = await render(entry());
    await field(container, "description", "Y después"); await submit(container);
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { description: "Y después", parentPostId: otherPostId });
    expect(stateOf(container, "listing")).toContain('"notice":"created"');
    expect(container.querySelector('[data-testid="detail"]')).toBeNull();
  });
  it("lets the parent win over a transport in the same URL", async () => {
    const { container, create } = await render(entry({ search: `?parentPostId=${otherPostId}&transportId=${transportId}` }));
    expect(container.textContent).not.toContain("Vinculado a un transporte");
    expect(summary(container)).toBe("Recuerdo: Otro recuerdo");
    await field(container, "description", "Hola"); await submit(container);
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { description: "Hola", parentPostId: otherPostId });
  });
  it("ignores an invalid parentPostId", async () => {
    const { container, create } = await render(entry({ search: "?parentPostId=nope" }));
    expect(summary(container)).toBe("Sin vínculo");
    await field(container, "description", "Hola"); await submit(container);
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { description: "Hola" });
  });
  it("ignores parentPostId when editing", async () => {
    const { container, update } = await render({ pathname: editPath, search: `?parentPostId=${otherPostId}` });
    expect(summary(container)).toBe("Sin vínculo");
    await field(container, "description", "Editado"); await submit(container);
    expect(update).toHaveBeenCalledExactlyOnceWith(tripId, postId, { description: "Editado" });
  });
  it("keeps the parent after going to the selector and coming back", async () => {
    const { container, create } = await render(entry());
    await click(linkButton(container));
    expect(container.querySelector('[role="radiogroup"][aria-label="Vincular a"]')).not.toBeNull();
    await click(button(container, "Cancelar"));
    expect(summary(container)).toBe("Recuerdo: Otro recuerdo");
    await field(container, "description", "Hola"); await submit(container);
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { description: "Hola", parentPostId: otherPostId });
  });
  it("respects the decision of removing the parent in the selector after coming back", async () => {
    const { container, create } = await render(entry());
    await click(linkButton(container));
    await click(radio(container, "Sin vínculo")); await click(button(container, "Aceptar"));
    expect(summary(container)).toBe("Sin vínculo");
    await field(container, "description", "Hola"); await submit(container);
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { description: "Hola" });
  });
  it("cancels back to the origin detail when it is valid", async () => {
    const { container } = await render(entry());
    await click(button(container, "Cancelar"));
    expect(stateOf(container, "detail")).toContain(detailPath);
    expect(container.querySelector('[data-testid="listing"]')).toBeNull();
  });
  it("discards back to the origin detail after confirming", async () => {
    const { container } = await render(entry());
    await field(container, "description", "Borrador"); await click(button(container, "Cancelar"));
    await click(button(container.querySelector('[role="dialog"]') as HTMLElement, "Descartar"));
    expect(stateOf(container, "detail")).toContain(detailPath);
  });
  describe("with drafts left by other creations", () => {
    const parentB = itineraryId(34);
    const entryFor = (id: string, label: string) => ({ pathname: newPath, search: `?parentPostId=${id}`, state: { origin: { path: `/trips/${tripId}/memories/${id}`, label: "recuerdo" }, parentLabel: label } });
    const detailOf = (id: string) => `/trips/${tripId}/memories/${id}`;
    it("gives each continuation its own draft: a leftover draft of A does not override B", async () => {
      const { container, create } = await render([entryFor(parentB, "Recuerdo B"), detailOf(parentB), entryFor(otherPostId, "Otro recuerdo")]);
      await field(container, "description", "texto de A");
      await click(button(document.body, "atras")); await click(button(document.body, "atras"));
      expect(summary(container)).toBe("Recuerdo: Recuerdo B");
      expect(value(container, "description")).toBe("");
      await field(container, "description", "texto de B"); await submit(container);
      expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { description: "texto de B", parentPostId: parentB });
    });
    it("keeps the draft of A in its own key when coming back to it", async () => {
      const { container } = await render([entryFor(parentB, "Recuerdo B"), detailOf(parentB), entryFor(otherPostId, "Otro recuerdo")]);
      await field(container, "description", "texto de A");
      await click(button(document.body, "atras")); await click(button(document.body, "atras"));
      await click(button(document.body, "adelante")); await click(button(document.body, "adelante"));
      expect(summary(container)).toBe("Recuerdo: Otro recuerdo");
      expect(value(container, "description")).toBe("texto de A");
    });
    it("a leftover linkless draft does not drop the parent of a continuation", async () => {
      const { container, create } = await render([entryFor(parentB, "Recuerdo B"), detailOf(parentB), newPath]);
      await field(container, "description", "genérico");
      await click(button(document.body, "atras")); await click(button(document.body, "atras"));
      expect(summary(container)).toBe("Recuerdo: Recuerdo B");
      await field(container, "description", "continuación"); await submit(container);
      expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { description: "continuación", parentPostId: parentB });
    });
  });
  it.each([["another trip", `/trips/${otherTripId}/memories/${otherPostId}`], ["an external url", "https://evil.test/x"], ["a protocol-relative url", "//evil.test/x"]])(
    "cancels to the diary when the origin points to %s", async (_name, path) => {
      const { container } = await render(entry({ state: { origin: { path, label: "recuerdo" }, parentLabel: "x" } }));
      await click(button(container, "Cancelar"));
      expect(container.querySelector('[data-testid="listing"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="detail"]')).toBeNull();
    });
});

describe("PostComposer (share a memory of a transport)", () => {
  const itineraryPath = `/trips/${tripId}/itinerary`;
  const itinerarySearch = `?transport=${transportId}&tab=photos`;
  const origin = { path: itineraryPath, search: itinerarySearch, label: "transporte" };
  const entry = (state: unknown = { origin }) => ({ pathname: newPath, search: `?transportId=${transportId}`, state });
  const itineraryEntry = { pathname: itineraryPath, search: itinerarySearch };
  const origins = (container: HTMLElement) => container.querySelector('[data-testid="activity-origin"]')?.textContent ?? "";

  it("preloads the transport without a third link selector and publishes only the transportId", async () => {
    const { container, create } = await render([itineraryEntry, entry()]);
    expect(container.textContent).toContain("Vinculado a un transporte");
    expect(Array.from(container.querySelectorAll("button")).filter((item) => item.textContent === "Vincular a")).toHaveLength(1);
    await field(container, "description", "En el micro"); await submit(container);
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { description: "En el micro", transportId });
  });
  it("Cancelar with history steps back one entry to the transport dialog URL", async () => {
    const { container } = await render([itineraryEntry, entry()]);
    await click(button(container, "Cancelar"));
    expect(origins(container)).toContain(`${itineraryPath}${itinerarySearch}`);
    await click(button(document.body, "adelante"));
    expect(container.querySelector('[name="description"]')).not.toBeNull();
  });
  it("Cancelar without history replaces the entry with the dialog URL and marks that nothing is behind", async () => {
    const { container } = await render([entry()]);
    await click(button(container, "Cancelar"));
    expect(origins(container)).toContain(`${itineraryPath}${itinerarySearch}`);
    expect(origins(container)).toContain('"noBack":true');
    await click(button(document.body, "adelante"));
    expect(container.querySelector('[name="description"]')).toBeNull();
  });
  it.each([
    ["a malformed origin", { origin: { path: itineraryPath, search: "?transport=1#x", label: "transporte" } }],
    ["another trip", { origin: { path: `/trips/${otherTripId}/itinerary`, search: itinerarySearch, label: "transporte" } }],
    ["an invented label", { origin: { path: itineraryPath, search: itinerarySearch, label: "transportes" } }],
    ["no origin", null],
  ])("goes to the diary with %s", async (_name, state) => {
    const { container } = await render(entry(state));
    await click(button(container, "Cancelar"));
    expect(container.querySelector('[data-testid="listing"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="activity-origin"]')).toBeNull();
  });
});

describe("PostComposer (share a memory of an activity)", () => {
  const itineraryPath = `/trips/${tripId}/itinerary`;
  const itinerarySearch = `?activity=${activityId}&tab=photos`;
  const origin = { path: itineraryPath, search: itinerarySearch, label: "actividad" };
  const entry = (extra: { search?: string; state?: unknown } = {}) => ({ pathname: newPath, search: extra.search ?? `?activityId=${activityId}`,
    state: "state" in extra ? extra.state : { origin, activityLabel: "Paseo por el centro" } });
  const itineraryEntry = { pathname: itineraryPath, search: itinerarySearch };
  const origins = (container: HTMLElement) => container.querySelector('[data-testid="activity-origin"]')?.textContent ?? "";
  const forward = async () => click(button(document.body, "adelante"));
  const flushBack = () => act(async () => { gate.back.splice(0).forEach((run) => run()); });

  it("preloads the activity as the link with the label sent by the activity dialog", async () => {
    const { container } = await render(entry());
    expect(summary(container)).toBe("Actividad: Paseo por el centro");
    expect(container.textContent).not.toContain("Vinculado a un transporte");
  });
  it("shows a neutral label when no label was sent", async () => {
    const { container } = await render(entry({ state: { origin } }));
    expect(summary(container)).toBe("Actividad: actividad seleccionada");
  });
  it("does not count the preloaded activity as a change: cancelling asks nothing", async () => {
    const { container } = await render([itineraryEntry, entry()]);
    await click(button(container, "Cancelar"));
    expect(dialog()).toBeNull();
    expect(origins(container)).toContain(`${itineraryPath}${itinerarySearch}`);
  });
  it("publishes with the activityId only and still goes to the diary with the notice", async () => {
    const { container, create } = await render([itineraryEntry, entry()]);
    await field(container, "description", "Qué lindo"); await submit(container);
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { description: "Qué lindo", activityId });
    expect(container.querySelector('[data-testid="listing"]')?.textContent).toContain('"notice":"created"');
    expect(container.querySelector('[data-testid="activity-origin"]')).toBeNull();
  });
  it("ignores ?activityId= when editing", async () => {
    const { container, update } = await render({ pathname: editPath, search: `?activityId=${activityId}` });
    expect(summary(container)).toBe("Sin vínculo");
    await field(container, "description", "Editado"); await submit(container);
    expect(update).toHaveBeenCalledExactlyOnceWith(tripId, postId, { description: "Editado" });
  });
  it("discards an invalid activityId", async () => {
    const { container, create } = await render(entry({ search: "?activityId=nope" }));
    expect(summary(container)).toBe("Sin vínculo");
    await field(container, "description", "Hola"); await submit(container);
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { description: "Hola" });
  });
  it("the parent wins over the activity", async () => {
    const { container, create } = await render(entry({ search: `?parentPostId=${otherPostId}&activityId=${activityId}`, state: { origin, parentLabel: "Otro recuerdo" } }));
    expect(summary(container)).toBe("Recuerdo: Otro recuerdo");
    await field(container, "description", "Hola"); await submit(container);
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { description: "Hola", parentPostId: otherPostId });
  });
  it("the activity wins over a transport: no transport is shown nor sent", async () => {
    const { container, create } = await render(entry({ search: `?activityId=${activityId}&transportId=${transportId}` }));
    expect(container.textContent).not.toContain("Vinculado a un transporte");
    expect(summary(container)).toBe("Actividad: Paseo por el centro");
    await field(container, "description", "Hola"); await submit(container);
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { description: "Hola", activityId });
  });
  it("a 422 on the activityId (it no longer exists) shows the existing link message once and keeps the draft", async () => {
    const create = vi.fn().mockResolvedValue({ ok: false, error: { kind: "validation", fields: [{ field: "activityId", code: "not_found", message: "x" }] } });
    const { container } = await render(entry(), { create });
    await field(container, "description", "Hola"); await submit(container);
    expect(alerts(container).map((item) => item.textContent)).toEqual(["No pudimos aplicar el vínculo. Elegí otro."]);
    expect(value(container, "description")).toBe("Hola");
  });
  it("«Vincular a» opens with Actividad preselected and «Crear actividad espontánea» enabled", async () => {
    const { container } = await render(entry());
    await click(linkButton(container));
    expect(radio(container, "Actividad")!.checked).toBe(true);
    expect(radio(container, "Sin vínculo")!.checked).toBe(false);
    expect(button(container, "Crear actividad espontánea")).toBeDefined();
    expect(button(container, "Crear actividad espontánea")!.disabled).toBe(false);
  });
  it("a spontaneous activity created from there is sent as newActivity without the activityId", async () => {
    const create = vi.fn().mockResolvedValue({ ok: true, value: withActivity() });
    const { container } = await render(entry(), { create });
    await field(container, "description", "Hola");
    await addActivity(container);
    expect(summary(container)).toBe("Actividad nueva: Cena · 25/09/2026 12:00 · 1 h 30 min");
    await submit(container);
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { description: "Hola", newActivity: newActivityBody });
  });
  it("Quitar actividad nueva after that leaves «Sin vínculo», not the preloaded activity", async () => {
    const { container, create } = await render(entry());
    await field(container, "description", "Hola");
    await addActivity(container);
    await click(button(container, "Quitar actividad nueva"));
    expect(summary(container)).toBe("Sin vínculo");
    await submit(container);
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { description: "Hola" });
  });
  it("keeps the preloaded activity after going to the selector and cancelling", async () => {
    const { container, create } = await render(entry());
    await click(linkButton(container)); await click(button(container, "Cancelar"));
    expect(summary(container)).toBe("Actividad: Paseo por el centro");
    await field(container, "description", "Hola"); await submit(container);
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { description: "Hola", activityId });
  });

  describe("leaving", () => {
    it("Cancelar with history steps back exactly one entry (to the dialog URL), not a replace", async () => {
      const { container } = await render([itineraryEntry, entry()]);
      await click(button(container, "Cancelar"));
      expect(origins(container)).toContain(`${itineraryPath}${itinerarySearch}`);
      await forward();
      expect(container.querySelector('[name="description"]')).not.toBeNull(); // the composer entry was still ahead: it was a step back
    });
    it("Cancelar without history replaces the entry with the dialog URL and marks that nothing is behind", async () => {
      const { container } = await render([entry()]);
      await click(button(container, "Cancelar"));
      expect(origins(container)).toContain(`${itineraryPath}${itinerarySearch}`);
      expect(origins(container)).toContain('"noBack":true');
      await forward();
      expect(container.querySelector('[name="description"]')).toBeNull(); // nothing was ahead: it was a replace
    });
    it("Descartar after confirming goes back with -1 when there is history", async () => {
      const { container } = await render([itineraryEntry, entry()]);
      await field(container, "description", "Borrador"); await click(button(container, "Cancelar"));
      await click(button(dialog()!, "Descartar"));
      expect(origins(container)).toContain(`${itineraryPath}${itinerarySearch}`);
      await forward();
      expect(container.querySelector('[name="description"]')).not.toBeNull();
    });
    it("Descartar without history replaces with the dialog URL", async () => {
      const { container } = await render([entry()]);
      await field(container, "description", "Borrador"); await click(button(container, "Cancelar"));
      await click(button(dialog()!, "Descartar"));
      expect(origins(container)).toContain(`${itineraryPath}${itinerarySearch}`);
      expect(origins(container)).toContain('"noBack":true');
    });
    it("a double Cancelar while the step back is still pending steps back only once", async () => {
      const { container } = await render([itineraryEntry, entry()]);
      gate.defer = true;
      await act(async () => { const cancel = button(container, "Cancelar")!; cancel.click(); cancel.click(); });
      expect(gate.back).toHaveLength(1);
      await flushBack();
      expect(origins(container)).toContain(`${itineraryPath}${itinerarySearch}`);
    });
    it("a double Descartar while the step back is still pending steps back only once", async () => {
      const { container } = await render([itineraryEntry, entry()]);
      await field(container, "description", "Borrador"); await click(button(container, "Cancelar"));
      gate.defer = true;
      await act(async () => { const discard = button(dialog()!, "Descartar")!; discard.click(); discard.click(); });
      expect(gate.back).toHaveLength(1);
      await flushBack();
      expect(origins(container)).toContain(`${itineraryPath}${itinerarySearch}`);
    });
    it("without an origin it goes to the diary", async () => {
      const { container } = await render(entry({ state: undefined }));
      await click(button(container, "Cancelar"));
      expect(container.querySelector('[data-testid="listing"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="activity-origin"]')).toBeNull();
    });
    it("an origin pointing to another trip goes to the diary", async () => {
      const { container } = await render(entry({ state: { origin: { path: `/trips/${otherTripId}/itinerary`, search: itinerarySearch, label: "actividad" } } }));
      await click(button(container, "Cancelar"));
      expect(container.querySelector('[data-testid="listing"]')).not.toBeNull();
    });
  });

  describe("drafts", () => {
    const genericEntry = { pathname: newPath, search: "" };
    it("keeps the draft of the shared activity apart from the generic one", async () => {
      const { container } = await render([genericEntry, entry()]);
      await field(container, "description", "texto de la actividad");
      await click(button(document.body, "atras"));
      expect(value(container, "description")).toBe("");
      expect(summary(container)).toBe("Sin vínculo");
      await field(container, "description", "texto genérico");
      await forward();
      expect(value(container, "description")).toBe("texto de la actividad");
      expect(summary(container)).toBe("Actividad: Paseo por el centro");
    });
    it("gives each activity its own draft", async () => {
      const other = itineraryId(41);
      const { container } = await render([entry({ search: `?activityId=${other}`, state: { origin, activityLabel: "Otra" } }), entry()]);
      await field(container, "description", "texto de A");
      await click(button(document.body, "atras"));
      expect(value(container, "description")).toBe("");
      expect(summary(container)).toBe("Actividad: Otra");
    });
  });
});
