// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App.js";
import { itineraryFixture, itineraryId } from "./trips/itinerary-test-fixture.js";

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
  it("wires the aggregate adapter to the restored session without extra content requests", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ accessToken: "renewed", refreshToken: "renewed-refresh" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ itinerary: itineraryFixture() })));
    vi.stubGlobal("fetch", fetch);
    const container = await render(`/trips/${itineraryId(1)}/itinerary`, { apiBaseUrl: "https://api.example.test", sessionStorage: storage(true) });
    expect(container.textContent).toContain("Paseo por el centro");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith(`https://api.example.test/trips/${itineraryId(1)}/itinerary`, expect.objectContaining({
      method: "GET", headers: { Authorization: "Bearer renewed" },
    }));
  });
  it("returns to login when the itinerary request expires the shared session", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ accessToken: "renewed", refreshToken: "renewed-refresh" })))
      .mockResolvedValueOnce(new Response("{}", { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    const container = await render(`/trips/${itineraryId(1)}/itinerary`, { apiBaseUrl: "https://api.example.test", sessionStorage: storage(true) });
    expect(container.textContent).toContain("Iniciar sesión"); expect(container.querySelector('[data-itinerary-date]')).toBeNull();
  });
});
