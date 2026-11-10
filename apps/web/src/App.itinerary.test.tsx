// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.js";
import { itineraryFixture, itineraryId, linkPost } from "./trips/itinerary-test-fixture.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); vi.unstubAllGlobals(); });
const storage = (hasSession: boolean) => ({ read: vi.fn().mockResolvedValue(hasSession ? { accessToken: "old", refreshToken: "refresh" } : null),
  save: vi.fn().mockResolvedValue(undefined), clear: vi.fn().mockResolvedValue(undefined) });
async function render(path: string, props: ComponentProps<typeof App>) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><App {...props} /></MemoryRouter>));
  return container;
}
describe("App itinerary integration", () => {
  it("protects the route before requesting the itinerary", async () => {
    const get = vi.fn();
    const container = await render(`/trips/${itineraryId(1)}/itinerary`, { auth: {}, sessionStorage: storage(false), itinerary: { get } });
    expect(container.textContent).toContain("Iniciar sesión"); expect(get).not.toHaveBeenCalled();
  });
  it("opens the itinerary from My Trips", async () => {
    const list = vi.fn().mockResolvedValue({ ok: true, value: [{ id: itineraryId(1), name: "Córdoba", description: null, primaryDestination: { name: "Córdoba" } }] });
    const get = vi.fn().mockResolvedValue({ ok: true, value: itineraryFixture() });
    const container = await render("/trips", { auth: { refresh: vi.fn().mockResolvedValue({ ok: true, value: { accessToken: "access", refreshToken: "refresh" } }) },
      sessionStorage: storage(true), trips: { list }, itinerary: { get } });
    const link = container.querySelector(`a[href="/trips/${itineraryId(1)}/itinerary"]`);
    expect(link).not.toBeNull();
    await act(async () => link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(container.textContent).toContain("Paseo por el centro"); expect(get).toHaveBeenCalledExactlyOnceWith(itineraryId(1));
  });
  it("loads the aggregate and each own participation with the restored session", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ accessToken: "renewed", refreshToken: "renewed-refresh" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ itinerary: itineraryFixture() })))
      .mockImplementation(async () => new Response(JSON.stringify({ participation: null })));
    vi.stubGlobal("fetch", fetch);
    const container = await render(`/trips/${itineraryId(1)}/itinerary`, { apiBaseUrl: "https://api.example.test", sessionStorage: storage(true) });
    expect(container.textContent).toContain("Paseo por el centro");
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch).toHaveBeenNthCalledWith(2, `https://api.example.test/trips/${itineraryId(1)}/itinerary`, expect.objectContaining({
      method: "GET", headers: { Authorization: "Bearer renewed" },
    }));
    const participationCalls = fetch.mock.calls.filter(([url]) => (url as string).endsWith("/participation"));
    expect(participationCalls).toHaveLength(2);
    participationCalls.forEach(([, request]) => expect(request.headers.Authorization).toBe("Bearer renewed"));
  });
  it("returns to login when the itinerary request expires the shared session", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ accessToken: "renewed", refreshToken: "renewed-refresh" })))
      .mockResolvedValueOnce(new Response("{}", { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    const container = await render(`/trips/${itineraryId(1)}/itinerary`, { apiBaseUrl: "https://api.example.test", sessionStorage: storage(true) });
    expect(container.textContent).toContain("Iniciar sesión"); expect(container.querySelector('[data-itinerary-date]')).toBeNull();
  });
  describe("post detail from the itinerary", () => {
    beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); window.scrollTo = vi.fn() as unknown as typeof window.scrollTo; });
    it("opens a post detail from the itinerary and goes back to the itinerary", async () => {
      const value = itineraryFixture();
      const get = vi.fn().mockResolvedValue({ ok: true, value });
      const postGet = vi.fn().mockResolvedValue({ ok: true, value: { post: { ...value.posts[0], tripId: itineraryId(1) }, parent: null, children: [], rootActivityId: null } });
      const container = await render(`/trips/${itineraryId(1)}/itinerary`, { auth: { refresh: vi.fn().mockResolvedValue({ ok: true, value: { accessToken: "a", refreshToken: "r" } }) },
        sessionStorage: storage(true), itinerary: { get }, posts: { get: postGet } });
      const link = container.querySelector(`[data-itinerary-post="${value.posts[0].id}"] a`);
      expect(link?.getAttribute("href")).toBe(`/trips/${itineraryId(1)}/memories/${value.posts[0].id}`);
      await act(async () => link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })));
      expect(container.querySelector("h1")?.textContent).toBe("Recuerdo");
      expect(postGet).toHaveBeenCalledExactlyOnceWith(itineraryId(1), value.posts[0].id);
      const back = Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "Volver");
      await act(async () => back?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
      expect(container.querySelector("h1")?.textContent).toBe("Itinerario");
      expect(container.querySelector(`[data-itinerary-post="${value.posts[0].id}"]`)).not.toBeNull();
    });
  });
  describe("memories and photos of an activity", () => {
    beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); window.scrollTo = vi.fn() as unknown as typeof window.scrollTo; });
    const A = itineraryId(8);
    const wiring = () => {
      const value = itineraryFixture();
      linkPost(value.posts[0]!, { activityId: A });
      const photo = { id: itineraryId(40), postId: value.posts[0]!.id, order: 0, uploadedAt: "2026-09-25T13:30:00.000Z", uploaderId: itineraryId(20), url: "https://s3.test/40", expiresAtMs: Date.now() + 300_000,
        post: { createdAt: value.posts[0]!.createdAt, authorId: itineraryId(20), rootActivityId: A, rootTransportId: null } };
      return { value, photo, props: {
        auth: { refresh: vi.fn().mockResolvedValue({ ok: true, value: { accessToken: "a", refreshToken: "r" } }) }, sessionStorage: storage(true),
        itinerary: { get: vi.fn().mockResolvedValue({ ok: true, value }) },
        activities: { get: vi.fn().mockImplementation(async (_t: string, id: string) => ({ ok: true, value: value.activities.find((a) => a.id === id) })) },
        gallery: { list: vi.fn().mockResolvedValue({ ok: true, value: { photos: [photo], nextCursor: null } }) },
        members: { list: vi.fn().mockResolvedValue({ ok: true, value: { currentUserId: itineraryId(20), members: [] } }) },
        posts: { get: vi.fn().mockResolvedValue({ ok: true, value: { post: { ...value.posts[0], tripId: itineraryId(1) }, parent: null, children: [], rootActivityId: A } }) },
      } as unknown as ComponentProps<typeof App> };
    };
    const click = (element: Element | null | undefined) => act(async () => element?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })));
    it("opens the memory from the activity and «Volver a la actividad» restores the dialog and the focus", async () => {
      const { value, props } = wiring();
      const container = await render(`/trips/${itineraryId(1)}/itinerary?activity=${A}`, props);
      await act(async () => { await Promise.resolve(); });
      const row = document.querySelector(`[data-memory="${value.posts[0]!.id}"]`);
      expect(row).not.toBeNull();
      await click(row!.querySelector("a"));
      expect(container.querySelector("h1")?.textContent).toBe("Recuerdo");
      const back = Array.from(container.querySelectorAll("a")).find((item) => item.textContent === "Volver a la actividad");
      expect(back).toBeDefined();
      await click(back);
      await act(async () => { await Promise.resolve(); });
      expect(container.querySelector("h1")?.textContent).toBe("Itinerario");
      expect(document.querySelector(".activity-dialog")).not.toBeNull();
      expect(document.activeElement).toBe(document.querySelector(`[data-memory="${value.posts[0]!.id}"]`));
    });
    it("lists the images of the activity in Fotos using the shared gallery provider", async () => {
      const { photo, props } = wiring();
      await render(`/trips/${itineraryId(1)}/itinerary?activity=${A}&tab=photos`, props);
      await act(async () => { await Promise.resolve(); });
      expect(document.querySelector(`[data-photo="${photo.id}"]`)).not.toBeNull();
      expect((props.gallery!.list as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(itineraryId(1), { activityId: A });
    });
  });
});
