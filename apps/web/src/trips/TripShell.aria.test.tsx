// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TripProvider } from "./trip-context.js";
import { TripShell } from "./TripShell.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
beforeEach(() => { window.scrollTo = vi.fn() as never; });
const tripId = "0123456789abcdef01234567";
const trips = { get: vi.fn((id: string) => Promise.resolve({ ok: true, value: { id, kind: "member", name: "Patagonia" } })) };
function Frame() { const { tripId: id } = useParams(); return <TripProvider key={id} trips={trips as never} tripId={id}><TripShell /></TripProvider>; }

async function mount(path: string) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={[`/trips/${tripId}/${path}`]}><Routes>
    <Route path="/trips/:tripId" element={<Frame />}>
      <Route path="itinerary" element={<p>itinerario</p>} />
      <Route path="memories" element={<p>diario</p>} />
      <Route path="memories/photos" element={<p>fotos</p>} />
      <Route path="members" element={<p>grupo</p>} />
    </Route>
  </Routes></MemoryRouter>));
  return container;
}
const tabs = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>("[aria-label=\"Secciones del viaje\"] [role=tab]")];
const key = (el: HTMLElement, k: string) => act(async () => { el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })); });

describe("TripShell tabs (ARIA)", () => {
  it("exposes a labelled tablist with three tabs, one selected and focusable, and a labelled tabpanel", async () => {
    const c = await mount("itinerary");
    expect(c.querySelectorAll("[role=tablist][aria-label=\"Secciones del viaje\"]")).toHaveLength(1);
    const all = tabs(c);
    expect(all.map((t) => t.textContent)).toEqual(["Itinerario", "Diario", "Grupo"]);
    expect(all.map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
    expect(all.map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    const panel = c.querySelector<HTMLElement>("[role=tabpanel]");
    expect(panel?.getAttribute("aria-labelledby")).toBe(all[0]?.id);
    expect(c.querySelector("h1")?.textContent).toBe("Patagonia");
  });
  it("moves with arrows, Home and End", async () => {
    const c = await mount("itinerary");
    await key(tabs(c)[0]!, "ArrowRight");
    expect(tabs(c).map((t) => t.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
    await key(tabs(c)[1]!, "End");
    expect(tabs(c).map((t) => t.getAttribute("aria-selected"))).toEqual(["false", "false", "true"]);
    await key(tabs(c)[2]!, "Home");
    expect(tabs(c).map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
  });
  it("shows the second tablist only in the diary", async () => {
    expect((await mount("itinerary")).querySelector("[aria-label=\"Contenido del diario\"]")).toBeNull();
    const c = await mount("memories");
    expect(c.querySelectorAll("[aria-label=\"Contenido del diario\"] [role=tab]")).toHaveLength(2);
  });
});
