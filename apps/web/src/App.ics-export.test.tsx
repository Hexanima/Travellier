// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App.js";
import { itineraryFixture, itineraryId } from "./trips/itinerary-test-fixture.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
const urlKeys = ["createObjectURL", "revokeObjectURL"] as const;
/** jsdom may not define these; keep the original descriptors (or their absence) to restore them exactly. */
const originalUrl = urlKeys.map((key) => [key, Object.getOwnPropertyDescriptor(URL, key)] as const);
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); vi.restoreAllMocks();
  for (const [key, descriptor] of originalUrl) { if (descriptor) Object.defineProperty(URL, key, descriptor); else Reflect.deleteProperty(URL, key); }
});
const storage = () => ({ read: vi.fn().mockResolvedValue({ accessToken: "old", refreshToken: "refresh" }), save: vi.fn().mockResolvedValue(undefined), clear: vi.fn().mockResolvedValue(undefined) });
const blobText = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsText(blob);
});

describe("App .ics export", () => {
  it("exports the loaded itinerary with the Trip name from the app's own trip API, as a text/calendar download", async () => {
    const blobs: Blob[] = [];
    const names: string[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => { blobs.push(blob); return "blob:itinerary"; });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
    const get = vi.fn().mockResolvedValue({ ok: true, value: { id: itineraryId(1), name: "Córdoba 2026" } });
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container); roots.push(root);
    await act(async () => root.render(<MemoryRouter initialEntries={[`/trips/${itineraryId(1)}/itinerary`]}>
      <App auth={{ refresh: vi.fn().mockResolvedValue({ ok: true, value: { accessToken: "access", refreshToken: "refresh" } }) }} sessionStorage={storage()}
        trips={{ get }} itinerary={{ get: vi.fn().mockResolvedValue({ ok: true, value: itineraryFixture() }) }} />
    </MemoryRouter>));
    const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "Exportar a calendario (.ics)");
    expect(button).toBeDefined();
    await act(async () => { button!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    expect(get).toHaveBeenCalledWith(itineraryId(1));
    expect(names).toEqual(["travellier-cordoba-2026.ics"]);
    expect(blobs).toHaveLength(1);
    expect(blobs[0].type).toBe("text/calendar;charset=utf-8");
    const text = await blobText(blobs[0]);
    expect(text).toContain("X-WR-CALNAME:Córdoba 2026\r\n");
    expect(text).toContain("SUMMARY:Visita al museo");
    expect(container.querySelector('[role="status"]:not(.pull-to-refresh__status)')?.textContent).toMatch(/^Se generó la exportación el .*Si no aparece el archivo, probá de nuevo\.$/);
  });
  it("leaves no global URL patch behind (checked after the previous test's cleanup)", () => {
    for (const [key, descriptor] of originalUrl) expect(Object.getOwnPropertyDescriptor(URL, key)?.value).toBe(descriptor?.value);
    expect(vi.isMockFunction(URL.createObjectURL)).toBe(false);
    expect(vi.isMockFunction(URL.revokeObjectURL)).toBe(false);
  });
});
