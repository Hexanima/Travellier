// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TripRefreshProvider, useTripRefreshLoader } from "./trip-refresh.js";
import { TripShell } from "./TripShell.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
beforeEach(() => { window.scrollTo = vi.fn() as never; Object.defineProperty(window, "scrollY", { configurable: true, writable: true, value: 0 }); });
const tripId = "0123456789abcdef01234567";
const load = vi.fn(async () => ({ status: "ok" as const }));
function Screen() { useTripRefreshLoader("screen", load); return <p data-screen>pantalla</p>; }

async function mount(path: string, withProvider = true) {
  load.mockClear();
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  const shell = <TripShell />;
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/trips/:tripId" element={withProvider ? <TripRefreshProvider tripId={tripId}>{shell}</TripRefreshProvider> : shell}>
      <Route path="itinerary" element={<Screen />} />
      <Route path="memories/new" element={<Screen />} />
    </Route>
  </Routes></MemoryRouter>));
  return container;
}
const touch = (target: Element, type: string, y?: number) => act(async () => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const points = y === undefined ? [] : [{ clientY: y, clientX: 0 }];
  Object.defineProperty(event, "touches", { value: points });
  target.dispatchEvent(event);
});
const refreshButton = () => Array.from(document.querySelectorAll("button")).find((item) => item.textContent === "Actualizar");

describe("TripShell: pull to refresh and «Actualizar»", () => {
  it("a pull on a root screen refreshes the mounted screen once", async () => {
    await mount(`/trips/${tripId}/itinerary`);
    const screen = document.querySelector("[data-screen]")!;
    await touch(screen, "touchstart", 100); await touch(screen, "touchmove", 200); await touch(screen, "touchend");
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("the visible «Actualizar» button does the same, without a gesture", async () => {
    await mount(`/trips/${tripId}/itinerary`);
    await act(async () => refreshButton()!.click());
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("outside the root screens (forms) there is neither button nor gesture", async () => {
    await mount(`/trips/${tripId}/memories/new`);
    expect(refreshButton()).toBeUndefined();
    const screen = document.querySelector("[data-screen]")!;
    await touch(screen, "touchstart", 100); await touch(screen, "touchmove", 300); await touch(screen, "touchend");
    expect(load).not.toHaveBeenCalled();
  });
  it("without the refresh provider the shell shows no useless button", async () => {
    await mount(`/trips/${tripId}/itinerary`, false);
    expect(refreshButton()).toBeUndefined();
  });
});
