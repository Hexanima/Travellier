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
  costPerPerson: 150, costCurrency: "ARS", details: { flightNumber: "AR123" },
};
const previous: JourneyTransport = { ...saved, costCurrency: null };
const fillRoute = async (container: HTMLElement) => {
  await setField(container, "departurePlace", "AEP");
  await setField(container, "arrivalPlace", "BRC");
  await setField(container, "departureAt", "2026-10-01T12:00");
  await setField(container, "arrivalAt", "2026-10-01T14:00");
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

async function render(existing?: JourneyTransport, complementary?: JourneyTransport) {
  const createTransport = vi.fn().mockResolvedValue({ ok: true, value: saved });
  const updateTransport = vi.fn().mockResolvedValue({ ok: true, value: saved });
  const onSaved = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(<TransportForm tripId={tripId} destinationId={destinationId}
    direction={existing?.direction ?? "outbound"} existing={existing} complementary={complementary}
    journey={{ createTransport, updateTransport } as unknown as TripJourneyApi}
    onSaved={onSaved} />));
  return { container, createTransport, updateTransport, onSaved };
}

describe("TransportForm", () => {
  it.each(["America/New_York", "Asia/Tokyo"])("keeps confirmed clocks and the editing zone across saves after switching to %s", async (zone) => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = "America/Argentina/Buenos_Aires";
      const openingZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const current: JourneyTransport = { ...saved, type: "bus_local", departureAt: "2026-10-04T06:00:00.123Z",
        arrivalAt: "2026-10-04T08:00:00.456Z", details: { steps: [{ line: "1", fromStop: "A", toStop: "B", estimatedAt: "2026-10-04T07:30:12.345Z" }] } };
      const { container, updateTransport } = await render(current);
      updateTransport.mockImplementation(async (_trip, _destination, _id, input) => ({ ok: true, value: { ...current, ...input } }));
      process.env.TZ = zone;
      await setField(container, "arrivalPlace", "C");
      await submit(container);
      expect(updateTransport).toHaveBeenLastCalledWith(tripId, destinationId, transportId,
        expect.objectContaining({ departureAt: current.departureAt, arrivalAt: current.arrivalAt, details: current.details }));
      expect(container.textContent).toContain(openingZone);
      expect(container.querySelector('[name="departureAt"]')).toHaveProperty("value", "2026-10-04T03:00");
      process.env.TZ = "Asia/Tokyo";
      await setField(container, "step-line-0", "2");
      await submit(container);
      expect(updateTransport).toHaveBeenLastCalledWith(tripId, destinationId, transportId,
        expect.objectContaining({ departureAt: current.departureAt, arrivalAt: current.arrivalAt,
          details: { steps: [{ ...current.details.steps[0], line: "2" }] } }));
      expect(updateTransport).toHaveBeenCalledTimes(2);
    } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
  });

  it("uses the opening zone for a new transport even if the system zone changes before saving", async () => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = "America/Argentina/Buenos_Aires";
      const { container, createTransport } = await render();
      await setField(container, "departurePlace", "A");
      await setField(container, "arrivalPlace", "B");
      await setField(container, "departureAt", "2026-10-04T03:00");
      await setField(container, "arrivalAt", "2026-10-04T05:00");
      process.env.TZ = "Asia/Tokyo";
      await submit(container);
      expect(createTransport).toHaveBeenCalledWith(tripId, destinationId,
        expect.objectContaining({ departureAt: "2026-10-04T06:00:00.000Z", arrivalAt: "2026-10-04T08:00:00.000Z" }));
    } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
  });

  it("treats explicitly re-entering a saved date-time as a clock edit, not an unrelated field change", async () => {
    const current = { ...saved, departureAt: new Date("2026-10-01T08:00:12.345").toISOString() };
    const { container, updateTransport } = await render(current);
    await setField(container, "departureAt", "");
    await setField(container, "departureAt", "2026-10-01T08:00");
    await submit(container);
    expect(updateTransport).toHaveBeenCalledWith(tripId, destinationId, transportId,
      expect.objectContaining({ departureAt: new Date("2026-10-01T08:00").toISOString(), arrivalAt: current.arrivalAt }));
  });

  it("allows explicitly re-entering the clock after moving the transport to another date", async () => {
    const current: JourneyTransport = { ...saved, type: "bus_local", departureAt: new Date("2026-10-01T08:00").toISOString(),
      arrivalAt: new Date("2026-10-01T10:00").toISOString(), details: { steps: [{ line: "21", fromStop: "A", toStop: "B",
        estimatedAt: new Date("2026-10-01T09:00:12.345").toISOString() }] } };
    const { container, updateTransport } = await render(current);
    updateTransport.mockImplementation(async (_trip, _destination, _id, input) => ({ ok: true, value: { ...current, ...input } }));
    await setField(container, "departureAt", "2026-10-02T08:00");
    await setField(container, "arrivalAt", "2026-10-02T10:00");
    await submit(container);
    expect(updateTransport).not.toHaveBeenCalled();
    await setField(container, "step-estimatedTime-0", "");
    await setField(container, "step-estimatedTime-0", "09:00");
    await submit(container);
    expect(updateTransport).toHaveBeenCalledWith(tripId, destinationId, transportId, expect.objectContaining({
      details: { steps: [{ line: "21", fromStop: "A", toStop: "B", estimatedAt: new Date("2026-10-02T09:00").toISOString() }] },
    }));
  });
  it("requires explicit confirmation before converting saved clock-only steps", async () => {
    const legacy: JourneyTransport = { ...saved, type: "bus_local", departureAt: new Date("2026-10-01T08:00").toISOString(),
      arrivalAt: new Date("2026-10-01T10:00").toISOString(),
      details: { steps: [{ line: "21", fromStop: "A", toStop: "B", estimatedTime: "09:00" }] } };
    const { container, updateTransport } = await render(legacy);
    updateTransport.mockImplementation(async (_trip, _destination, _id, input) => ({ ok: true, value: { ...legacy, ...input } }));
    await submit(container);
    expect(updateTransport).not.toHaveBeenCalled();
    expect(container.textContent).toContain("zona local");
    const confirm = container.querySelector('[name="confirmLegacyTimes"]') as HTMLInputElement;
    expect(confirm).not.toBeNull();
    await act(async () => confirm.click());
    await submit(container);
    expect(updateTransport).toHaveBeenCalledWith(tripId, destinationId, transportId, expect.objectContaining({
      details: { steps: [{ line: "21", fromStop: "A", toStop: "B", estimatedAt: new Date("2026-10-01T09:00").toISOString() }] },
    }));
    expect(container.querySelector('[name="confirmLegacyTimes"]')).toBeNull();
  });
  it("maps API estimatedAt errors to the visible clock control", async () => {
    const current: JourneyTransport = { ...saved, type: "bus_local", details: { steps: [{ line: "21", fromStop: "A", toStop: "B",
      estimatedAt: "2026-10-01T13:00:00.000Z" }] } };
    const { container, updateTransport } = await render(current);
    updateTransport.mockResolvedValueOnce({ ok: false, error: { kind: "validation", fields: [
      { field: "details.steps[0].estimatedAt", message: "Horario fuera del transporte." },
    ] } });
    await submit(container);
    expect(updateTransport).toHaveBeenCalledOnce();
    expect(container.querySelector('[name="step-estimatedTime-0"][aria-invalid="true"]')).not.toBeNull();
    expect(container.textContent).toContain("Horario fuera del transporte.");
  });
  it("explains an itinerary conflict, retains entered values and allows correction", async () => {
    const { container, updateTransport, onSaved } = await render(saved);
    updateTransport.mockResolvedValueOnce({ ok: false, error: { kind: "itinerary-conflict" } });
    await setField(container, "flightNumber", "AR456");
    await submit(container);
    expect(container.textContent).toContain("elimina días con actividades o posts");
    expect(container.textContent).not.toContain("Transporte guardado.");
    expect((container.querySelector('[name="flightNumber"]') as HTMLInputElement).value).toBe("AR456");
    expect(onSaved).not.toHaveBeenCalled();
    await setField(container, "flightNumber", "AR789");
    await submit(container);
    expect(updateTransport).toHaveBeenCalledTimes(2);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Transporte guardado.");
  });
  it("saves an unchanged departure coinciding with the exact arrival, including seconds", async () => {
    const boundary = "2026-10-10T10:00:30.125-03:00";
    const current: JourneyTransport = { ...saved, direction: "return", departureAt: boundary,
      arrivalAt: "2026-10-10T12:00:45.678-03:00" };
    const { container, updateTransport } = await render(current, { ...saved,
      departureAt: "2026-10-10T08:00:00.000-03:00", arrivalAt: boundary });
    updateTransport.mockImplementation(async (_trip, _destination, _id, input) => ({ ok: true, value: { ...current, ...input } }));
    await setField(container, "flightNumber", "AR456");
    await submit(container);
    expect(updateTransport).toHaveBeenCalledWith(tripId, destinationId, transportId, expect.objectContaining({
      departureAt: boundary, arrivalAt: current.arrivalAt, details: { flightNumber: "AR456" },
    }));
    expect(container.querySelector('[name="departureAt"][aria-invalid="true"]')).toBeNull();
    await setField(container, "flightNumber", "AR789");
    await submit(container);
    expect(updateTransport).toHaveBeenLastCalledWith(tripId, destinationId, transportId,
      expect.objectContaining({ departureAt: boundary, arrivalAt: current.arrivalAt }));
    expect(updateTransport).toHaveBeenCalledTimes(2);
  });

  it.each(["outbound", "return"] as const)("blocks a %s transport that inverts the destination window", async (direction) => {
    const current: JourneyTransport = { ...saved, direction,
      departureAt: new Date("2026-10-10T10:00").toISOString(), arrivalAt: new Date("2026-10-10T12:00").toISOString() };
    const complementary: JourneyTransport = { ...saved, direction: direction === "outbound" ? "return" : "outbound",
      departureAt: new Date(direction === "outbound" ? "2026-10-09T18:00" : "2026-10-10T11:00").toISOString(),
      arrivalAt: new Date(direction === "outbound" ? "2026-10-09T20:00" : "2026-10-10T13:00").toISOString() };
    const { container, updateTransport } = await render(current, complementary);
    await submit(container);
    expect(updateTransport).not.toHaveBeenCalled();
    expect(container.querySelector(`[name="${direction === "outbound" ? "arrivalAt" : "departureAt"}"][aria-invalid="true"]`)).not.toBeNull();
  });

  it("shows an urban sequence error without sending a request", async () => {
    const { container, updateTransport } = await render({ ...saved, type: "bus_local",
      departureAt: new Date("2026-10-01T08:00").toISOString(), arrivalAt: new Date("2026-10-01T10:00").toISOString(),
      details: { steps: ["09:30", "08:30"].map((estimatedTime) => ({ line: "21", fromStop: "A", toStop: "B", estimatedTime })) } });
    await submit(container);
    expect(updateTransport).not.toHaveBeenCalled();
    expect(container.querySelector('[name="step-estimatedTime-1"][aria-invalid="true"]')).not.toBeNull();
  });

  it.each(["flight", "bus_long"] as const)("clears the saved optional detail for %s", async (type) => {
    const field = type === "flight" ? "flightNumber" : "company";
    const current: JourneyTransport = type === "flight" ? saved : { ...saved, type, details: { company: "Empresa" } };
    const { container, updateTransport } = await render(current);
    updateTransport.mockImplementation(async (_trip, _destination, _id, input) => ({ ok: true,
      value: { ...current, ...input, details: { ...current.details, ...input.details } } }));
    await setField(container, field, "");
    await submit(container);
    expect(updateTransport).toHaveBeenCalledWith(tripId, destinationId, transportId,
      expect.objectContaining({ details: { [field]: null } }));
    expect(container.querySelector(`[name="${field}"]`)).toHaveProperty("value", "");
  });

  it("shows only the fields pertinent to each transport type", async () => {
    const { container } = await render();
    const cases: { type: TransportType; visible: string[]; hidden: string[] }[] = [
      { type: "flight", visible: ["flightNumber", "costPerPerson", "costCurrency"], hidden: ["company", "step-line-0"] },
      { type: "bus_long", visible: ["company", "costPerPerson", "costCurrency"], hidden: ["flightNumber", "step-line-0"] },
      { type: "bus_local", visible: ["step-line-0"], hidden: ["flightNumber", "company", "costPerPerson", "costCurrency"] },
      { type: "car", visible: [], hidden: ["flightNumber", "company", "costPerPerson", "costCurrency", "step-line-0"] },
      { type: "other", visible: [], hidden: ["flightNumber", "company", "costPerPerson", "costCurrency", "step-line-0"] },
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

  describe("cost currency", () => {
    const options = (container: HTMLElement) => Array.from(container.querySelectorAll('[name="costCurrency"] option')).map((option) => option.textContent);

    it("offers the three currencies with no preselection", async () => {
      const { container } = await render();
      expect(options(container)).toEqual(["Elegí una moneda", "Pesos argentinos · ARS", "Euros · EUR", "Dólares · USD"]);
      expect(container.querySelector('[name="costCurrency"]')).toHaveProperty("value", "");
      expect(container.textContent).toContain("Moneda del costo");
    });

    it("blocks a cost without currency, shows the error on the field and sends nothing", async () => {
      const { container, createTransport } = await render();
      await fillRoute(container);
      await setField(container, "costPerPerson", "120");
      await submit(container);
      expect(createTransport).not.toHaveBeenCalled();
      const select = container.querySelector('[name="costCurrency"]') as HTMLSelectElement;
      expect(select.getAttribute("aria-invalid")).toBe("true");
      expect(container.textContent).toContain("Elegí la moneda del costo.");
      await setField(container, "costCurrency", "EUR");
      expect(container.textContent).not.toContain("Elegí la moneda del costo.");
      await submit(container);
      expect(createTransport).toHaveBeenCalledWith(tripId, destinationId, expect.objectContaining({ costPerPerson: 120, costCurrency: "EUR" }));
    });

    it("saves a transport without cost and without currency", async () => {
      const { container, createTransport } = await render();
      await fillRoute(container);
      await submit(container);
      expect(createTransport).toHaveBeenCalledWith(tripId, destinationId, expect.objectContaining({ costPerPerson: null, costCurrency: null }));
    });

    it("flags a previous cost without currency, leaves the select empty and blocks until one is chosen", async () => {
      const { container, updateTransport } = await render(previous);
      expect(container.textContent).toContain("Moneda sin indicar");
      const notice = Array.from(container.querySelectorAll('[role="status"]')).find((item) => item.textContent?.includes("Moneda sin indicar"))!;
      expect(notice).toBeDefined();
      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(notice.id).not.toBe("");
      expect(container.querySelector('[name="costCurrency"]')?.getAttribute("aria-describedby")).toContain(notice.id);
      expect(container.querySelector('[name="costCurrency"]')).toHaveProperty("value", "");
      await submit(container);
      expect(updateTransport).not.toHaveBeenCalled();
      expect(container.querySelector('[name="costCurrency"]')?.getAttribute("aria-invalid")).toBe("true");
      await setField(container, "costCurrency", "USD");
      await submit(container);
      expect(updateTransport).toHaveBeenCalledWith(tripId, destinationId, transportId, expect.objectContaining({ costPerPerson: 150, costCurrency: "USD" }));
    });

    it("does not flag a record that already has a currency or no cost", async () => {
      const first = await render(saved);
      expect(first.container.textContent).not.toContain("Moneda sin indicar");
      expect(first.container.querySelector('[name="costCurrency"]')).toHaveProperty("value", "ARS");
      const second = await render({ ...saved, costPerPerson: null, costCurrency: null });
      expect(second.container.textContent).not.toContain("Moneda sin indicar");
    });

    it("shows a server currency error next to the select", async () => {
      const { container, createTransport } = await render();
      await fillRoute(container);
      await setField(container, "costPerPerson", "10");
      await setField(container, "costCurrency", "USD");
      createTransport.mockResolvedValueOnce({ ok: false, error: { kind: "validation", fields: [{ field: "costCurrency", message: "Moneda inválida." }] } });
      await submit(container);
      expect(container.textContent).toContain("Moneda inválida.");
      expect(container.querySelector('[name="costCurrency"]')?.getAttribute("aria-invalid")).toBe("true");
    });

    it("keeps the draft after a network failure and when switching type back and forth", async () => {
      const { container, createTransport } = await render();
      await fillRoute(container);
      await setField(container, "costPerPerson", "75");
      await setField(container, "costCurrency", "EUR");
      createTransport.mockRejectedValueOnce(new Error("offline"));
      await submit(container);
      expect(container.querySelector('[role="alert"]')?.textContent).toContain("No pudimos guardar");
      expect(container.querySelector('[name="costPerPerson"]')).toHaveProperty("value", "75");
      expect(container.querySelector('[name="costCurrency"]')).toHaveProperty("value", "EUR");
      await setField(container, "type", "car");
      await setField(container, "type", "bus_long");
      expect(container.querySelector('[name="costPerPerson"]')).toHaveProperty("value", "75");
      expect(container.querySelector('[name="costCurrency"]')).toHaveProperty("value", "EUR");
      await submit(container);
      expect(createTransport).toHaveBeenLastCalledWith(tripId, destinationId, expect.objectContaining({ type: "bus_long", costPerPerson: 75, costCurrency: "EUR" }));
    });
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

describe("TransportForm cost amounts", () => {
  const costField = (container: HTMLElement) => container.querySelector('[name="costPerPerson"]') as HTMLInputElement;
  it("uses a text field with decimal keyboard", async () => {
    const { container } = await render();
    expect(costField(container).type).toBe("text");
    expect(costField(container).getAttribute("inputmode")).toBe("decimal");
    expect(container.textContent).toContain("999.999.999.999,99");
  });
  it.each([["0", "Ingresá un costo mayor a cero"], ["1000000000000", "El costo no puede superar 999.999.999.999,99"]])("does not send %s and shows the error on the field", async (cost, message) => {
    const { container, createTransport } = await render();
    await fillRoute(container);
    await setField(container, "costPerPerson", cost);
    await setField(container, "costCurrency", "ARS");
    await submit(container);
    expect(createTransport).not.toHaveBeenCalled();
    expect(costField(container).getAttribute("aria-invalid")).toBe("true");
    expect(container.textContent).toContain(message);
    expect(costField(container).value).toBe(cost);
  });
  it.each([["exceeds_max", "El costo no puede superar 999.999.999.999,99"], ["invalid", "Ingresá un costo mayor a cero"]])("shows a 422 %s on the field, keeps values and allows retrying", async (code, message) => {
    const { container, createTransport } = await render();
    await fillRoute(container);
    await setField(container, "costPerPerson", "120");
    await setField(container, "costCurrency", "ARS");
    createTransport.mockResolvedValueOnce({ ok: false, error: { kind: "validation", fields: [{ field: "costPerPerson", code, message: "raw" }] } });
    await submit(container);
    expect(costField(container).getAttribute("aria-invalid")).toBe("true");
    expect(container.textContent).toContain(message);
    expect(costField(container).value).toBe("120");
    await submit(container);
    expect(createTransport).toHaveBeenCalledTimes(2);
  });
});

describe("TransportForm: causa del fallo de red al guardar (T150)", () => {
  const save = async (error: { kind: string; code?: string }) => {
    const { container, createTransport } = await render();
    createTransport.mockResolvedValue({ ok: false, error });
    await fillRoute(container);
    await submit(container);
    return container;
  };
  it("un timeout tiene su propio texto", async () => {
    const container = await save({ kind: "network", code: "TimeoutError" });
    expect(container.textContent).toContain("La conexión tardó demasiado. Intentá nuevamente.");
    expect(container.textContent).not.toContain("No pudimos guardar el transporte");
  });
  it("una conexión caída conserva el texto de siempre", async () => {
    const container = await save({ kind: "network", code: "NetworkError" });
    expect(container.textContent).toContain("No pudimos guardar el transporte. Intentá nuevamente.");
    expect(container.textContent).not.toContain("tardó demasiado");
  });
});
