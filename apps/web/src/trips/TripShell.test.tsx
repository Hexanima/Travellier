// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useParams, type NavigateFunction } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TripProvider } from "./trip-context.js";
import { useInTripShell } from "./trip-state.js";
import { TripShell } from "./TripShell.js";
import { noticesOrigin } from "./post-origin.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
beforeEach(() => { window.scrollTo = vi.fn() as never; });
const tripId = "0123456789abcdef01234567", otherId = "0123456789abcdef01234568";
const base = `/trips/${tripId}`;

let go: NavigateFunction = () => undefined;
let where = { pathname: "", search: "", state: null as unknown };
function Probe() { go = useNavigate(); const l = useLocation(); where = { pathname: l.pathname, search: l.search, state: l.state }; return null; }
function Screen({ name }: { name: string }) { return <p data-screen>{`${name}:${useInTripShell()}`}</p>; }
const names: Record<string, Promise<unknown> | undefined> = {};
const trips = { get: vi.fn((id: string) => names[id] ?? Promise.resolve({ ok: true, value: { id, kind: "member", name: "Patagonia" } })) };
function Frame() { const { tripId: id } = useParams(); return <TripProvider key={id} trips={trips as never} tripId={id}><TripShell /></TripProvider>; }

async function mount(entries: string[], options: { state?: unknown } = {}) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  const index = entries.length - 1;
  const initial = entries.map((pathname, i) => (i === index && options.state !== undefined ? { pathname, state: options.state } : pathname));
  await act(async () => root.render(<MemoryRouter initialEntries={initial as never} initialIndex={index}><Probe /><Routes>
    <Route path="/trips" element={<p data-screen>mis viajes</p>} />
    <Route path="/notifications" element={<p data-screen>avisos</p>} />
    <Route path="/trips/:tripId" element={<Frame />}>
      <Route path="itinerary" element={<Screen name="itinerario" />} />
      <Route path="memories" element={<Screen name="diario" />} />
      <Route path="memories/photos" element={<Screen name="fotos" />} />
      <Route path="memories/new" element={<Screen name="nuevo" />} />
      <Route path="memories/:postId" element={<Screen name="detalle" />} />
      <Route path="members" element={<Screen name="grupo" />} />
      <Route path="balance" element={<Screen name="balance" />} />
    </Route>
  </Routes></MemoryRouter>));
  return container;
}
const tab = (c: HTMLElement, label: string) => [...c.querySelectorAll<HTMLElement>("[role=tab]")].find((t) => t.textContent === label)!;
const selected = (c: HTMLElement) => [...c.querySelectorAll("[role=tab][aria-selected=true]")].map((t) => t.textContent);
const screen = (c: HTMLElement) => c.querySelector("[data-screen]")?.textContent;
const press = (el: HTMLElement) => act(async () => el.click());

describe("TripShell", () => {
  it("frames the root screens with the Trip name, the way back and the tabs", async () => {
    const c = await mount(["/trips", `${base}/itinerary`]);
    expect(c.querySelectorAll("main")).toHaveLength(1);
    expect(c.querySelector("h1")?.textContent).toBe("Patagonia");
    expect([...c.querySelectorAll("[role=tab]")].map((t) => t.textContent)).toEqual(["Itinerario", "Diario", "Grupo"]);
    expect(c.querySelector("[role=tablist]")?.getAttribute("aria-label")).toBe("Secciones del viaje");
    expect(selected(c)).toEqual(["Itinerario"]);
    expect(screen(c)).toBe("itinerario:true");
    expect(c.querySelector("a.trips-back")?.getAttribute("href")).toBe("/trips");
    expect(c.querySelector("a.trips-back")?.textContent).toBe("Volver a mis viajes");
  });
  it("selects the tab by route and shows Posts/Fotos only inside the diary", async () => {
    const c = await mount([`${base}/memories`]);
    expect(selected(c)).toEqual(["Diario", "Posts"]);
    expect(screen(c)).toBe("diario:true");
    await press(tab(c, "Fotos"));
    expect(where.pathname).toBe(`${base}/memories/photos`);
    expect(selected(c)).toEqual(["Diario", "Fotos"]);
    await press(tab(c, "Grupo"));
    expect(where.pathname).toBe(`${base}/members`);
    expect(selected(c)).toEqual(["Grupo"]);
    expect([...c.querySelectorAll("[role=tab]")].map((t) => t.textContent)).toEqual(["Itinerario", "Diario", "Grupo"]);
  });
  it("pressing the selected tab does nothing; pressing Diario from the itinerary opens Posts", async () => {
    const c = await mount([`${base}/itinerary?day=2026-09-26`]);
    await press(tab(c, "Itinerario"));
    expect(where.pathname + where.search).toBe(`${base}/itinerary?day=2026-09-26`);
    await press(tab(c, "Diario"));
    expect(where.pathname).toBe(`${base}/memories`);
  });
  it("renders details, forms and other screens without tabs, main or heading", async () => {
    for (const path of ["memories/new", `memories/${"a".repeat(24)}`, "balance"]) {
      const c = await mount([`${base}/${path}`]);
      expect(c.querySelector("[role=tablist]"), path).toBeNull();
      expect(c.querySelector("main"), path).toBeNull();
      expect(c.querySelector("h1"), path).toBeNull();
      expect(screen(c)).toMatch(/:false$/);
      await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren();
    }
  });
  it("changing tab replaces the entry: Back from a root leaves to Mis viajes after any number of tab changes", async () => {
    const c = await mount(["/trips", `${base}/itinerary`]);
    await press(tab(c, "Diario")); await press(tab(c, "Grupo")); await press(tab(c, "Itinerario"));
    expect(where.pathname).toBe(`${base}/itinerary`);
    await act(async () => go(-1));
    expect(screen(c)).toBe("mis viajes");
    expect(where.pathname).toBe("/trips");
  });
  it("keeps «no way back» when the first entry of the app is replaced by a tab change", async () => {
    const c = await mount([`${base}/itinerary`]);
    await press(tab(c, "Grupo"));
    expect((where.state as { noBack?: boolean }).noBack).toBe(true);
  });
  it("opened from the notices center, the way back stays that center across tabs", async () => {
    const c = await mount(["/notifications", `${base}/members`], { state: { origin: noticesOrigin } });
    expect(c.querySelector("a.trips-back")?.getAttribute("href")).toBe("/notifications");
    expect(c.querySelector("a.trips-back")?.textContent).toBe("Volver a avisos");
    await press(tab(c, "Itinerario"));
    expect(c.querySelector("a.trips-back")?.getAttribute("href")).toBe("/notifications");
  });
  it("another Trip shows nothing of the previous one", async () => {
    const c = await mount([`${base}/itinerary`]);
    expect(c.querySelector("h1")?.textContent).toBe("Patagonia");
    names[otherId] = new Promise(() => undefined); // the other Trip never answers
    await act(async () => go(`/trips/${otherId}/itinerary`));
    expect(c.querySelector("h1")?.textContent).toBe("Viaje");
    delete names[otherId];
  });
  it("uses a neutral heading while the name is unknown", async () => {
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container); roots.push(root);
    await act(async () => root.render(<MemoryRouter initialEntries={[`${base}/members`]}><Routes>
      <Route path="/trips/:tripId" element={<TripShell />}><Route path="members" element={<Screen name="grupo" />} /></Route></Routes></MemoryRouter>));
    expect(container.querySelector("h1")?.textContent).toBe("Viaje");
  });
});
