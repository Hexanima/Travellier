// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App.js";
import { itineraryFixture, itineraryId } from "./trips/itinerary-test-fixture.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); vi.unstubAllGlobals(); });
function setup(failure?: "read" | "write") {
  const records = new Map<string, unknown>();
  const fetch = vi.fn().mockImplementation(async (url: string, request: RequestInit) => {
    if (url.endsWith("/auth/refresh")) return new Response(JSON.stringify({ accessToken: "renewed", refreshToken: "refresh" }));
    if (url.endsWith("/itinerary")) return new Response(JSON.stringify({ itinerary: itineraryFixture() }));
    if (url.endsWith("/participation")) {
      if (failure === (request.method === "PUT" ? "write" : "read")) return new Response("{}", { status: 401 });
      if (request.method === "PUT") {
        records.set(url, { id: itineraryId(50), tripId: itineraryId(1), activityId: url.split("/").at(-2), userId: itineraryId(20),
          status: JSON.parse(request.body as string).status, updatedAt: "2026-09-25T12:00:00.000Z" });
      }
      return new Response(JSON.stringify({ participation: records.get(url) ?? null }));
    }
    throw new Error(`Unexpected request: ${request.method} ${url}`);
  });
  return { fetch };
}
async function render(fetch: ReturnType<typeof vi.fn>, loggedIn = true) {
  vi.stubGlobal("fetch", fetch);
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={[`/trips/${itineraryId(1)}/itinerary`]}>
    <App apiBaseUrl="https://api.test" sessionStorage={{ read: async () => loggedIn ? { accessToken: "old", refreshToken: "refresh" } : null,
      save: async () => undefined, clear: async () => undefined }} />
  </MemoryRouter>));
  return { container, root };
}
const click = async (container: HTMLElement, label: string) => {
  const element = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === label);
  expect(element, label).toBeDefined(); await act(async () => element!.click());
};
const card = (container: HTMLElement) => container.querySelector<HTMLElement>(`[data-itinerary-item="${itineraryId(8)}"]`)!;

describe("App participation integration", () => {
  it("uses the restored JWT and changes attendance without an aggregate reload", async () => {
    const { fetch } = setup(); const { container } = await render(fetch);
    await click(card(container), "Voy");
    expect(card(container).querySelector('[aria-pressed="true"]')?.textContent).toBe("Voy");
    expect(fetch.mock.calls.filter(([url]) => url.endsWith("/itinerary"))).toHaveLength(1);
    const requests = fetch.mock.calls.filter(([url]) => url.endsWith("/participation"));
    expect(requests.map(([, request]) => request.method)).toEqual(["GET", "GET", "PUT"]);
    requests.forEach(([, request]) => expect(request.headers.Authorization).toBe("Bearer renewed"));
    expect(JSON.parse(requests[2][1].body)).toEqual({ status: "going" });
  });
  it("reads the saved response on returning to the itinerary", async () => {
    const { fetch } = setup(); const first = await render(fetch);
    await click(card(first.container), "No voy");
    await act(async () => first.root.unmount()); roots.splice(roots.indexOf(first.root), 1); first.container.remove();
    const { container } = await render(fetch);
    expect(card(container).querySelector('[aria-pressed="true"]')?.textContent).toBe("No voy");
  });
  it.each(["read", "write"] as const)("redirects to login on a participation %s returning 401", async (failure) => {
    const { fetch } = setup(failure); const { container } = await render(fetch);
    if (failure === "write") await click(card(container), "Voy");
    expect(container.textContent).toContain("Iniciar sesión"); expect(container.querySelector('[data-itinerary-item]')).toBeNull();
  });
  it("does not request participation without an authenticated session", async () => {
    const { fetch } = setup(); const { container } = await render(fetch, false);
    expect(container.textContent).toContain("Iniciar sesión"); expect(fetch).not.toHaveBeenCalled();
  });

  it("handles a participation 409 end to end over HTTP: modal, conservar sends nothing, confirming resends the exact snapshot", async () => {
    const snapshot = { conflicts: [
      { activityId: itineraryId(9), reason: "overlap", scheduledAt: "2026-09-25T14:00:00.123Z", durationMinutes: 60 },
      { activityId: itineraryId(77), reason: "same_start", scheduledAt: "2026-09-25T12:00:00.123Z", durationMinutes: null }],
    activity: { scheduledAt: "2026-09-25T12:00:00.123Z", durationMinutes: null } };
    let puts = 0;
    const fetch = vi.fn().mockImplementation(async (url: string, request: RequestInit) => {
      if (url.endsWith("/auth/refresh")) return new Response(JSON.stringify({ accessToken: "renewed", refreshToken: "refresh" }));
      if (url.endsWith("/itinerary")) return new Response(JSON.stringify({ itinerary: itineraryFixture() }));
      if (url.endsWith("/participation") && request.method === "PUT") {
        puts += 1;
        const body = JSON.parse(request.body as string);
        if (body.confirmedConflicts === undefined || puts === 3) return new Response(JSON.stringify({ error: { code: "ParticipationConflictError", message: "Conflicto", ...snapshot } }), { status: 409 });
        return new Response(JSON.stringify({ participation: { id: itineraryId(50), tripId: itineraryId(1), activityId: url.split("/").at(-2), userId: itineraryId(20),
          status: body.status, updatedAt: "2026-09-25T12:00:00.000Z" } }));
      }
      if (url.endsWith("/participation")) return new Response(JSON.stringify({ participation: null }));
      throw new Error(`Unexpected request: ${request.method} ${url}`);
    });
    const { container } = await render(fetch);
    await click(card(container), "Voy");
    expect(Array.from(document.querySelectorAll("ul.participation-conflict-list li"))).toHaveLength(2);
    await click(document.body, "Conservar mi participación actual");
    expect(fetch.mock.calls.filter(([url, request]) => url.endsWith("/participation") && request.method === "PUT")).toHaveLength(1);
    await click(card(container), "Voy"); await click(document.body, "Cambiar de plan");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Los datos cambiaron");
    await click(document.body, "Cambiar de plan");
    const writes = fetch.mock.calls.filter(([url, request]) => url.endsWith("/participation") && request.method === "PUT").map(([, request]) => JSON.parse(request.body));
    expect(writes).toHaveLength(4); expect(writes[3]).toEqual({ status: "going", confirmedConflicts: snapshot.conflicts, confirmedActivity: snapshot.activity });
    expect(card(container).querySelector('[aria-pressed="true"]')?.textContent).toBe("Voy");
    expect(document.querySelector("ul.participation-conflict-list")).toBeNull();
    expect(fetch.mock.calls.filter(([url]) => url.endsWith("/itinerary"))).toHaveLength(1);
  });
  it("shows Modificado from the server mark and clears it after a saved answer", async () => {
    const mark = { reason: "schedule_conflict", changedFields: ["scheduledAt", "durationMinutes"], changedAt: "2026-09-26T10:00:00.000Z" };
    const base = { id: itineraryId(50), tripId: itineraryId(1), activityId: itineraryId(8), userId: itineraryId(20), updatedAt: "2026-09-25T12:00:00.000Z" };
    const fetch = vi.fn().mockImplementation(async (url: string, request: RequestInit) => {
      if (url.endsWith("/auth/refresh")) return new Response(JSON.stringify({ accessToken: "renewed", refreshToken: "refresh" }));
      if (url.endsWith("/itinerary")) return new Response(JSON.stringify({ itinerary: itineraryFixture() }));
      if (request.method === "PUT") return new Response(JSON.stringify({ participation: { ...base, status: "going" } }));
      return new Response(JSON.stringify({ participation: url.includes(itineraryId(8)) ? { ...base, status: "pending", decisionRequired: mark } : null }));
    });
    const { container } = await render(fetch);
    expect(card(container).textContent).toContain("Modificado");
    await click(card(container), "Voy");
    expect(card(container).textContent).not.toContain("Modificado");
  });
});
