// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App.js";
import { itineraryFixture, itineraryId } from "./trips/itinerary-test-fixture.js";
import { toLocalDateTime } from "./trips/transport-local-time.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
const withoutPosts = (activity: ReturnType<typeof itineraryFixture>["activities"][number]) => {
  const value: Omit<typeof activity, "postIds"> & { postIds?: string[] } = { ...activity };
  delete value.postIds; return value;
};
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); vi.unstubAllGlobals(); });
async function render(fetch: ReturnType<typeof vi.fn>, loggedIn = true) {
  vi.stubGlobal("fetch", fetch);
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={[`/trips/${itineraryId(1)}/itinerary`]}>
    <App apiBaseUrl="https://api.test" sessionStorage={{ read: async () => loggedIn ? { accessToken: "old", refreshToken: "refresh" } : null,
      save: async () => undefined, clear: async () => undefined }} />
  </MemoryRouter>));
  return container;
}
const click = async (container: HTMLElement, label: string) => {
  const element = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === label);
  expect(element, label).toBeDefined(); await act(async () => element!.click());
};
const field = async (container: HTMLElement, name: string, value: string) => {
  const element = container.querySelector<HTMLInputElement>(`[name="${name}"]`); expect(element).not.toBeNull();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value); element!.dispatchEvent(new Event("input", { bubbles: true })); });
};
const save = async (container: HTMLElement) => act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

describe("App activity integration", () => {
  it("creates, reads and edits through the authenticated adapters and aggregate reload", async () => {
    const fixture = itineraryFixture();
    const fetch = vi.fn().mockImplementation(async (url: string, request: RequestInit) => {
      if (url.endsWith("/auth/refresh")) return new Response(JSON.stringify({ accessToken: "renewed", refreshToken: "renewed-refresh" }));
      if (url.endsWith("/itinerary")) return new Response(JSON.stringify({ itinerary: fixture }));
      if (url.endsWith("/participation")) return new Response(JSON.stringify({ participation: null }));
      if (request.method === "POST") {
        const activity = { ...fixture.activities[0], ...JSON.parse(request.body as string), id: itineraryId(30), postIds: [] };
        fixture.activities.push(activity); fixture.days[1].items.push({ kind: "activity", id: activity.id, at: activity.scheduledAt });
        return new Response(JSON.stringify({ activity: withoutPosts(activity) }), { status: 201 });
      }
      const activity = fixture.activities.find((a) => url.endsWith(a.id))!;
      if (request.method === "PATCH") Object.assign(activity, JSON.parse(request.body as string));
      return new Response(JSON.stringify({ activity: withoutPosts(activity) }));
    });
    const container = await render(fetch);
    await click(container, "Crear actividad"); await field(container, "title", "Actividad nueva");
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    await field(container, "time", toLocalDateTime("2026-09-25T13:30:00.000Z", zone).slice(11)); await save(container);
    expect(container.textContent).toContain("Actividad nueva");
    await click(container, "Actividad nueva"); expect(container.querySelector('[role="dialog"]')?.textContent).not.toContain("Confirmada");
    await click(container, "Editar actividad"); await field(container, "title", "Actividad editada"); await save(container);
    expect(container.querySelector('[role="dialog"]')).toBeNull(); expect(container.textContent).toContain("Actividad editada");
    const activityCalls = fetch.mock.calls.filter(([url]) => (url as string).includes("/activities") && !(url as string).endsWith("/participation"));
    expect(activityCalls.map(([, request]) => request.method)).toEqual(["POST", "GET", "PATCH"]);
    activityCalls.forEach(([, request]) => expect(request.headers.Authorization).toBe("Bearer renewed"));
    expect(JSON.parse(activityCalls[2][1].body)).toEqual({ title: "Actividad editada" });
    expect(fetch.mock.calls.filter(([url]) => (url as string).endsWith("/itinerary"))).toHaveLength(3);
    expect(fetch.mock.calls.filter(([url]) => (url as string).endsWith("/participation"))).toHaveLength(3);
  });
  it("sends the duration through the adapters and shows the derived end after the reload", async () => {
    const fixture = itineraryFixture();
    const fetch = vi.fn().mockImplementation(async (url: string, request: RequestInit) => {
      if (url.endsWith("/auth/refresh")) return new Response(JSON.stringify({ accessToken: "renewed", refreshToken: "renewed-refresh" }));
      if (url.endsWith("/itinerary")) return new Response(JSON.stringify({ itinerary: fixture }));
      if (url.endsWith("/participation")) return new Response(JSON.stringify({ participation: null }));
      const activity = fixture.activities.find((a) => url.endsWith(a.id))!;
      if (request.method === "PATCH") Object.assign(activity, JSON.parse(request.body as string));
      return new Response(JSON.stringify({ activity: withoutPosts(activity) }));
    });
    const container = await render(fetch);
    await click(container, "Paseo por el centro"); await click(container, "Editar actividad");
    await field(container, "durationHours", "1"); await field(container, "durationMinutes", "30"); await save(container);
    const patch = fetch.mock.calls.find(([, request]) => request?.method === "PATCH")!;
    expect(JSON.parse(patch[1].body)).toEqual({ durationMinutes: 90 });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector(`[data-itinerary-item="${itineraryId(8)}"]`)?.textContent).toContain("Duración 1 h 30 min");
    await click(container, "Paseo por el centro");
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("Duración: 1 h 30 min");
  });
  it("redirects to login when the shared session expires during creation", async () => {
    const fetch = vi.fn().mockImplementation(async (url: string, request: RequestInit) => {
      if (url.endsWith("/auth/refresh")) return new Response(JSON.stringify({ accessToken: "renewed", refreshToken: "refresh" }));
      if (url.endsWith("/itinerary")) return new Response(JSON.stringify({ itinerary: itineraryFixture() }));
      if (url.endsWith("/participation")) return new Response(JSON.stringify({ participation: null }));
      expect(request.method).toBe("POST"); return new Response("{}", { status: 401 });
    });
    const container = await render(fetch);
    await click(container, "Crear actividad"); await field(container, "title", "Museo");
    await field(container, "time", toLocalDateTime("2026-09-25T13:30:00.000Z", Intl.DateTimeFormat().resolvedOptions().timeZone).slice(11)); await save(container);
    expect(container.textContent).toContain("Iniciar sesión"); expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
  it("does not request activities without an authenticated session", async () => {
    const fetch = vi.fn(); const container = await render(fetch, false);
    expect(container.textContent).toContain("Iniciar sesión"); expect(fetch).not.toHaveBeenCalled();
  });

  describe("participation conflict on creation (HTTP contract mocks)", () => {
    const snapshot = (n: number) => ({ conflicts: [{ activityId: itineraryId(8), reason: "overlap", scheduledAt: "2026-09-25T12:00:00.123Z", durationMinutes: 60 },
      { activityId: itineraryId(n), reason: "same_start", scheduledAt: "2026-09-25T14:00:00.123Z", durationMinutes: null }],
    activity: { scheduledAt: "2026-09-25T13:30:00.000Z", durationMinutes: 90 } });
    const conflictResponse = (n: number) => new Response(JSON.stringify({ error: { code: "ParticipationConflictError", message: "Secreto", ...snapshot(n) } }), { status: 409 });
    const setup = (plan: (post: number, body: Record<string, unknown>) => Response | undefined) => {
      const fixture = itineraryFixture(); let posts = 0;
      const fetch = vi.fn().mockImplementation(async (url: string, request: RequestInit) => {
        if (url.endsWith("/auth/refresh")) return new Response(JSON.stringify({ accessToken: "renewed", refreshToken: "renewed-refresh" }));
        if (url.endsWith("/itinerary")) return new Response(JSON.stringify({ itinerary: fixture }));
        if (url.endsWith("/participation")) return new Response(JSON.stringify({ participation: null }));
        if (request.method === "POST") {
          posts += 1; const body = JSON.parse(request.body as string);
          const planned = plan(posts, body); if (planned) return planned;
          delete body.confirmedConflicts; delete body.confirmedActivity;
          const activity = { ...fixture.activities[0], ...body, id: itineraryId(30), postIds: [] };
          fixture.activities.push(activity); fixture.days[1].items.push({ kind: "activity", id: activity.id, at: activity.scheduledAt });
          return new Response(JSON.stringify({ activity: withoutPosts(activity), participation: { id: itineraryId(51), tripId: itineraryId(1), activityId: itineraryId(30),
            userId: itineraryId(20), status: "going", updatedAt: "2026-09-25T12:00:00.000Z" } }), { status: 201 });
        }
        throw new Error(`Unexpected request: ${request.method} ${url}`);
      });
      return fetch;
    };
    const posts = (fetch: ReturnType<typeof vi.fn>) => fetch.mock.calls.filter(([url, request]) => (url as string).endsWith("/activities") && request?.method === "POST").map(([, request]) => JSON.parse(request.body));
    const draft = async (container: HTMLElement) => {
      await click(container, "Crear actividad"); await field(container, "title", "Museo nuevo");
      await field(container, "time", toLocalDateTime("2026-09-25T13:30:00.000Z", Intl.DateTimeFormat().resolvedOptions().timeZone).slice(11));
      await field(container, "durationHours", "1"); await field(container, "durationMinutes", "30"); await save(container);
    };
    const modal = () => Array.from(document.querySelectorAll("h2")).some((h) => h.textContent === "Cambiar de plan");
    it("cancelling keeps the whole draft and publishes nothing", async () => {
      const fetch = setup(() => conflictResponse(9)); const container = await render(fetch);
      await draft(container);
      expect(modal()).toBe(true); expect(document.querySelectorAll("ul.participation-conflict-list li")).toHaveLength(2);
      await click(document.body, "Conservar mi participación actual");
      expect(modal()).toBe(false); expect(posts(fetch)).toHaveLength(1);
      for (const [name, value] of [["title", "Museo nuevo"], ["durationHours", "1"], ["durationMinutes", "30"]]) expect(container.querySelector(`[name="${name}"]`)).toHaveProperty("value", value);
      expect(container.querySelector('[name="time"]')).toHaveProperty("value", toLocalDateTime("2026-09-25T13:30:00.000Z", Intl.DateTimeFormat().resolvedOptions().timeZone).slice(11));
      expect(container.querySelector('[name="date"]')).toHaveProperty("value", "2026-09-25");
      expect(container.textContent).not.toContain("Actividad guardada"); expect(container.querySelector(`[data-itinerary-item="${itineraryId(30)}"]`)).toBeNull();
    });
    it("confirming resends the exact snapshot and the 201 leaves the card with Voy without an extra participation read", async () => {
      const fetch = setup((post) => post === 1 ? conflictResponse(9) : undefined); const container = await render(fetch);
      await draft(container); await click(document.body, "Cambiar de plan");
      const sent = posts(fetch); expect(sent).toHaveLength(2);
      expect(sent[1]).toEqual({ ...sent[0], confirmedConflicts: snapshot(9).conflicts, confirmedActivity: snapshot(9).activity });
      expect(sent[0]).not.toHaveProperty("confirmedConflicts");
      expect(container.querySelector('[role="dialog"]')).toBeNull(); expect(modal()).toBe(false);
      const card = container.querySelector<HTMLElement>(`[data-itinerary-item="${itineraryId(30)}"]`)!;
      expect(card.querySelector('[aria-pressed="true"]')?.textContent).toBe("Voy");
      expect(fetch.mock.calls.filter(([url]) => (url as string).endsWith("/participation"))).toHaveLength(2);
      expect(container.textContent).not.toContain("Secreto");
    });
    it("shows the modal again as stale on a second 409 without publishing", async () => {
      const fetch = setup((post) => post <= 2 ? conflictResponse(post === 1 ? 9 : 10) : undefined); const container = await render(fetch);
      await draft(container); await click(document.body, "Cambiar de plan");
      expect(modal()).toBe(true); expect(document.querySelector('[role="alert"]')?.textContent).toContain("Los datos cambiaron");
      expect(container.querySelector(`[data-itinerary-item="${itineraryId(30)}"]`)).toBeNull();
      expect(posts(fetch)[1].confirmedConflicts).toEqual(snapshot(9).conflicts);
    });
    it.each([[422, "validation"], [500, "server"]])("keeps the draft after a %s while confirming", async (status) => {
      const fetch = setup((post) => post === 1 ? conflictResponse(9) : new Response(JSON.stringify({ error: { code: "X", message: "m" } }), { status: status as number }));
      const container = await render(fetch);
      await draft(container); await click(document.body, "Cambiar de plan");
      expect(modal()).toBe(false); expect(container.querySelector('[name="title"]')).toHaveProperty("value", "Museo nuevo");
      expect(container.querySelector('[role="alert"]')).not.toBeNull(); expect(container.querySelector(`[data-itinerary-item="${itineraryId(30)}"]`)).toBeNull();
    });
    it("keeps the draft after a network error while confirming", async () => {
      const fetch = setup((post) => post === 1 ? conflictResponse(9) : undefined); const container = await render(fetch);
      await draft(container);
      const original = fetch.getMockImplementation()!;
      fetch.mockImplementation(async (url: string, request: RequestInit) => { if (request?.method === "POST") throw new Error("Offline"); return original(url, request); });
      await click(document.body, "Cambiar de plan");
      expect(modal()).toBe(false); expect(container.querySelector('[name="title"]')).toHaveProperty("value", "Museo nuevo");
      expect(container.querySelector(`[data-itinerary-item="${itineraryId(30)}"]`)).toBeNull();
    });
  });
});
