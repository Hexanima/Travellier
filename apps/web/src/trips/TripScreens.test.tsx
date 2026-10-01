// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CreateTripScreen, TripsListScreen } from "./TripScreens.js";
import type { TripManagementApi, TripResult, TripSummary } from "./trip-management-api.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const trip = {
  id: "507f191e810c19729de860ea",
  name: "Patagonia",
  description: "Lagos",
  primaryDestination: { name: "Bariloche" },
};
const roots: ReturnType<typeof createRoot>[] = [];

afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  document.body.replaceChildren();
});

async function renderTrips(trips: Pick<TripManagementApi, "list" | "create">, path = "/trips") {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/trips" element={<TripsListScreen trips={trips} onLocalLogout={async () => undefined} />} />
        <Route path="/trips/new" element={<CreateTripScreen trips={trips} />} />
      </Routes>
    </MemoryRouter>,
  ));
  return container;
}

const setValue = async (field: Element | null, value: string) => {
  await act(async () => {
    const input = field as HTMLInputElement | HTMLTextAreaElement;
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

describe("Trip screens", () => {
  it("shows the user's Trips and their primary destinations", async () => {
    const list = vi.fn().mockResolvedValue({ ok: true, value: [trip] });
    const container = await renderTrips({ list, create: vi.fn() });

    expect(list).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Patagonia");
    expect(container.textContent).toContain("Bariloche");
    expect(container.querySelector('a[href="/trips/new"]')).not.toBeNull();
    expect(container.querySelector('a[href="/trips/join"]')).not.toBeNull();
    expect(container.querySelector(`a[href="/trips/${trip.id}/members"]`)).not.toBeNull();
    expect(container.querySelector(`a[href="/trips/${trip.id}/config"]`)).not.toBeNull();
  });

  it("shows an empty state with a creation action", async () => {
    const container = await renderTrips({ list: vi.fn().mockResolvedValue({ ok: true, value: [] }), create: vi.fn() });

    expect(container.textContent).toContain("Todavía no tenés viajes");
    expect(container.querySelector('a[href="/trips/new"]')).not.toBeNull();
    expect(container.querySelector('a[href="/trips/join"]')).not.toBeNull();
  });

  it("shows a loading error and retries", async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: { kind: "network" } })
      .mockResolvedValueOnce({ ok: true, value: [trip] });
    const container = await renderTrips({ list, create: vi.fn() });

    expect(container.getAttribute("role")).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("No pudimos cargar tus viajes");
    await act(async () => container.querySelector("button")?.click());
    expect(list).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Patagonia");
  });

  it("validates required fields without sending a request or asking for dates", async () => {
    const create = vi.fn();
    const container = await renderTrips({ list: vi.fn(), create }, "/trips/new");

    expect(container.querySelector('input[type="date"], input[type="datetime-local"]')).toBeNull();
    await act(async () => container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(create).not.toHaveBeenCalled();
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(2);
  });

  it("creates a Trip and reloads the list so it becomes visible", async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: [] })
      .mockResolvedValueOnce({ ok: true, value: [trip] });
    const create = vi.fn().mockResolvedValue({ ok: true, value: trip });
    const container = await renderTrips({ list, create });
    expect(container.textContent).toContain("Todavía no tenés viajes");
    await act(async () => container.querySelector('a[href="/trips/new"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));

    await setValue(container.querySelector('[name="name"]'), " Patagonia ");
    await setValue(container.querySelector('[name="primaryDestination"]'), " Bariloche ");
    await setValue(container.querySelector('[name="description"]'), " Lagos ");
    await act(async () => container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

    expect(create).toHaveBeenCalledWith({ name: "Patagonia", primaryDestination: "Bariloche", description: "Lagos" });
    expect(list).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Patagonia");
    expect(container.textContent).toContain("Bariloche");
  });

  it("omits an empty optional description", async () => {
    const create = vi.fn().mockResolvedValue({ ok: true, value: trip });
    const container = await renderTrips({ list: vi.fn().mockResolvedValue({ ok: true, value: [trip] }), create }, "/trips/new");

    await setValue(container.querySelector('[name="name"]'), "Patagonia");
    await setValue(container.querySelector('[name="primaryDestination"]'), "Bariloche");
    await act(async () => container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

    expect(create).toHaveBeenCalledWith({ name: "Patagonia", primaryDestination: "Bariloche" });
  });

  it("keeps form values and shows field errors after a rejected creation", async () => {
    const create = vi.fn().mockResolvedValue({ ok: false, error: {
      kind: "validation", fields: [{ field: "primaryDestination", message: "Primary destination is required." }],
    } });
    const container = await renderTrips({ list: vi.fn(), create }, "/trips/new");
    await setValue(container.querySelector('[name="name"]'), "Patagonia");
    await setValue(container.querySelector('[name="primaryDestination"]'), "Bariloche");
    await act(async () => container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

    expect(container.querySelector('[name="name"]')).toHaveProperty("value", "Patagonia");
    expect(container.querySelector('[name="primaryDestination"][aria-invalid="true"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("destino");
  });

  it("prevents a second submission while creation is pending", async () => {
    let resolveCreate: (value: TripResult<TripSummary>) => void = () => undefined;
    const create = vi.fn(() => new Promise<TripResult<TripSummary>>((resolve) => { resolveCreate = resolve; }));
    const container = await renderTrips({ list: vi.fn().mockResolvedValue({ ok: true, value: [trip] }), create }, "/trips/new");
    await setValue(container.querySelector('[name="name"]'), "Patagonia");
    await setValue(container.querySelector('[name="primaryDestination"]'), "Bariloche");

    await act(async () => { container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(container.querySelector('button[type="submit"]')).toHaveProperty("disabled", true);
    await act(async () => { container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(create).toHaveBeenCalledOnce();
    await act(async () => resolveCreate({ ok: true, value: trip }));
  });
});
