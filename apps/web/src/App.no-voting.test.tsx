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

describe("App without voting", () => {
  it("never requests a vote endpoint, even with a legacy itinerary that enables voting", async () => {
    const fixture = itineraryFixture() as ReturnType<typeof itineraryFixture> & { votingEnabled?: boolean };
    fixture.votingEnabled = true;
    fixture.activities.forEach((a) => { (a as { status?: string }).status = "proposed"; });
    const fetch = vi.fn().mockImplementation(async (url: string, request: RequestInit) => {
      if (url.endsWith("/auth/refresh")) return new Response(JSON.stringify({ accessToken: "renewed", refreshToken: "refresh" }));
      if (url.endsWith("/itinerary")) return new Response(JSON.stringify({ itinerary: fixture }));
      if (url.endsWith("/participation")) return new Response(JSON.stringify({ participation: null }));
      throw new Error(`Unexpected request: ${request.method} ${url}`);
    });
    vi.stubGlobal("fetch", fetch);
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container); roots.push(root);
    await act(async () => root.render(<MemoryRouter initialEntries={[`/trips/${itineraryId(1)}/itinerary`]}>
      <App apiBaseUrl="https://api.test" sessionStorage={{ read: async () => ({ accessToken: "old", refreshToken: "refresh" }),
        save: async () => undefined, clear: async () => undefined }} />
    </MemoryRouter>));
    expect(container.querySelector('[data-itinerary-item]')).not.toBeNull();
    expect(container.querySelector('fieldset[aria-label^="Tu voto"]')).toBeNull();
    expect(container.textContent).not.toContain("Propuesta");
    expect(fetch.mock.calls.filter(([url]) => String(url).includes("/vote"))).toHaveLength(0);
  });
});
