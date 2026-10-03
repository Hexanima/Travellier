// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TripJourneyScreen } from "./TripJourneyScreen.js";
import type { JourneyTransport, TransportInput, TripJourneyApi } from "./trip-journey-api.js";
import type { TripManagementApi } from "./trip-management-api.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tripId = "507f191e810c19729de860ea";
const first = { id: "507f1f77bcf86cd799439013", tripId, name: "Bariloche", order: 1, createdAt: "2026-09-24T12:00:00.000Z" };
const second = { id: "507f1f77bcf86cd799439015", tripId, name: "Córdoba", order: 2, createdAt: "2026-09-24T12:00:00.000Z" };
const trip = { kind: "member", id: tripId, name: "Patagonia", description: null,
  primaryDestination: { name: "Bariloche" }, visibility: "private", inviteCode: "VIAJE-X7K2",
  votingEnabled: false, expenseMode: "register" };
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  document.body.replaceChildren();
});

async function render(options: { trip?: unknown; destinations?: unknown; loadFailure?: boolean; transports?: JourneyTransport[] } = {}) {
  const get = vi.fn().mockResolvedValue({ ok: true, value: options.trip ?? trip });
  const listDestinations = vi.fn().mockResolvedValue(options.loadFailure
    ? { ok: false, error: { kind: "network" } }
    : { ok: true, value: options.destinations ?? [first] });
  const listTransports = vi.fn(async (_tripId: string, destinationId: string) => ({
    ok: true, value: (options.transports ?? []).filter((transport) => transport.destinationId === destinationId),
  }));
  const createDestination = vi.fn().mockResolvedValue({ ok: true, value: second });
  const updateTransport = vi.fn(async (_tripId: string, destinationId: string, id: string, input: TransportInput) => ({
    ok: true, value: { ...input, id, tripId, destinationId },
  }));
  const journey = { listDestinations, listTransports, createDestination,
    createTransport: vi.fn(), updateTransport } as unknown as TripJourneyApi;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={[`/trips/${tripId}/journey`]}>
    <Routes><Route path="/trips/:tripId/journey" element={<TripJourneyScreen trips={{ get } as unknown as TripManagementApi}
      journey={journey} />} /></Routes>
  </MemoryRouter>));
  return { container, get, listDestinations, listTransports, createDestination, updateTransport };
}

describe("TripJourneyScreen", () => {
  it("blocks conflicts with ordered neighbors in either direction and uses their latest saved times", async () => {
    const transports: JourneyTransport[] = [first, second].flatMap((destination) =>
      (["outbound", "return"] as const).map((direction, index) => ({
        id: `${destination.id.slice(0, -1)}${destination.order * 2 + index + 4}`, tripId, destinationId: destination.id, direction, type: "car",
        departurePlace: "A", arrivalPlace: "B", costPerPerson: null, details: {},
        departureAt: new Date(destination === first
          ? (direction === "outbound" ? "2026-10-10T08:00" : "2026-10-12T12:00")
          : (direction === "outbound" ? "2026-10-12T13:00" : "2026-10-14T12:00")).toISOString(),
        arrivalAt: new Date(destination === first
          ? (direction === "outbound" ? "2026-10-10T10:00" : "2026-10-12T14:00")
          : (direction === "outbound" ? "2026-10-12T15:00" : "2026-10-14T14:00")).toISOString(),
      })));
    const { container, updateTransport } = await render({ destinations: [second, first], transports });
    const forms = container.querySelectorAll<HTMLFormElement>("form.journey-transport-form");
    const change = async (form: HTMLFormElement, name: string, value: string) => act(async () => {
      const input = form.querySelector(`[name="${name}"]`) as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const submit = async (form: HTMLFormElement) => act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    await change(forms[2], "departureAt", "2026-10-11T08:00");
    await change(forms[2], "arrivalAt", "2026-10-11T10:00");
    await submit(forms[2]);
    expect(updateTransport).not.toHaveBeenCalled();
    expect(forms[2].textContent).toContain("La llegada no puede ser anterior a la salida del destino anterior.");
    expect(forms[2].querySelector('[name="arrivalAt"][aria-invalid="true"]')).not.toBeNull();

    await change(forms[2], "departureAt", "2026-10-12T10:00");
    await change(forms[2], "arrivalAt", "2026-10-12T12:00");
    await submit(forms[2]);
    expect(updateTransport).toHaveBeenCalledOnce();
    await change(forms[1], "departureAt", "2026-10-12T13:00");
    await submit(forms[1]);
    expect(updateTransport).toHaveBeenCalledOnce();
    expect(forms[1].textContent).toContain("La salida no puede ser posterior a la llegada al destino siguiente.");
    expect(forms[1].querySelector('[name="departureAt"][aria-invalid="true"]')).not.toBeNull();

    await change(forms[1], "departureAt", "2026-10-12T11:00");
    await submit(forms[1]);
    expect(updateTransport).toHaveBeenCalledTimes(2);
    await change(forms[2], "arrivalAt", "2026-10-12T10:30");
    await submit(forms[2]);
    expect(updateTransport).toHaveBeenCalledTimes(2);
    expect(forms[2].querySelector('[name="arrivalAt"][aria-invalid="true"]')).not.toBeNull();
  });

  it("uses the latest saved complementary transport when validating either form", async () => {
    const transports: JourneyTransport[] = (["outbound", "return"] as const).map((direction, index) => ({
      id: `507f1f77bcf86cd79943901${index + 6}`, tripId, destinationId: first.id, direction, type: "car",
      departurePlace: "A", arrivalPlace: "B", costPerPerson: null, details: {},
      departureAt: new Date(direction === "outbound" ? "2026-10-10T08:00" : "2026-10-10T12:00").toISOString(),
      arrivalAt: new Date(direction === "outbound" ? "2026-10-10T10:00" : "2026-10-10T14:00").toISOString(),
    }));
    const { container, updateTransport } = await render({ transports });
    const forms = container.querySelectorAll<HTMLFormElement>("form.journey-transport-form");
    const change = async (form: HTMLFormElement, name: string, value: string) => act(async () => {
      const input = form.querySelector(`[name="${name}"]`) as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const submit = async (form: HTMLFormElement) => act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await change(forms[0], "arrivalAt", "2026-10-10T13:00");
    await submit(forms[0]);
    expect(updateTransport).not.toHaveBeenCalled();
    expect(forms[0].querySelector('[name="arrivalAt"][aria-invalid="true"]')).not.toBeNull();

    await change(forms[0], "arrivalAt", "2026-10-10T11:00");
    await submit(forms[0]);
    expect(updateTransport).toHaveBeenCalledOnce();
    await change(forms[1], "departureAt", "2026-10-10T10:30");
    await submit(forms[1]);
    expect(updateTransport).toHaveBeenCalledOnce();
    expect(forms[1].querySelector('[name="departureAt"][aria-invalid="true"]')).not.toBeNull();
  });

  it("shows destinations in persisted order and both directions for each", async () => {
    const { container, listTransports } = await render({ destinations: [second, first] });
    const headings = Array.from(container.querySelectorAll("h2")).map((heading) => heading.textContent);
    expect(headings).toEqual(["Bariloche", "Córdoba", "Agregar destino"]);
    expect(container.querySelectorAll("form.journey-transport-form")).toHaveLength(4);
    expect(listTransports).toHaveBeenCalledWith(tripId, first.id);
    expect(listTransports).toHaveBeenCalledWith(tripId, second.id);
  });

  it("appends a destination without choosing an order manually", async () => {
    const { container, createDestination } = await render();
    const input = container.querySelector('[name="destinationName"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, " Córdoba ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => container.querySelector("form.journey-add-destination")?.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })));
    expect(createDestination).toHaveBeenCalledWith(tripId, "Córdoba");
    expect(Array.from(container.querySelectorAll("h2")).map((heading) => heading.textContent)).toEqual([
      "Bariloche", "Córdoba", "Agregar destino",
    ]);
  });

  it("does not expose forms to a non-member public preview", async () => {
    const { container, listDestinations } = await render({ trip: { ...trip, kind: "public" } });
    expect(container.textContent).toContain("integrantes");
    expect(container.querySelector("form")).toBeNull();
    expect(listDestinations).not.toHaveBeenCalled();
  });

  it("offers retry when loading destinations fails", async () => {
    const { container, listDestinations } = await render({ loadFailure: true });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("cargar");
    expect(container.querySelector("form")).toBeNull();
    listDestinations.mockResolvedValueOnce({ ok: true, value: [first] });
    await act(async () => Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Reintentar")?.click());
    expect(container.querySelectorAll("form.journey-transport-form")).toHaveLength(2);
  });
});
