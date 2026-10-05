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
});
