// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App.js";
import { itineraryId } from "./trips/itinerary-test-fixture.js";
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
