// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PostComposer } from "./PostComposer.js";
import { MemoriesLayout } from "./TripMemoriesScreen.js";
import { itineraryId } from "./itinerary-test-fixture.js";
import type { PostResponse } from "./trip-post-api.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
const tripId = itineraryId(1), otherTripId = itineraryId(2), postId = itineraryId(30);
const saved = (extra: Partial<PostResponse> = {}): PostResponse => ({ id: postId, tripId, authorId: itineraryId(20), description: "Atardecer", mapsUrl: null,
  activityId: null, parentPostId: null, transportId: null, createdAt: "2026-01-02T15:30:00.000Z", ...extra });
function Listing() { const location = useLocation(); return <p data-testid="listing">LISTADO {JSON.stringify(location.state)}</p>; }
async function render(path = `/trips/${tripId}/memories/new`, overrides: Partial<Record<"create" | "update" | "get", ReturnType<typeof vi.fn>>> = {}) {
  const create = overrides.create ?? vi.fn().mockResolvedValue({ ok: true, value: saved() });
  const update = overrides.update ?? vi.fn().mockResolvedValue({ ok: true, value: saved({ description: "Editado" }) });
  const get = overrides.get ?? vi.fn().mockResolvedValue({ ok: true, value: { post: saved(), parent: null, children: [], rootActivityId: null } });
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}>
    <nav><Link to={`/trips/${tripId}/memories/new`}>nav-new</Link><Link to={`/trips/${tripId}/memories/${postId}/edit`}>nav-edit</Link><Link to={`/trips/${otherTripId}/memories/new`}>nav-other</Link></nav><Routes>
    <Route path="/trips/:tripId/memories" element={<MemoriesLayout />}>
      <Route index element={<Listing />} />
      <Route path="new" element={<PostComposer posts={{ create, update, get }} timeZone="America/Argentina/Buenos_Aires" />} />
      <Route path=":postId/edit" element={<PostComposer posts={{ create, update, get }} timeZone="America/Argentina/Buenos_Aires" />} />
    </Route>
    <Route path="/login" element={<p>LOGIN</p>} />
  </Routes></MemoryRouter>));
  return { container, create, update, get };
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
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Escribí un texto o agregá una ubicación.");
    const input = container.querySelector('[name="description"]') as HTMLTextAreaElement;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(input.getAttribute("aria-describedby")!)?.textContent).toContain("Escribí un texto o agregá una ubicación.");
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
    const { container, create, get } = await render();
    await field(container, "description", "Sin itinerario"); await submit(container);
    expect(create).toHaveBeenCalledTimes(1); expect(get).not.toHaveBeenCalled();
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
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Escribí un texto o agregá una ubicación.");
    const input = container.querySelector('[name="description"]') as HTMLTextAreaElement;
    expect(document.getElementById(input.getAttribute("aria-describedby")!)?.textContent).toContain("Escribí un texto");
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
