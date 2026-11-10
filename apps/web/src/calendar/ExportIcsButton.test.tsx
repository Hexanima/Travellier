// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { itineraryFixture } from "../trips/itinerary-test-fixture.js";
import type { TripItineraryResponse } from "../trips/trip-itinerary-api.js";
import { ExportIcsButton, icsStaticCopyNotice } from "./ExportIcsButton.js";
import type { DownloadResult } from "./download-ics.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });

const fixture = () => itineraryFixture() as TripItineraryResponse;
const now = () => new Date("2026-11-10T12:34:56.789Z");
type Download = (text: string, fileName: string) => DownloadResult | Promise<DownloadResult>;
function mount(initial: { itinerary?: TripItineraryResponse; tripName?: string; download?: Download }) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  const download = initial.download ?? vi.fn<Download>(() => ({ ok: true }));
  const render = async (itinerary: TripItineraryResponse | undefined = initial.itinerary, tripName = initial.tripName ?? "Viaje a Córdoba") =>
    act(async () => root.render(<ExportIcsButton tripName={tripName} itinerary={itinerary} download={download} now={now} timeZone="America/Argentina/Buenos_Aires" />));
  return { container, download: download as ReturnType<typeof vi.fn<Download>>, render };
}
const button = (container: HTMLElement) => Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "Exportar a calendario (.ics)") as HTMLButtonElement | undefined;
const click = async (container: HTMLElement) => act(async () => { button(container)!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });

describe("ExportIcsButton", () => {
  it("offers the button with the fixed static-copy notice", async () => {
    const { container, render } = mount({ itinerary: fixture() });
    await render();
    expect(button(container)).toBeDefined();
    expect(icsStaticCopyNotice).toBe("El archivo es una copia estática: si el itinerario cambia, descargá una nueva exportación y volvé a importarla. Los eventos ya importados no se actualizan solos.");
    expect(container.textContent).toContain(icsStaticCopyNotice);
    expect(container.querySelector('[role="status"],[role="alert"]')).toBeNull();
  });
  it("downloads the current itinerary with a sanitized name and reports the export time", async () => {
    const { container, download, render } = mount({ itinerary: fixture() });
    await render();
    await click(container);
    expect(download).toHaveBeenCalledTimes(1);
    const [text, name] = download.mock.calls[0];
    expect(name).toBe("travellier-viaje-a-cordoba.ics");
    expect(text).toContain("X-WR-CALNAME:Viaje a Córdoba");
    expect(text).toContain("DTSTAMP:20261110T123456Z");
    const status = container.querySelectorAll('[role="status"]');
    expect(status).toHaveLength(1);
    expect(status[0].textContent).toMatch(/^Exportado el .*2026.*09:34/);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it("generates from the latest itinerary each time, never from a cached export", async () => {
    const { container, download, render } = mount({ itinerary: fixture() });
    await render();
    await click(container);
    const changed = fixture();
    changed.activities[0].title = "Título nuevo";
    await render(changed);
    await click(container);
    expect(download.mock.calls[0][0]).toContain("SUMMARY:Paseo por el centro");
    expect(download.mock.calls[1][0]).toContain("SUMMARY:Título nuevo");
    expect(download.mock.calls[1][0]).not.toContain("Paseo por el centro");
  });
  it("shows a single alert (and no success) when the download fails, then recovers", async () => {
    const download = vi.fn<Download>(() => ({ ok: false }));
    const { container, render } = mount({ itinerary: fixture(), download });
    await render();
    await click(container);
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(container.querySelector('[role="status"]')).toBeNull();
    download.mockReturnValue({ ok: true });
    await click(container);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    download.mockImplementation(() => { throw new Error("boom"); });
    await click(container);
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
  });
  it("is aria-disabled while exporting without losing focus, and does not re-enter", async () => {
    let finish!: (value: DownloadResult) => void;
    const download = vi.fn<Download>(() => new Promise<DownloadResult>((resolve) => { finish = resolve; }));
    const { container, render } = mount({ itinerary: fixture(), download });
    await render();
    const target = button(container)!;
    target.focus();
    await click(container);
    expect(button(container)!.getAttribute("aria-disabled")).toBe("true");
    expect(button(container)!.disabled).toBe(false);
    expect(document.activeElement).toBe(target);
    await click(container);
    expect(download).toHaveBeenCalledTimes(1);
    await act(async () => finish({ ok: true }));
    expect(button(container)!.getAttribute("aria-disabled")).toBeNull();
    expect(document.activeElement).toBe(target);
    expect(download).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  });
  it("two immediate clicks in the same tick produce one download", async () => {
    const { container, download, render } = mount({ itinerary: fixture() });
    await render();
    await act(async () => {
      const target = button(container)!;
      target.dispatchEvent(new MouseEvent("click", { bubbles: true })); target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(download).toHaveBeenCalledTimes(1);
  });
  it("offers nothing without an itinerary and says so when there are no events", async () => {
    const missing = mount({});
    await missing.render(undefined);
    expect(button(missing.container)).toBeUndefined();
    expect(missing.container.textContent).toBe("");
    const none = mount({ itinerary: { ...fixture(), days: [], transports: [], activities: [] } });
    await none.render();
    expect(button(none.container)).toBeUndefined();
    expect(none.container.textContent).toContain("No hay nada para exportar");
    expect(none.download).not.toHaveBeenCalled();
  });
  it("falls back to a fixed Trip name when none is known", async () => {
    const { container, download, render } = mount({ itinerary: fixture(), tripName: "  " });
    await render();
    await click(container);
    expect(download.mock.calls[0][0]).toContain("X-WR-CALNAME:Viaje Travellier");
    expect(download.mock.calls[0][1]).toBe("travellier-viaje.ics");
  });
});
