// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.js";
import { itineraryFixture, itineraryId } from "./trips/itinerary-test-fixture.js";
import type { PostResponse } from "./trips/trip-post-api.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); vi.unstubAllGlobals(); });
const storage = (hasSession: boolean) => ({ read: vi.fn().mockResolvedValue(hasSession ? { accessToken: "old", refreshToken: "refresh" } : null),
  save: vi.fn().mockResolvedValue(undefined), clear: vi.fn().mockResolvedValue(undefined) });
const auth = { refresh: vi.fn().mockResolvedValue({ ok: true, value: { accessToken: "access", refreshToken: "refresh" } }) };
const tripId = itineraryId(1), postId = itineraryId(30);
const saved = (extra: Partial<PostResponse> = {}): PostResponse => ({ id: postId, tripId, authorId: itineraryId(20), description: "Atardecer", mapsUrl: null,
  activityId: null, parentPostId: null, transportId: null, createdAt: "2026-01-02T15:30:00.000Z", ...extra });
async function render(path: string, props: ComponentProps<typeof App>) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><App {...props} /></MemoryRouter>));
  return container;
}
async function type(container: HTMLElement, name: string, value: string) {
  const element = container.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLTextAreaElement;
  const proto = element.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); });
}
const submit = async (container: HTMLElement) => act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
const click = async (element: Element | null) => { expect(element).not.toBeNull(); await act(async () => element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))); };

describe("App memories integration", () => {
  it("opens the composer with a session without needing an itinerary", async () => {
    const get = vi.fn();
    const container = await render(`/trips/${tripId}/memories/new`, { auth, sessionStorage: storage(true), itinerary: { get }, posts: {} });
    expect(container.textContent).toContain("Nuevo recuerdo");
    expect(container.querySelector('[name="description"]')).not.toBeNull();
    expect(get).not.toHaveBeenCalled();
  });
  it("redirects to login without a session and requests nothing", async () => {
    const list = vi.fn(), create = vi.fn();
    const container = await render(`/trips/${tripId}/memories/new`, { auth: {}, sessionStorage: storage(false), posts: { list, create } });
    expect(container.textContent).toContain("Iniciar sesión");
    expect(container.querySelector('[name="description"]')).toBeNull();
    expect(list).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  });
  it("creates a memory and returns to the list showing it", async () => {
    const create = vi.fn().mockResolvedValue({ ok: true, value: saved() });
    const list = vi.fn().mockResolvedValue({ ok: true, value: [saved()] });
    const container = await render(`/trips/${tripId}/memories/new`, { auth, sessionStorage: storage(true), posts: { create, list } });
    await type(container, "description", "Atardecer"); await submit(container);
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { description: "Atardecer" });
    expect(container.querySelector("h1")?.textContent).toBe("Recuerdos");
    expect(container.textContent).toContain("Recuerdo publicado.");
    expect(container.textContent).toContain("Atardecer");
  });
  it("lists the memories and opens the edit route from the list", async () => {
    const list = vi.fn().mockResolvedValue({ ok: true, value: [saved()] });
    const get = vi.fn().mockResolvedValue({ ok: true, value: { post: saved(), parent: null, children: [], rootActivityId: null } });
    const container = await render(`/trips/${tripId}/memories`, { auth, sessionStorage: storage(true), posts: { list, get } });
    await click(container.querySelector(`a[href="/trips/${tripId}/memories/${postId}/edit"]`));
    expect(get).toHaveBeenCalledExactlyOnceWith(tripId, postId);
    expect(container.querySelector('[name="description"]')).not.toBeNull();
  });
  it("edits keeping the server publication date unchanged after the PATCH", async () => {
    const update = vi.fn().mockResolvedValue({ ok: true, value: saved({ description: "Editado" }) });
    const get = vi.fn().mockResolvedValue({ ok: true, value: { post: saved(), parent: null, children: [], rootActivityId: null } });
    const list = vi.fn().mockResolvedValue({ ok: true, value: [saved({ description: "Editado" })] });
    const container = await render(`/trips/${tripId}/memories/${postId}/edit`, { auth, sessionStorage: storage(true), posts: { update, get, list } });
    const before = container.querySelector("time")?.getAttribute("datetime");
    expect(before).toBe("2026-01-02T15:30:00.000Z");
    await type(container, "description", "Editado"); await submit(container);
    expect(update).toHaveBeenCalledExactlyOnceWith(tripId, postId, { description: "Editado" });
    expect(container.textContent).toContain("Cambios guardados.");
    expect(container.querySelector("li time")?.getAttribute("datetime")).toBe(before);
  });
  it("sends the real HTTP request without createdAt or dayId and with the renewed token", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ accessToken: "renewed", refreshToken: "renewed-refresh" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ post: saved() }), { status: 201 }))
      .mockResolvedValue(new Response(JSON.stringify({ posts: [saved()] })));
    vi.stubGlobal("fetch", fetch);
    const container = await render(`/trips/${tripId}/memories/new`, { apiBaseUrl: "https://api.example.test", sessionStorage: storage(true) });
    await type(container, "description", "Atardecer"); await submit(container);
    const call = fetch.mock.calls[1]!;
    expect(call[0]).toBe(`https://api.example.test/trips/${tripId}/posts`);
    expect(call[1]).toEqual(expect.objectContaining({ method: "POST", headers: expect.objectContaining({ Authorization: "Bearer renewed" }) }));
    expect(JSON.parse(call[1].body as string)).toEqual({ description: "Atardecer" });
  });
});

describe("App memories link routes", () => {
  const activityId = itineraryId(40), transportId = itineraryId(50);
  const buttonOf = (container: HTMLElement, label: string) => Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.trim() === label) ?? null;
  const radioOf = (container: HTMLElement, label: string) => Array.from(container.querySelectorAll("label")).find((item) => item.textContent?.trim().startsWith(label))?.querySelector("input") ?? null;
  const itinerary = () => ({ get: vi.fn().mockResolvedValue({ ok: true, value: { activities: [{ id: activityId, title: "Paseo por el centro", scheduledAt: "2026-09-25T15:00:00.000Z" }] } }) });
  it("renders the selector in the new route with the injected itinerary and links an activity", async () => {
    const create = vi.fn().mockResolvedValue({ ok: true, value: saved() });
    const list = vi.fn().mockResolvedValue({ ok: true, value: [] });
    const api = itinerary();
    const container = await render(`/trips/${tripId}/memories/new`, { auth, sessionStorage: storage(true), itinerary: api, posts: { create, list } });
    await type(container, "description", "Con actividad");
    await click(buttonOf(container, "Vincular a"));
    expect(container.querySelector("h1")?.textContent).toBe("Vincular recuerdo");
    await click(radioOf(container, "Actividad"));
    expect(api.get).toHaveBeenCalledExactlyOnceWith(tripId);
    await click(radioOf(container, "Paseo por el centro")); await click(buttonOf(container, "Aceptar"));
    expect((container.querySelector('[name="description"]') as HTMLTextAreaElement).value).toBe("Con actividad");
    await submit(container);
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { description: "Con actividad", activityId });
  });
  it("renders the selector in the edit route and lists the other memories", async () => {
    const otherId = itineraryId(33);
    const list = vi.fn().mockResolvedValue({ ok: true, value: [saved(), saved({ id: otherId, description: "Otro" })] });
    const get = vi.fn().mockResolvedValue({ ok: true, value: { post: saved(), parent: null, children: [], rootActivityId: null } });
    const container = await render(`/trips/${tripId}/memories/${postId}/edit`, { auth, sessionStorage: storage(true), itinerary: itinerary(), posts: { list, get } });
    await click(buttonOf(container, "Vincular a"));
    await click(radioOf(container, "Post"));
    expect(list).toHaveBeenCalledExactlyOnceWith(tripId);
    expect(radioOf(container, "Otro")).not.toBeNull(); expect(radioOf(container, "Atardecer")).toBeNull();
  });
  it("passes ?transportId= from the route to the composer", async () => {
    const create = vi.fn().mockResolvedValue({ ok: true, value: saved() });
    const container = await render(`/trips/${tripId}/memories/new?transportId=${transportId}`, { auth, sessionStorage: storage(true), posts: { create } });
    expect(container.textContent).toContain("Vinculado a un transporte");
    await type(container, "description", "En camino"); await submit(container);
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { description: "En camino", transportId });
  });
  it("without a session the selector route redirects to login and requests nothing", async () => {
    const list = vi.fn(), api = itinerary();
    const container = await render(`/trips/${tripId}/memories/new/link`, { auth: {}, sessionStorage: storage(false), itinerary: api, posts: { list } });
    expect(container.textContent).toContain("Iniciar sesión");
    expect(list).not.toHaveBeenCalled(); expect(api.get).not.toHaveBeenCalled();
  });
});

describe("App memories new activity routes", () => {
  // La app usa la zona del dispositivo: se fija para que el test no dependa de la zona del equipo ni de CI.
  const zone = "America/Argentina/Buenos_Aires";
  beforeEach(() => {
    const original = Intl.DateTimeFormat.prototype.resolvedOptions;
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(function (this: Intl.DateTimeFormat) { return { ...original.call(this), timeZone: zone }; });
  });
  afterEach(() => { vi.restoreAllMocks(); });
  const scheduledAt = "2026-09-25T15:00:00.000Z";
  const activity = { id: itineraryId(60), tripId, dayId: itineraryId(4), title: "Cena", description: null, mapsUrl: null, scheduledAt, durationMinutes: 90,
    createdAt: "2026-09-25T10:00:00.123Z", createdBy: itineraryId(20) };
  const participation = { id: itineraryId(61), tripId, activityId: activity.id, userId: itineraryId(20), status: "going", updatedAt: "2026-09-25T12:00:00.123Z" };
  const buttonOf = (container: HTMLElement, label: string) => Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.trim() === label) ?? null;
  const radioOf = (container: HTMLElement, label: string) => Array.from(container.querySelectorAll("label")).find((item) => item.textContent?.trim().startsWith(label))?.querySelector("input") ?? null;
  const itinerary = () => ({ get: vi.fn().mockResolvedValue({ ok: true, value: itineraryFixture() }) });
  async function createActivity(container: HTMLElement) {
    await click(buttonOf(container, "Vincular a")); await click(radioOf(container, "Actividad")); await click(buttonOf(container, "Crear actividad espontánea"));
    expect(container.querySelector("h1")?.textContent).toBe("Crear actividad espontánea");
    await type(container, "title", "Cena"); await type(container, "date", "2026-09-25"); await type(container, "time", "12:00");
    await type(container, "durationHours", "1"); await type(container, "durationMinutes", "30");
    await click(buttonOf(container, "Aceptar"));
  }
  it("creates a memory with a new activity through the routes: one create call, the draft survives the subform", async () => {
    const create = vi.fn().mockResolvedValue({ ok: true, value: { ...saved(), activity, participation } });
    const list = vi.fn().mockResolvedValue({ ok: true, value: [saved()] });
    const api = itinerary();
    const container = await render(`/trips/${tripId}/memories/new`, { auth, sessionStorage: storage(true), itinerary: api, posts: { create, list } });
    await type(container, "description", "Atardecer");
    await createActivity(container);
    expect(container.querySelector("h1")?.textContent).toBe("Nuevo recuerdo");
    expect((container.querySelector('[name="description"]') as HTMLTextAreaElement).value).toBe("Atardecer");
    expect(container.querySelector("#post-link-summary")?.textContent).toBe("Actividad nueva: Cena · 25/09/2026 12:00 · 1 h 30 min");
    await submit(container);
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { description: "Atardecer", newActivity: { title: "Cena", scheduledAt, durationMinutes: 90 } });
    expect(container.querySelector("h1")?.textContent).toBe("Recuerdos");
    expect(container.textContent).toContain("Recuerdo publicado y actividad creada. Vas a ir.");
  });
  it("relinks an existing memory to a new activity through the edit routes", async () => {
    const update = vi.fn().mockResolvedValue({ ok: true, value: { ...saved(), activity, participation } });
    const get = vi.fn().mockResolvedValue({ ok: true, value: { post: saved(), parent: null, children: [], rootActivityId: null } });
    const list = vi.fn().mockResolvedValue({ ok: true, value: [saved()] });
    const container = await render(`/trips/${tripId}/memories/${postId}/edit`, { auth, sessionStorage: storage(true), itinerary: itinerary(), posts: { update, get, list } });
    await createActivity(container);
    expect(container.querySelector("h1")?.textContent).toBe("Editar recuerdo");
    await submit(container);
    expect(update).toHaveBeenCalledExactlyOnceWith(tripId, postId, { newActivity: { title: "Cena", scheduledAt, durationMinutes: 90 } });
    expect(container.textContent).toContain("Cambios guardados y actividad creada. Vas a ir.");
  });
  it("opened by URL without a draft the subform routes go back to the composer", async () => {
    const container = await render(`/trips/${tripId}/memories/new/activity`, { auth, sessionStorage: storage(true), itinerary: itinerary(), posts: {} });
    expect(container.querySelector("h1")?.textContent).toBe("Nuevo recuerdo");
    const edit = await render(`/trips/${tripId}/memories/${postId}/edit/activity`, { auth, sessionStorage: storage(true), itinerary: itinerary(), posts: { get: vi.fn().mockResolvedValue({ ok: true, value: { post: saved(), parent: null, children: [], rootActivityId: null } }) } });
    expect(edit.querySelector("h1")?.textContent).toBe("Editar recuerdo");
  });
  it("without a session the subform route redirects to login and requests nothing", async () => {
    const api = itinerary();
    const container = await render(`/trips/${tripId}/memories/new/activity`, { auth: {}, sessionStorage: storage(false), itinerary: api, posts: {} });
    expect(container.textContent).toContain("Iniciar sesión");
    expect(api.get).not.toHaveBeenCalled();
  });
});

describe("App memories detail route", () => {
  beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); window.scrollTo = vi.fn() as unknown as typeof window.scrollTo; });
  const detail = (extra: Record<string, unknown> = {}) => ({ post: saved(), parent: null, children: [], rootActivityId: null, ...extra });
  it("renders the detail with a session and requests only that post", async () => {
    const get = vi.fn().mockResolvedValue({ ok: true, value: detail() }), list = vi.fn();
    const container = await render(`/trips/${tripId}/memories/${postId}`, { auth, sessionStorage: storage(true), posts: { get, list } });
    expect(container.querySelector("h1")?.textContent).toBe("Recuerdo");
    expect(container.textContent).toContain("Atardecer");
    expect(get).toHaveBeenCalledExactlyOnceWith(tripId, postId);
    expect(list).not.toHaveBeenCalled();
  });
  it("redirects to login without a session and requests nothing", async () => {
    const get = vi.fn(), list = vi.fn();
    const container = await render(`/trips/${tripId}/memories/${postId}`, { auth: {}, sessionStorage: storage(false), posts: { get, list } });
    expect(container.textContent).toContain("Iniciar sesión");
    expect(container.querySelector("h1")?.textContent).not.toBe("Recuerdo");
    expect(get).not.toHaveBeenCalled(); expect(list).not.toHaveBeenCalled();
  });
  it("keeps static routes ahead of :postId so new is the composer and not a detail", async () => {
    const get = vi.fn();
    const container = await render(`/trips/${tripId}/memories/new`, { auth, sessionStorage: storage(true), posts: { get } });
    expect(container.querySelector("h1")?.textContent).toBe("Nuevo recuerdo");
    expect(get).not.toHaveBeenCalled();
  });
  it("opens the detail from the diary, shows its chain and goes back to the diary", async () => {
    const list = vi.fn().mockResolvedValue({ ok: true, value: [saved()] });
    const parentId = itineraryId(31), childId = itineraryId(32);
    const get = vi.fn().mockResolvedValue({ ok: true, value: detail({ parent: { id: parentId, authorId: itineraryId(20), createdAt: "2026-01-01T10:00:00.000Z", description: "Antes" },
      children: [{ id: childId, authorId: itineraryId(20), createdAt: "2026-01-03T10:00:00.000Z", description: "Después" }], post: saved({ parentPostId: parentId }) }) });
    const container = await render(`/trips/${tripId}/memories`, { auth, sessionStorage: storage(true), posts: { list, get } });
    await click(container.querySelector(`li[data-memory="${postId}"] a`));
    expect(container.querySelector("h1")?.textContent).toBe("Recuerdo");
    expect(container.querySelector(`a[href="/trips/${tripId}/memories/${parentId}"]`)?.textContent).toBe("Antes");
    expect(container.querySelector(`a[href="/trips/${tripId}/memories/${childId}"]`)?.textContent).toBe("Después");
    await click(Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "Volver") ?? null);
    expect(container.querySelector("h1")?.textContent).toBe("Recuerdos");
  });
  it("flows from the diary to the detail, continues the memory and publishes it with only its parent", async () => {
    const childId = itineraryId(35);
    const list = vi.fn().mockResolvedValue({ ok: true, value: [saved()] });
    const get = vi.fn().mockResolvedValue({ ok: true, value: detail() });
    const create = vi.fn().mockResolvedValue({ ok: true, value: saved({ id: childId, description: "Continuación", parentPostId: postId }) });
    const container = await render(`/trips/${tripId}/memories`, { auth, sessionStorage: storage(true), posts: { list, get, create } });
    await click(container.querySelector(`li[data-memory="${postId}"] a`));
    const next = Array.from(container.querySelectorAll("a")).find((item) => item.textContent === "Continuar recuerdo");
    expect(next?.getAttribute("href")).toBe(`/trips/${tripId}/memories/new?parentPostId=${postId}`);
    await click(next ?? null);
    expect(container.querySelector("h1")?.textContent).toBe("Nuevo recuerdo");
    expect(container.querySelector("#post-link-summary")?.textContent).toBe("Recuerdo: Atardecer");
    await type(container, "description", "Continuación"); await submit(container);
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { description: "Continuación", parentPostId: postId });
    expect(container.querySelector("h1")?.textContent).toBe("Recuerdos");
    expect(container.textContent).toContain("Recuerdo publicado.");
  });
  it("cancels a continuation back to the detail it started from", async () => {
    const list = vi.fn().mockResolvedValue({ ok: true, value: [saved()] });
    const get = vi.fn().mockResolvedValue({ ok: true, value: detail() });
    const container = await render(`/trips/${tripId}/memories`, { auth, sessionStorage: storage(true), posts: { list, get } });
    await click(container.querySelector(`li[data-memory="${postId}"] a`));
    await click(Array.from(container.querySelectorAll("a")).find((item) => item.textContent === "Continuar recuerdo") ?? null);
    await click(Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "Cancelar") ?? null);
    expect(container.querySelector("h1")?.textContent).toBe("Recuerdo");
    expect(container.textContent).toContain("Atardecer");
  });
});
