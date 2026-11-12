// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DestinationPicker } from "./DestinationPicker.js";
import type { DestinationChoice } from "./trip-itinerary-destinations.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });

const complete = (id: string, order: number, arrivalAt: string, departureAt: string, firstDay: string, lastDay: string): DestinationChoice =>
  ({ id, name: `Parada ${order}`, order, arrivalAt, departureAt, firstDay, lastDay, status: "complete" });
const choices: DestinationChoice[] = [
  complete("a", 1, "2026-09-25T02:00:00.000Z", "2026-09-28T18:00:00.000Z", "2026-09-25", "2026-09-28"),
  { id: "b", name: "Parada 2", order: 2, arrivalAt: "2026-09-28T19:00:00.000Z", departureAt: null, firstDay: null, lastDay: null, status: "missing-return" },
  { id: "c", name: "Parada 3", order: 3, arrivalAt: null, departureAt: null, firstDay: null, lastDay: null, status: "missing-both" },
  { id: "d", name: "Parada 4", order: 4, arrivalAt: null, departureAt: "2026-10-02T10:00:00.000Z", firstDay: null, lastDay: null, status: "missing-outbound" },
  { id: "e", name: "Parada 5", order: 5, arrivalAt: "2026-10-05T10:00:00.000Z", departureAt: "2026-10-03T10:00:00.000Z", firstDay: null, lastDay: null, status: "inconsistent" },
];
async function mount(props: Partial<Parameters<typeof DestinationPicker>[0]> = {}) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  const onSelect = vi.fn(), onClose = vi.fn();
  await act(async () => root.render(<DestinationPicker choices={choices} current="a" timeZone="UTC" onSelect={onSelect} onClose={onClose} {...props} />));
  const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
  const stops = () => [...dialog.querySelectorAll<HTMLButtonElement>("button.destination-picker__stop")];
  return { container, dialog, stops, onSelect, onClose };
}

describe("DestinationPicker", () => {
  it("is a titled dialog with one button per stop in order, the current one marked", async () => {
    const { dialog, stops } = await mount();
    expect(dialog.textContent).toContain("Destinos del viaje");
    expect(stops().map((b) => b.textContent!.includes(`Parada ${stops().indexOf(b) + 1}`))).toEqual([true, true, true, true, true]);
    expect(stops().map((b) => b.getAttribute("aria-current"))).toEqual(["true", null, null, null, null]);
  });
  it("shows order, local arrival and departure with machine-readable instants", async () => {
    const { stops } = await mount({ timeZone: "America/Argentina/Buenos_Aires" });
    const first = stops()[0]!;
    expect(first.textContent).toContain("1");
    const times = [...first.querySelectorAll("time")];
    expect(times.map((t) => t.getAttribute("datetime"))).toEqual(["2026-09-25T02:00:00.000Z", "2026-09-28T18:00:00.000Z"]);
    expect(times[0]!.textContent).toContain("24"); // 23:00 of the 24th in Buenos Aires
    expect(first.textContent).toContain("Llegada");
    expect(first.textContent).toContain("Salida");
  });
  it("selects a complete stop", async () => {
    const { stops, onSelect } = await mount({ current: "z" });
    await act(async () => stops()[0]!.click());
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("a");
  });
  it("disables incomplete stops with the reason and never selects them", async () => {
    const { stops, onSelect } = await mount();
    const texts = ["Falta configurar la salida", "Falta configurar los transportes", "Falta configurar la llegada", "Revisá los horarios del transporte"];
    stops().slice(1).forEach((b, i) => { expect(b.disabled).toBe(true); expect(b.textContent).toContain(texts[i]); });
    await act(async () => stops().slice(1).forEach((b) => b.click()));
    expect(onSelect).not.toHaveBeenCalled();
  });
  it("does not invent dates for an incomplete stop", async () => {
    const { stops } = await mount();
    expect(stops()[2]!.querySelectorAll("time")).toHaveLength(0);
    expect(stops()[1]!.querySelectorAll("time")).toHaveLength(1); // the known arrival only
  });
  it("closes with Escape and with Cerrar, without selecting", async () => {
    const { dialog, container, onClose, onSelect } = await mount();
    await act(async () => { dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => container.querySelector<HTMLElement>('button[aria-label="Cerrar"]')!.click());
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onSelect).not.toHaveBeenCalled();
  });
  it("works with a single stop", async () => {
    const { stops, onSelect } = await mount({ choices: [choices[0]!] });
    expect(stops()).toHaveLength(1);
    await act(async () => stops()[0]!.click());
    expect(onSelect).toHaveBeenCalledWith("a");
  });
  it("renders the dialog inside the .destination-picker-layer (bottom sheet on mobile) and keeps incomplete stops as disabled buttons", async () => {
    const { container, dialog, stops } = await mount();
    expect(dialog.closest(".destination-picker-layer")).not.toBeNull();
    expect(container.querySelector(".destination-picker-layer")).not.toBeNull();
    expect(stops().map((b) => b.disabled)).toEqual([false, true, true, true, true]);
    expect(stops().every((b) => b.tagName === "BUTTON" && b.type === "button")).toBe(true);
  });
});
