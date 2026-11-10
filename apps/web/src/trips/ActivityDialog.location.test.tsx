// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NativeCapabilityError, err, ok, type ExternalLinkPort } from "app-domain";
import { ExternalLinkContext } from "./external-link-context.js";
import { itineraryFixture } from "./itinerary-test-fixture.js";
import type { TripItineraryResponse } from "./trip-itinerary-api.js";
import { TripItineraryScreen } from "./TripItineraryScreen.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
type OpenResult = Awaited<ReturnType<ExternalLinkPort["open"]>>;

async function render(mapsUrl: string | null, port?: ExternalLinkPort) {
  const value = itineraryFixture() as TripItineraryResponse;
  value.activities[0]!.mapsUrl = mapsUrl;
  const get = vi.fn().mockImplementation(async (_tripId, id) => ({ ok: true, value: value.activities.find((a) => a.id === id) }));
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<ExternalLinkContext.Provider value={port}><MemoryRouter initialEntries={[`/trips/${value.tripId}/itinerary`]}>
    <Routes><Route path="/trips/:tripId/itinerary" element={<TripItineraryScreen itinerary={{ get: async () => ({ ok: true, value: structuredClone(value) }) }}
      activities={{ create: vi.fn(), get, update: vi.fn(), remove: async () => ({ ok: false, error: { kind: "server" } }) }} timeZone="America/Argentina/Buenos_Aires" />} /></Routes>
  </MemoryRouter></ExternalLinkContext.Provider>));
  const open = async () => act(async () => Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent === "Paseo por el centro")!.click());
  await open();
  return { container, value };
}
const dialog = (container: HTMLElement) => container.querySelector('[role="dialog"]') as HTMLElement;

describe("activity detail location", () => {
  it("shows the place card with the open action instead of the old link", async () => {
    const { container } = await render("https://www.google.com/maps/place/Museo+del+Prado/@40.41,-3.69,17z", { open: vi.fn() });
    const card = dialog(container).querySelector(".location-preview");
    expect(card?.getAttribute("data-context")).toBe("activity");
    expect(card?.textContent).toContain("Museo del Prado");
    expect(card?.querySelector("button")?.getAttribute("aria-label")).toBe("Abrir en Maps: Museo del Prado");
    expect(dialog(container).textContent).not.toContain("Ver vínculo de Maps");
  });
  it("shows nothing for an activity without location", async () => {
    const { container } = await render(null, { open: vi.fn() });
    expect(dialog(container).querySelector(".location-preview, [role=status]")).toBeNull();
  });
  it("shows the discreet invalid status and no action for a stored invalid link", async () => {
    const { container } = await render("http://maps.google.com/x", { open: vi.fn() });
    expect(dialog(container).querySelector("[role=status]")?.textContent).toBe("Vínculo de Maps no válido");
    expect(dialog(container).querySelector("a[href^='http://']")).toBeNull();
    expect(dialog(container).textContent).not.toContain("Abrir en Maps");
  });
  it("keeps the dialog open and operable when opening fails, and opens with the normalized url", async () => {
    const open = vi.fn(async (): Promise<OpenResult> => err(new NativeCapabilityError("native")));
    const { container } = await render("https://MAPS.GOOGLE.COM/?q=Plaza", { open });
    await act(async () => dialog(container).querySelector<HTMLButtonElement>(".location-preview button")!.click());
    expect(open).toHaveBeenCalledExactlyOnceWith("https://maps.google.com/?q=Plaza");
    expect(dialog(container)).not.toBeNull();
    expect(dialog(container).querySelectorAll("[role=alert]")).toHaveLength(1);
    expect(Array.from(dialog(container).querySelectorAll("button")).some((item) => item.textContent === "Editar actividad")).toBe(true);
    open.mockResolvedValueOnce(ok(undefined));
    await act(async () => dialog(container).querySelector<HTMLButtonElement>(".location-preview button")!.click());
    expect(dialog(container).querySelector("[role=alert]")).toBeNull();
  });
});
