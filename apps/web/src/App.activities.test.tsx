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
    await click(container, "Actividad nueva"); expect(container.querySelector('[role="dialog"]')?.textContent).toContain("Confirmada");
    await click(container, "Editar actividad"); await field(container, "title", "Actividad editada"); await save(container);
    expect(container.querySelector('[role="dialog"]')).toBeNull(); expect(container.textContent).toContain("Actividad editada");
    const activityCalls = fetch.mock.calls.filter(([url]) => (url as string).includes("/activities"));
    expect(activityCalls.map(([, request]) => request.method)).toEqual(["POST", "GET", "PATCH"]);
    activityCalls.forEach(([, request]) => expect(request.headers.Authorization).toBe("Bearer renewed"));
    expect(JSON.parse(activityCalls[2][1].body)).toEqual({ title: "Actividad editada" });
    expect(fetch.mock.calls.filter(([url]) => (url as string).endsWith("/itinerary"))).toHaveLength(3);
  });
  it("redirects to login when the shared session expires during creation", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ accessToken: "renewed", refreshToken: "refresh" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ itinerary: itineraryFixture() })))
      .mockResolvedValueOnce(new Response("{}", { status: 401 }));
    const container = await render(fetch);
    await click(container, "Crear actividad"); await field(container, "title", "Museo");
    await field(container, "time", toLocalDateTime("2026-09-25T13:30:00.000Z", Intl.DateTimeFormat().resolvedOptions().timeZone).slice(11)); await save(container);
    expect(container.textContent).toContain("Iniciar sesión"); expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
  it("does not request activities without an authenticated session", async () => {
    const fetch = vi.fn(); const container = await render(fetch, false);
    expect(container.textContent).toContain("Iniciar sesión"); expect(fetch).not.toHaveBeenCalled();
  });
});
