// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TripJourneyScreen } from "./TripJourneyScreen.js";
import type { TripJourneyApi } from "./trip-journey-api.js";
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

async function render(options: { trip?: unknown; destinations?: unknown; loadFailure?: boolean } = {}) {
  const get = vi.fn().mockResolvedValue({ ok: true, value: options.trip ?? trip });
  const listDestinations = vi.fn().mockResolvedValue(options.loadFailure
    ? { ok: false, error: { kind: "network" } }
    : { ok: true, value: options.destinations ?? [first] });
  const listTransports = vi.fn().mockResolvedValue({ ok: true, value: [] });
  const createDestination = vi.fn().mockResolvedValue({ ok: true, value: second });
  const journey = { listDestinations, listTransports, createDestination,
    createTransport: vi.fn(), updateTransport: vi.fn() } as unknown as TripJourneyApi;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={[`/trips/${tripId}/journey`]}>
    <Routes><Route path="/trips/:tripId/journey" element={<TripJourneyScreen trips={{ get } as unknown as TripManagementApi}
      journey={journey} />} /></Routes>
  </MemoryRouter>));
  return { container, get, listDestinations, listTransports, createDestination };
}

describe("TripJourneyScreen", () => {
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
