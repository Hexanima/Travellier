// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NativeCapabilityError, err, ok, type ExternalLinkPort } from "app-domain";
import { ExternalLinkContext } from "./external-link-context.js";
import { PostComposer } from "./PostComposer.js";
import { ignoreRetryIds } from "./post-composer-test-api.js";
import { MemoriesLayout } from "./TripMemoriesScreen.js";
import { itineraryFixture, itineraryId } from "./itinerary-test-fixture.js";
import type { PostResponse } from "./trip-post-api.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
const tripId = itineraryId(1), postId = itineraryId(30);
const saved = (extra: Partial<PostResponse> = {}): PostResponse => ({ id: postId, tripId, authorId: itineraryId(20), description: "Atardecer", mapsUrl: null,
  activityId: null, parentPostId: null, transportId: null, createdAt: "2026-01-02T15:30:00.000Z", ...extra });
type OpenResult = Awaited<ReturnType<ExternalLinkPort["open"]>>;
function Listing() { const location = useLocation(); return <p data-testid="listing">LISTADO {location.pathname}</p>; }

async function render(port?: ExternalLinkPort) {
  const create = vi.fn().mockResolvedValue({ ok: true, value: saved() });
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  const posts = ignoreRetryIds({ create, update: vi.fn(), get: vi.fn() });
  const itinerary = { get: vi.fn().mockResolvedValue({ ok: true, value: itineraryFixture() }) };
  await act(async () => root.render(<ExternalLinkContext.Provider value={port}><MemoryRouter initialEntries={[`/trips/${tripId}/memories/new`]}><Routes>
    <Route path="/trips/:tripId/memories" element={<MemoriesLayout />}>
      <Route index element={<Listing />} />
      <Route path="new" element={<PostComposer posts={posts} itinerary={itinerary} timeZone="America/Argentina/Buenos_Aires" />} />
    </Route>
  </Routes></MemoryRouter></ExternalLinkContext.Provider>));
  return { container, create };
}
async function field(container: HTMLElement, name: string, value: string) {
  const element = container.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLTextAreaElement;
  expect(element, `Field ${name}`).not.toBeNull();
  const proto = element.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); });
}
const value = (container: HTMLElement, name: string) => (container.querySelector(`[name="${name}"]`) as HTMLInputElement).value;
const submit = async (container: HTMLElement) => act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
const preview = (container: HTMLElement) => container.querySelector(".location-preview");

describe("PostComposer location preview", () => {
  it("shows nothing without a location and the place card for the typed link", async () => {
    const { container } = await render({ open: vi.fn() });
    expect(preview(container)).toBeNull();
    await field(container, "mapsUrl", "https://www.google.com/maps/place/Torre+Eiffel/@48.85,2.29,17z");
    expect(preview(container)?.getAttribute("data-context")).toBe("composer");
    expect(preview(container)?.textContent).toContain("Torre Eiffel");
    await field(container, "mapsUrl", "");
    expect(preview(container)).toBeNull();
  });

  it("shows a discreet status for an invalid link and does not block publishing nor change the payload", async () => {
    const { container, create } = await render({ open: vi.fn() });
    await field(container, "mapsUrl", " http://maps.example/x ");
    expect(container.querySelector("[role=status]")?.textContent).toBe("Vínculo de Maps no válido");
    expect(container.querySelector('button[type="submit"]')?.hasAttribute("disabled")).toBe(false);
    await submit(container);
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { mapsUrl: "http://maps.example/x" });
  });

  it("sends the trimmed raw text, not the normalized href, for a valid link", async () => {
    const { container, create } = await render({ open: vi.fn() });
    await field(container, "mapsUrl", " https://MAPS.GOOGLE.COM/?q=a ");
    await submit(container);
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { mapsUrl: "https://MAPS.GOOGLE.COM/?q=a" });
  });

  it("keeps the typed text and location when opening Maps fails", async () => {
    const open = vi.fn(async (): Promise<OpenResult> => err(new NativeCapabilityError("native")));
    const { container, create } = await render({ open });
    await field(container, "description", "Hola"); await field(container, "mapsUrl", "https://maps.google.com/?q=Plaza");
    await act(async () => (preview(container)?.querySelector("button") as HTMLButtonElement).click());
    expect(open).toHaveBeenCalledExactlyOnceWith("https://maps.google.com/?q=Plaza");
    expect(container.querySelectorAll("[role=alert]")).toHaveLength(1);
    expect(container.querySelector("[role=alert]")?.textContent).toContain("No pudimos abrir Maps");
    expect(value(container, "description")).toBe("Hola"); expect(value(container, "mapsUrl")).toBe("https://maps.google.com/?q=Plaza");
    await submit(container);
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { description: "Hola", mapsUrl: "https://maps.google.com/?q=Plaza" });
  });

  it("opens Maps without publishing or leaving the composer", async () => {
    const open = vi.fn(async (): Promise<OpenResult> => ok(undefined));
    const { container, create } = await render({ open });
    await field(container, "mapsUrl", "https://maps.google.com/?q=Plaza");
    await act(async () => (preview(container)?.querySelector("button") as HTMLButtonElement).click());
    expect(create).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="listing"]')).toBeNull();
    expect(container.querySelector('[name="mapsUrl"]')).not.toBeNull();
  });
});
