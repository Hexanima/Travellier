// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CalendarSyncStatus } from "./calendar-sync-service.js";
import { CalendarSyncPanel } from "./CalendarSyncPanel.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });

type Props = Parameters<typeof CalendarSyncPanel>[0];
const handlers = () => ({ onEnable: vi.fn(), onRetry: vi.fn(), onStop: vi.fn(), onRemove: vi.fn(), onRestore: vi.fn() });
async function render(status: CalendarSyncStatus, props: Partial<Props> = {}) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  const spies = handlers();
  const view = (next: CalendarSyncStatus, extra: Partial<Props> = {}) => <CalendarSyncPanel status={next} busy={false} timeZone="America/Argentina/Buenos_Aires" {...spies} {...props} {...extra} />;
  await act(async () => root.render(view(status)));
  return { container, spies, rerender: (next: CalendarSyncStatus, extra: Partial<Props> = {}) => act(async () => root.render(view(next, extra))) };
}
const button = (container: HTMLElement, label: string) => Array.from(container.querySelectorAll("button")).find((item) => item.textContent === label);
const click = (element: Element) => act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
const every: CalendarSyncStatus[] = [{ state: "checking" }, { state: "off" }, { state: "needs-account" }, { state: "needs-permission" }, { state: "denied", limited: false },
  { state: "denied", limited: true }, { state: "syncing" }, { state: "pending" }, { state: "synced", at: "2026-11-10T15:30:00.000Z" }, { state: "partial", failed: 2, at: null }, { state: "error" },
  { state: "removing-partial", remaining: 1 }, { state: "denied", limited: false, enabled: true }];

describe("CalendarSyncPanel", () => {
  it("offers the opt-in as an optional action and says nothing else when off", async () => {
    const { container, spies } = await render({ state: "off" });
    expect(container.textContent).toContain("Es opcional");
    await click(button(container, "Mantener sincronizado con el calendario")!);
    expect(spies.onEnable).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it("always keeps one persistent status region and never more than one alert", async () => {
    for (const status of every) {
      const { container } = await render(status);
      expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
      expect(container.querySelectorAll('[role="alert"]').length).toBeLessThanOrEqual(1);
    }
  });
  it("uses aria-disabled, keeps focus and does not re-enter while busy", async () => {
    const { container, spies, rerender } = await render({ state: "off" });
    const enable = button(container, "Mantener sincronizado con el calendario")!;
    enable.focus();
    await rerender({ state: "off" }, { busy: true });
    const still = button(container, "Mantener sincronizado con el calendario")!;
    expect(still).toBe(enable);
    expect(still.hasAttribute("disabled")).toBe(false);
    expect(still.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(still);
    await click(still);
    expect(spies.onEnable).not.toHaveBeenCalled();
  });
  it("shows the last synchronization time in the given zone and the stop, restore and remove actions", async () => {
    const { container, spies } = await render({ state: "synced", at: "2026-11-10T15:30:00.000Z" });
    expect(container.querySelector('[role="status"]')?.textContent).toMatch(/Sincronizado con el calendario/);
    expect(container.querySelector('[role="status"]')?.textContent).toMatch(/12:30/);
    await click(button(container, "Dejar de sincronizar")!);
    expect(spies.onStop).toHaveBeenCalledTimes(1);
    await click(button(container, "Volver a agregar eventos borrados")!);
    expect(spies.onRestore).toHaveBeenCalledTimes(1);
    expect(spies.onRemove).not.toHaveBeenCalled();
  });
  it("tells, inside the persistent status and without an alert, how many duplicated or edited events were left untouched", async () => {
    const one = await render({ state: "synced", at: "2026-11-10T15:30:00.000Z", ignoredCopies: 1 });
    expect(one.container.querySelector('[role="status"]')?.textContent).toContain("Hay 1 evento duplicado o editado en tu calendario que no tocamos.");
    expect(one.container.querySelector('[role="alert"]')).toBeNull();
    const many = await render({ state: "synced", at: "2026-11-10T15:30:00.000Z", ignoredCopies: 3 });
    expect(many.container.querySelector('[role="status"]')?.textContent).toContain("Hay 3 eventos duplicados o editados en tu calendario que no tocamos.");
    const none = await render({ state: "synced", at: "2026-11-10T15:30:00.000Z" });
    expect(none.container.querySelector('[role="status"]')?.textContent).not.toContain("no tocamos");
  });
  it("asks for confirmation before removing the events from the calendar, and cancelling changes nothing", async () => {
    const { container, spies } = await render({ state: "synced", at: "2026-11-10T15:30:00.000Z" });
    await click(button(container, "Quitar del calendario")!);
    expect(spies.onRemove).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Se borrarán de tu calendario los eventos que creó Travellier para este viaje");
    await click(button(container, "Cancelar")!);
    expect(container.textContent).not.toContain("Se borrarán");
    expect(spies.onRemove).not.toHaveBeenCalled();
    await click(button(container, "Quitar del calendario")!);
    await click(button(container, "Quitar")!);
    expect(spies.onRemove).toHaveBeenCalledTimes(1);
  });
  it("explains denial with the system settings path and has no button for it, still pointing at the .ics export", async () => {
    const { container } = await render({ state: "denied", limited: false });
    expect(container.textContent).toContain("Ajustes del sistema");
    expect(container.textContent).toContain(".ics");
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
  it("explains write-only access (cannot update events) with the .ics alternative and no synchronized claim", async () => {
    const { container } = await render({ state: "denied", limited: true });
    expect(container.textContent).toMatch(/solo permiso para agregar/);
    expect(container.textContent).toContain(".ics");
    expect(container.textContent).not.toContain("Sincronizado con el calendario");
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
  it("on error has exactly one alert, a Retry action and the .ics alternative; partial offers retry too", async () => {
    const failed = await render({ state: "error" });
    expect(failed.container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(failed.container.querySelector('[role="alert"]')?.textContent).toContain(".ics");
    await click(button(failed.container, "Reintentar")!);
    expect(failed.spies.onRetry).toHaveBeenCalledTimes(1);
    const partial = await render({ state: "partial", failed: 2, at: null });
    expect(partial.container.textContent).toContain("2 eventos");
    expect(partial.container.textContent).not.toContain("Sincronizado con el calendario");
    await click(button(partial.container, "Reintentar")!);
    expect(partial.spies.onRetry).toHaveBeenCalledTimes(1);
  });
  it("asks for the permission again from the same action when it is still undecided", async () => {
    const { container, spies } = await render({ state: "needs-permission" });
    expect(container.textContent).toContain("acceso al calendario");
    await click(button(container, "Mantener sincronizado con el calendario")!);
    expect(spies.onEnable).toHaveBeenCalledTimes(1);
  });
  it("moves the focus to the panel when the pressed button disappears", async () => {
    const { container, rerender } = await render({ state: "off" });
    const enable = button(container, "Mantener sincronizado con el calendario")!;
    enable.focus();
    await click(enable);
    await rerender({ state: "denied", limited: false });
    expect(document.activeElement).toBe(container.querySelector(".calendar-sync"));
  });
  it("after a partial removal it offers «Reintentar quitar» and «Dejar de sincronizar», says how many are left and offers nothing else", async () => {
    const { container, spies } = await render({ state: "removing-partial", remaining: 2 });
    expect(container.querySelector('[role="status"]')?.textContent).toContain("2 eventos");
    expect(button(container, "Quitar del calendario")).toBeUndefined();
    expect(button(container, "Reintentar")).toBeUndefined();
    expect(button(container, "Mantener sincronizado con el calendario")).toBeUndefined();
    await click(button(container, "Reintentar quitar")!);
    expect(spies.onRemove).toHaveBeenCalledTimes(1);
    await click(button(container, "Dejar de sincronizar")!);
    expect(spies.onStop).toHaveBeenCalledTimes(1);
  });
  it("with the permission denied it offers «Dejar de sincronizar» only when sync was enabled, and never «Quitar del calendario»", async () => {
    const enabled = await render({ state: "denied", limited: false, enabled: true });
    await click(button(enabled.container, "Dejar de sincronizar")!);
    expect(enabled.spies.onStop).toHaveBeenCalledTimes(1);
    expect(button(enabled.container, "Quitar del calendario")).toBeUndefined();
    const never = await render({ state: "denied", limited: false, enabled: false });
    expect(button(never.container, "Dejar de sincronizar")).toBeUndefined();
    const unknown = await render({ state: "denied", limited: true });
    expect(button(unknown.container, "Dejar de sincronizar")).toBeUndefined();
  });
});
