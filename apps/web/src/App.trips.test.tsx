// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App.js";
import type { NativeSessionStorage } from "./auth/native-session-storage.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  document.body.replaceChildren();
});

const storage = (session: boolean): NativeSessionStorage => ({
  read: vi.fn().mockResolvedValue(session ? { accessToken: "access", refreshToken: "refresh" } : null),
  save: vi.fn().mockResolvedValue(undefined),
  clear: vi.fn().mockResolvedValue(undefined),
});

const tripId = "507f191e810c19729de860ea";
const memberTrip = {
  kind: "member", id: tripId, name: "Patagonia", description: null,
  primaryDestination: { name: "Bariloche" }, visibility: "private",
  votingEnabled: false, expenseMode: "register",
};

async function render(path: string, session: boolean, trips: Record<string, unknown>) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(
    <MemoryRouter initialEntries={[path]}>
      <App
        auth={{ refresh: vi.fn().mockResolvedValue({ ok: true, value: { accessToken: "new", refreshToken: "new-refresh" } }) }}
        sessionStorage={storage(session)}
        trips={trips as never}
      />
    </MemoryRouter>,
  ));
  return container;
}

describe("App Trip routes", () => {
  it("guards the Trip list without requesting private data before login", async () => {
    const list = vi.fn();
    const container = await render("/trips", false, { list });

    expect(container.textContent).toContain("Iniciar sesión");
    expect(container.textContent).not.toContain("Mis viajes");
    expect(list).not.toHaveBeenCalled();
  });

  it("loads the list after restoring a session", async () => {
    const list = vi.fn().mockResolvedValue({ ok: true, value: [] });
    const container = await render("/trips", true, { list });

    expect(list).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Mis viajes");
    expect(container.textContent).toContain("Todavía no tenés viajes");
  });

  it("opens the creation screen only for a signed-in user", async () => {
    const create = vi.fn();
    const publicView = await render("/trips/new", false, { create });
    expect(publicView.textContent).toContain("Iniciar sesión");
    expect(create).not.toHaveBeenCalled();

    const privateView = await render("/trips/new", true, { create });
    expect(privateView.textContent).toContain("Crear viaje");
    expect(privateView.querySelector('[name="primaryDestination"]')).not.toBeNull();
    expect(privateView.querySelector('input[type="date"]')).toBeNull();
  });

  it("does not request Trip configuration before login", async () => {
    const get = vi.fn();
    const container = await render(`/trips/${tripId}/config`, false, { get });

    expect(container.textContent).toContain("Iniciar sesión");
    expect(get).not.toHaveBeenCalled();
  });

  it("loads member settings and persists them after reopening the screen", async () => {
    let stored = { ...memberTrip };
    const get = vi.fn(async () => ({ ok: true, value: { ...stored } }));
    const updateConfiguration = vi.fn(async (_id: string, input: Record<string, unknown>) => {
      stored = { ...stored, ...input };
      return { ok: true, value: { ...stored } };
    });
    const trips = { get, updateConfiguration };
    const first = await render(`/trips/${tripId}/config`, true, trips);

    expect(first.querySelector('[name="visibility"]')).toHaveProperty("value", "private");
    expect(first.querySelector('[name="votingEnabled"]')).toHaveProperty("value", "disabled");
    expect(first.querySelector('[name="expenseMode"]')).toHaveProperty("value", "register");
    await act(async () => {
      for (const [name, value] of [["visibility", "public"], ["votingEnabled", "enabled"], ["expenseMode", "balance"]]) {
        const select = first.querySelector(`[name="${name}"]`) as HTMLSelectElement;
        select.value = value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await act(async () => first.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

    expect(updateConfiguration).toHaveBeenCalledWith(tripId, { visibility: "public", votingEnabled: true, expenseMode: "balance" });
    expect(first.textContent).toContain("Configuración guardada");
    const second = await render(`/trips/${tripId}/config`, true, trips);
    expect(second.querySelector('[name="visibility"]')).toHaveProperty("value", "public");
    expect(second.querySelector('[name="votingEnabled"]')).toHaveProperty("value", "enabled");
    expect(second.querySelector('[name="expenseMode"]')).toHaveProperty("value", "balance");
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("shows a public preview without editing controls", async () => {
    const get = vi.fn().mockResolvedValue({ ok: true, value: {
      kind: "public", id: tripId, name: "Patagonia", description: null,
      primaryDestination: { name: "Bariloche" }, visibility: "public",
    } });
    const updateConfiguration = vi.fn();
    const container = await render(`/trips/${tripId}/config`, true, { get, updateConfiguration });

    expect(container.textContent).toContain("Patagonia");
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector('[name="visibility"]')).toBeNull();
    expect(updateConfiguration).not.toHaveBeenCalled();
  });

  it("keeps edited settings after a failed save and offers retry", async () => {
    const get = vi.fn().mockResolvedValue({ ok: true, value: memberTrip });
    const updateConfiguration = vi.fn().mockResolvedValue({ ok: false, error: { kind: "network" } });
    const container = await render(`/trips/${tripId}/config`, true, { get, updateConfiguration });
    await act(async () => {
      const select = container.querySelector('[name="expenseMode"]') as HTMLSelectElement;
      select.value = "balance";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

    expect(container.querySelector('[name="expenseMode"]')).toHaveProperty("value", "balance");
    expect(container.textContent).toContain("No pudimos guardar");
    expect(updateConfiguration).toHaveBeenCalledOnce();
  });

  it("hides configuration controls if membership is lost before saving", async () => {
    const get = vi.fn().mockResolvedValue({ ok: true, value: memberTrip });
    const updateConfiguration = vi.fn().mockResolvedValue({ ok: false, error: { kind: "not-found" } });
    const container = await render(`/trips/${tripId}/config`, true, { get, updateConfiguration });
    await act(async () => container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).toContain("No encontramos este viaje");
  });

  it("explains the effect of changing voting and expense modes before saving", async () => {
    const get = vi.fn().mockResolvedValue({ ok: true, value: { ...memberTrip, votingEnabled: true } });
    const container = await render(`/trips/${tripId}/config`, true, { get });
    await act(async () => {
      const voting = container.querySelector('[name="votingEnabled"]') as HTMLSelectElement;
      voting.value = "disabled";
      voting.dispatchEvent(new Event("change", { bubbles: true }));
      const expenses = container.querySelector('[name="expenseMode"]') as HTMLSelectElement;
      expenses.value = "balance";
      expenses.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(container.textContent).toContain("actividades existentes");
    expect(container.textContent).toContain("gastos anteriores se conservan");
  });
});
