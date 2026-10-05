// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App.js";
import { itineraryFixture, itineraryId } from "./trips/itinerary-test-fixture.js";
import type { TripItineraryResponse } from "./trips/trip-itinerary-api.js";
import type { VoteResponse } from "./trips/trip-vote-api.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); vi.unstubAllGlobals(); });
function setup(failure?: "read" | "write", enabled = true) {
  const records = new Map<string, VoteResponse>();
  const fixture = itineraryFixture() as TripItineraryResponse;
  fixture.votingEnabled = enabled; fixture.activities.forEach((a) => { a.status = enabled ? "proposed" : "confirmed"; });
  const fetch = vi.fn().mockImplementation(async (url: string, request: RequestInit) => {
    if (url.endsWith("/auth/refresh")) return new Response(JSON.stringify({ accessToken: "renewed", refreshToken: "refresh" }));
    if (url.endsWith("/itinerary")) return new Response(JSON.stringify({ itinerary: fixture }));
    if (url.endsWith("/participation")) return new Response(JSON.stringify({ participation: null }));
    if (url.endsWith("/vote")) {
      if (failure === (request.method === "PUT" ? "write" : "read")) return new Response("{}", { status: 401 });
      const activityId = url.split("/").at(-2)!;
      const activity = fixture.activities.find((a) => a.id === activityId)!;
      if (request.method === "PUT") {
        records.set(url, { id: itineraryId(50), tripId: itineraryId(1), activityId, userId: itineraryId(20),
          value: JSON.parse(request.body as string).value, createdAt: "2026-09-25T12:00:00.000Z" });
        activity.status = "voting";
      }
      return new Response(JSON.stringify({ vote: records.get(url) ?? null, activityStatus: activity.status }));
    }
    const activity = fixture.activities.find((a) => url.endsWith(`/activities/${a.id}`));
    if (activity) return new Response(JSON.stringify({ activity }));
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
const voting = (scope: HTMLElement) => {
  const controls = scope.querySelector<HTMLElement>('fieldset[aria-label^="Tu voto"]');
  expect(controls, "own vote controls").not.toBeNull(); return controls!;
};
const click = async (scope: HTMLElement, label: string) => {
  const element = Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === label || button.getAttribute("aria-label") === label);
  expect(element, label).toBeDefined(); await act(async () => element!.click());
};
const card = (container: HTMLElement) => container.querySelector<HTMLElement>(`[data-itinerary-item="${itineraryId(8)}"]`)!;

describe("App voting integration", () => {
  it("uses the restored JWT to read, emit and replace the own vote", async () => {
    const { fetch } = setup(); const { container } = await render(fetch);
    await click(voting(card(container)), "A favor"); await click(voting(card(container)), "En contra");
    expect(voting(card(container)).querySelector('[aria-pressed="true"]')?.textContent).toBe("En contra");
    expect(card(container).textContent).toContain("En votación");
    expect(fetch.mock.calls.filter(([url]) => url.endsWith("/itinerary"))).toHaveLength(1);
    const requests = fetch.mock.calls.filter(([url]) => url.endsWith("/vote"));
    expect(requests.map(([, request]) => request.method)).toEqual(["GET", "GET", "PUT", "PUT"]);
    requests.forEach(([, request]) => expect(request.headers.Authorization).toBe("Bearer renewed"));
    expect(requests.slice(2).map(([, request]) => JSON.parse(request.body))).toEqual([{ value: "up" }, { value: "down" }]);
  });
  it("allows voting from detail and synchronizes the agenda", async () => {
    const { fetch } = setup(); const { container } = await render(fetch);
    await click(card(container), "Paseo por el centro");
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    await click(voting(dialog), "En contra");
    expect(voting(card(container)).querySelector('[aria-pressed="true"]')?.textContent).toBe("En contra");
    expect(dialog.textContent).toContain("En votación");
  });
  it("reads the persisted vote when returning to the itinerary", async () => {
    const { fetch } = setup(); const first = await render(fetch);
    await click(voting(card(first.container)), "En contra");
    await act(async () => first.root.unmount()); roots.splice(roots.indexOf(first.root), 1); first.container.remove();
    const { container } = await render(fetch);
    expect(voting(card(container)).querySelector('[aria-pressed="true"]')?.textContent).toBe("En contra");
  });
  it.each(["read", "write"] as const)("redirects to login on a vote %s returning 401", async (failure) => {
    const { fetch } = setup(failure); const { container } = await render(fetch);
    if (failure === "write") await click(voting(card(container)), "A favor");
    expect(container.textContent).toContain("Iniciar sesión"); expect(container.querySelector('[data-itinerary-item]')).toBeNull();
  });
  it("does not request votes without an authenticated session", async () => {
    const { fetch } = setup(); const { container } = await render(fetch, false);
    expect(container.textContent).toContain("Iniciar sesión"); expect(fetch).not.toHaveBeenCalled();
  });
  it("does not request votes when voting is disabled", async () => {
    const { fetch } = setup(undefined, false); const { container } = await render(fetch);
    expect(container.querySelector('fieldset[aria-label^="Tu voto"]')).toBeNull();
    expect(fetch.mock.calls.filter(([url]) => url.endsWith("/vote"))).toHaveLength(0);
  });
});
