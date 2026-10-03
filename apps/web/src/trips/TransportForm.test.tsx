// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TransportForm } from "./TransportForm.js";
import type { JourneyTransport, TransportType, TripJourneyApi } from "./trip-journey-api.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tripId = "507f191e810c19729de860ea";
const destinationId = "507f1f77bcf86cd799439013";
const transportId = "507f1f77bcf86cd799439014";
const saved: JourneyTransport = {
  id: transportId, tripId, destinationId, direction: "outbound", type: "flight",
  departurePlace: "AEP", departureAt: "2026-10-01T12:00:00.000Z",
  arrivalPlace: "BRC", arrivalAt: "2026-10-01T14:00:00.000Z",
  costPerPerson: 150, details: { flightNumber: "AR123" },
};
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  document.body.replaceChildren();
});

const setField = async (container: HTMLElement, name: string, value: string) => {
  const field = container.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLSelectElement;
  await act(async () => {
    const prototype = field.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, value);
    field.dispatchEvent(new Event(field.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
};
const click = async (container: HTMLElement, label: string) => act(async () => {
  Array.from(container.querySelectorAll("button")).find((button) => button.textContent === label)?.click();
});
const submit = async (container: HTMLElement) => act(async () => {
  container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
});

async function render(existing?: JourneyTransport) {
  const createTransport = vi.fn().mockResolvedValue({ ok: true, value: saved });
  const updateTransport = vi.fn().mockResolvedValue({ ok: true, value: saved });
  const onSaved = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(<TransportForm tripId={tripId} destinationId={destinationId}
    direction="outbound" existing={existing} journey={{ createTransport, updateTransport } as unknown as TripJourneyApi}
    onSaved={onSaved} />));
  return { container, createTransport, updateTransport, onSaved };
}

describe("TransportForm", () => {
  it("shows only the fields pertinent to each transport type", async () => {
    const { container } = await render();
    const cases: { type: TransportType; visible: string[]; hidden: string[] }[] = [
      { type: "flight", visible: ["flightNumber", "costPerPerson"], hidden: ["company", "step-line-0"] },
      { type: "bus_long", visible: ["company", "costPerPerson"], hidden: ["flightNumber", "step-line-0"] },
      { type: "bus_local", visible: ["step-line-0"], hidden: ["flightNumber", "company", "costPerPerson"] },
      { type: "car", visible: [], hidden: ["flightNumber", "company", "costPerPerson", "step-line-0"] },
      { type: "other", visible: [], hidden: ["flightNumber", "company", "costPerPerson", "step-line-0"] },
    ];
    for (const { type, visible, hidden } of cases) {
      await setField(container, "type", type);
      for (const name of visible) expect(container.querySelector(`[name="${name}"]`)).not.toBeNull();
      for (const name of hidden) expect(container.querySelector(`[name="${name}"]`)).toBeNull();
    }
  });

  it("adds and removes urban bus steps while preserving their visible order", async () => {
    const { container } = await render();
    await setField(container, "type", "bus_local");
    await click(container, "Agregar tramo");
    expect(container.querySelectorAll('[name^="step-line-"]')).toHaveLength(2);
    await setField(container, "step-line-0", "21");
    await setField(container, "step-line-1", "8");
    expect((container.querySelector('[name="step-line-0"]') as HTMLInputElement).value).toBe("21");
    expect((container.querySelector('[name="step-line-1"]') as HTMLInputElement).value).toBe("8");
    await click(container, "Quitar tramo 1");
    expect(container.querySelectorAll('[name^="step-line-"]')).toHaveLength(1);
    expect((container.querySelector('[name="step-line-0"]') as HTMLInputElement).value).toBe("8");
  });

  it("shows temporal errors before saving and sends no request", async () => {
    const { container, createTransport } = await render();
    await setField(container, "departurePlace", "AEP");
    await setField(container, "arrivalPlace", "BRC");
    await setField(container, "departureAt", "2026-10-01T12:00");
    await setField(container, "arrivalAt", "2026-10-01T11:00");
    await submit(container);
    expect(createTransport).not.toHaveBeenCalled();
    expect(container.querySelector('[name="arrivalAt"][aria-invalid="true"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("anterior");
  });

  it("edits an existing transport and retains server field errors", async () => {
    const { container, createTransport, updateTransport } = await render(saved);
    expect((container.querySelector('[name="flightNumber"]') as HTMLInputElement).value).toBe("AR123");
    updateTransport.mockResolvedValueOnce({ ok: false, error: { kind: "validation", fields: [
      { field: "arrivalAt", message: "Arrival cannot precede departure." },
    ] } });
    await submit(container);
    expect(createTransport).not.toHaveBeenCalled();
    expect(updateTransport).toHaveBeenCalledWith(tripId, destinationId, transportId, expect.objectContaining({ type: "flight" }));
    expect(container.querySelector('[name="arrivalAt"][aria-invalid="true"]')).not.toBeNull();
    expect((container.querySelector('[name="flightNumber"]') as HTMLInputElement).value).toBe("AR123");
  });

  it("shows a general error when the API rejects a field without a visible control", async () => {
    const { container, updateTransport } = await render(saved);
    updateTransport.mockResolvedValueOnce({ ok: false, error: { kind: "validation", fields: [
      { field: "details", message: "Transport details are invalid." },
    ] } });
    await submit(container);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Revisá");
    expect((container.querySelector('[name="flightNumber"]') as HTMLInputElement).value).toBe("AR123");
  });

  it("prevents duplicate submissions while saving", async () => {
    let resolveSave: (result: unknown) => void = () => undefined;
    const { container, createTransport } = await render();
    createTransport.mockImplementation(() => new Promise((resolve) => { resolveSave = resolve; }));
    await setField(container, "departurePlace", "AEP");
    await setField(container, "arrivalPlace", "BRC");
    await setField(container, "departureAt", "2026-10-01T12:00");
    await setField(container, "arrivalAt", "2026-10-01T14:00");
    await submit(container);
    await submit(container);
    expect(createTransport).toHaveBeenCalledOnce();
    expect(container.querySelector('button[type="submit"]')).toHaveProperty("disabled", true);
    await act(async () => resolveSave({ ok: true, value: saved }));
  });
});
