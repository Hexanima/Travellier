// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TripConfigurationScreen } from "./TripConfigurationScreen.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tripId = "507f191e810c19729de860ea";
const me = "507f1f77bcf86cd799439011";
const other = "507f1f77bcf86cd799439012";
const trip = { kind: "member", id: tripId, name: "Patagonia", description: null, primaryDestination: { name: "Bariloche" }, visibility: "private", expenseMode: "register" };
const listing = (role: "admin" | "participant") => ({ ok: true, value: { currentUserId: me, ownerId: other, members: [
  { id: "m1", userId: other, name: "Nico", role: "admin", isOwner: true, joinedAt: "2026-09-24T12:00:00.000Z" },
  { id: "m2", userId: me, name: "Yo", role, isOwner: false, joinedAt: "2026-09-24T12:00:00.000Z" },
] } });
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });

type Mocks = { get?: ReturnType<typeof vi.fn>; update?: ReturnType<typeof vi.fn>; list?: ReturnType<typeof vi.fn> };
async function mount(role: "admin" | "participant" | "unknown", mocks: Mocks = {}) {
  const get = mocks.get ?? vi.fn().mockResolvedValue({ ok: true, value: trip });
  const updateConfiguration = mocks.update ?? vi.fn().mockImplementation(async (_id: string, input: object) => ({ ok: true, value: { ...trip, ...input } }));
  const list = mocks.list ?? (role === "unknown" ? vi.fn().mockResolvedValue({ ok: false, error: { kind: "network" } }) : vi.fn().mockResolvedValue(listing(role)));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={[`/trips/${tripId}/config`]}><Routes>
    <Route path="/trips/:tripId/config" element={<TripConfigurationScreen trips={{ get, updateConfiguration } as never} members={{ list } as never} />} />
  </Routes></MemoryRouter>));
  return { container, get, updateConfiguration, list };
}
const change = (container: HTMLElement, name: string, value: string) => act(async () => {
  const select = container.querySelector(`[name="${name}"]`) as HTMLSelectElement;
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
});
const submit = (container: HTMLElement) => act(async () => container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
const note = "Solo los administradores pueden cambiarlo";

describe("Trip configuration: roles", () => {
  it("admin or owner edits the expense mode and sends only it", async () => {
    const { container, updateConfiguration } = await mount("admin");
    expect(container.querySelector('[name="expenseMode"]')).not.toBeNull();
    expect(container.textContent).not.toContain(note);
    await change(container, "expenseMode", "balance");
    await submit(container);
    expect(updateConfiguration).toHaveBeenCalledExactlyOnceWith(tripId, { expenseMode: "balance" });
    expect(container.textContent).toContain("Configuración guardada");
    expect(container.querySelector('[name="expenseMode"]')).toHaveProperty("value", "balance");
  });
  it("sends only visibility when only it changed", async () => {
    const { container, updateConfiguration } = await mount("admin");
    await change(container, "visibility", "public");
    await submit(container);
    expect(updateConfiguration).toHaveBeenCalledExactlyOnceWith(tripId, { visibility: "public" });
  });
  it("sends both when both changed", async () => {
    const { container, updateConfiguration } = await mount("admin");
    await change(container, "visibility", "public");
    await change(container, "expenseMode", "balance");
    await submit(container);
    expect(updateConfiguration).toHaveBeenCalledExactlyOnceWith(tripId, { visibility: "public", expenseMode: "balance" });
  });
  it("does not call the API without changes and says so", async () => {
    const { container, updateConfiguration } = await mount("admin");
    await submit(container);
    expect(updateConfiguration).not.toHaveBeenCalled();
    expect(container.textContent).toContain("No hay cambios para guardar.");
    expect(container.textContent).not.toContain("Configuración guardada");
  });
  it("participant sees the mode as text with the note and has no mode select", async () => {
    const { container } = await mount("participant");
    expect(container.querySelector('[name="expenseMode"]')).toBeNull();
    expect(container.querySelector('[name="visibility"]')).not.toBeNull();
    expect(container.textContent).toContain("Modo de gastos");
    expect(container.textContent).toContain("Solo registro");
    expect(container.textContent).toContain(note);
    expect(container.textContent).not.toMatch(/pagad|cobrad|liquidad|saldad/i);
  });
  it("participant changes visibility and sends only it", async () => {
    const { container, updateConfiguration } = await mount("participant");
    await change(container, "visibility", "public");
    await submit(container);
    expect(updateConfiguration).toHaveBeenCalledExactlyOnceWith(tripId, { visibility: "public" });
    expect(container.textContent).toContain("Configuración guardada");
  });
  it("shows the balance mode as text for a participant", async () => {
    const { container } = await mount("participant", { get: vi.fn().mockResolvedValue({ ok: true, value: { ...trip, expenseMode: "balance" } }) });
    expect(container.textContent).toContain("Con balance");
  });
  it("an unknown role (members fail) is read-only and never editable by default", async () => {
    const { container, list } = await mount("unknown");
    expect(list).toHaveBeenCalledWith(tripId);
    expect(container.querySelector('[name="expenseMode"]')).toBeNull();
    expect(container.textContent).toContain(note);
  });
  it("a 403 on save shows the message, reloads the role and falls back to read-only without success", async () => {
    const list = vi.fn().mockResolvedValueOnce(listing("admin")).mockResolvedValue(listing("participant"));
    const update = vi.fn().mockResolvedValue({ ok: false, error: { kind: "forbidden" } });
    const { container } = await mount("admin", { list, update });
    await change(container, "expenseMode", "balance");
    await submit(container);
    expect(update).toHaveBeenCalledExactlyOnceWith(tripId, { expenseMode: "balance" });
    expect(list).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Ya no tenés permiso para cambiar el modo de gastos. No se guardó ningún cambio.");
    expect(container.textContent).not.toContain("Configuración guardada");
    expect(container.querySelector('[name="expenseMode"]')).toBeNull();
    expect(container.textContent).toContain("Solo registro");
    expect(container.textContent).toContain(note);
  });
  it("a 403 keeps the edited visibility and discards only the pending mode", async () => {
    const list = vi.fn().mockResolvedValueOnce(listing("admin")).mockResolvedValue(listing("participant"));
    const update = vi.fn().mockResolvedValue({ ok: false, error: { kind: "forbidden" } });
    const { container } = await mount("admin", { list, update });
    await change(container, "visibility", "public");
    await change(container, "expenseMode", "balance");
    await submit(container);
    expect(update).toHaveBeenCalledExactlyOnceWith(tripId, { visibility: "public", expenseMode: "balance" });
    expect(container.querySelector('[name="visibility"]')).toHaveProperty("value", "public");
    expect(container.querySelector('[name="expenseMode"]')).toBeNull();
    expect(container.textContent).toContain("No se guardó ningún cambio.");
  });
  it("editing a field clears the «no changes» notice", async () => {
    const { container } = await mount("admin");
    await submit(container);
    expect(container.textContent).toContain("No hay cambios para guardar.");
    await change(container, "visibility", "public");
    expect(container.textContent).not.toContain("No hay cambios para guardar.");
  });
  it("editing a field clears the permission notice", async () => {
    const list = vi.fn().mockResolvedValueOnce(listing("admin")).mockResolvedValue(listing("participant"));
    const update = vi.fn().mockResolvedValue({ ok: false, error: { kind: "forbidden" } });
    const { container } = await mount("admin", { list, update });
    await change(container, "expenseMode", "balance");
    await submit(container);
    expect(container.textContent).toContain("Ya no tenés permiso");
    await change(container, "visibility", "public");
    expect(container.textContent).not.toContain("Ya no tenés permiso");
  });
  it("editing the mode clears the «no changes» notice", async () => {
    const { container } = await mount("admin");
    await submit(container);
    await change(container, "expenseMode", "balance");
    expect(container.textContent).not.toContain("No hay cambios para guardar.");
  });
});
