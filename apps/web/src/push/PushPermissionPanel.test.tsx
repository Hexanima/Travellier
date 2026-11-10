// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PushPermissionPanel } from "./PushPermissionPanel.js";
import type { PushStatus } from "./push-device-service.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  document.body.replaceChildren();
});
const render = async (status: PushStatus, handlers: { onEnable?: () => void; onDismiss?: () => void } = {}) => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const onEnable = handlers.onEnable ?? vi.fn();
  const update = async (next: PushStatus) => act(async () => root.render(<PushPermissionPanel status={next} onEnable={onEnable} {...(handlers.onDismiss ? { onDismiss: handlers.onDismiss } : {})} />));
  await update(status);
  return { container, onEnable, update };
};
const button = (container: HTMLElement, label: string) => Array.from(container.querySelectorAll("button")).find((item) => item.textContent === label);
const click = async (element: Element | undefined) => { expect(element).toBeDefined(); await act(async () => { element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); }); };

describe("PushPermissionPanel", () => {
  it("renders nothing when unsupported", async () => {
    const { container } = await render({ state: "unsupported" });
    expect(container.innerHTML).toBe("");
  });
  it("off: optional message and a single enable action", async () => {
    const { container, onEnable } = await render({ state: "off" });
    expect(container.textContent).toContain("Activá los avisos para enterarte de cambios en tus viajes. Es opcional: podés usar Travellier sin ellos.");
    expect(container.querySelector("[role=dialog], dialog")).toBeNull();
    await click(button(container, "Activar avisos"));
    expect(onEnable).toHaveBeenCalledTimes(1);
  });
  it.each(["requesting", "registering"] as const)("%s: the button is busy and cannot be pressed again", async (state) => {
    const { container, onEnable } = await render({ state });
    const busy = container.querySelector("button");
    expect(busy?.disabled).toBe(false);
    expect(busy?.getAttribute("aria-disabled")).toBe("true");
    expect(busy?.getAttribute("aria-busy")).toBe("true");
    expect(busy?.textContent).toBe("Activando…");
    await click(busy ?? undefined);
    expect(onEnable).not.toHaveBeenCalled();
  });
  it("registered: confirms without exposing anything but the confirmation", async () => {
    const { container } = await render({ state: "registered", tokenHint: "****1111" });
    expect(container.textContent).toContain("Avisos activados en este dispositivo.");
    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).not.toContain("SENTINEL");
  });
  it("denied: explains that the app keeps working, with no permission button and no settings button", async () => {
    const { container } = await render({ state: "denied" });
    expect(container.textContent).toContain("Los avisos están desactivados para Travellier. Seguís viendo tus viajes, tus actividades y «Modificado» dentro de la app. Para activarlos, abrí Ajustes del sistema > Notificaciones > Travellier.");
    expect(container.querySelector("button")).toBeNull();
  });
  it("error: generic message and retry", async () => {
    const { container, onEnable } = await render({ state: "error" });
    expect(container.textContent).toContain("No pudimos activar los avisos. Podés reintentar; el resto de la app funciona igual.");
    await click(button(container, "Reintentar"));
    expect(onEnable).toHaveBeenCalledTimes(1);
  });
  it("keeps the same enable button mounted and focused while requesting and registering", async () => {
    const { container, update } = await render({ state: "off" });
    const original = container.querySelector("button")!;
    original.focus();
    expect(document.activeElement).toBe(original);
    for (const state of ["requesting", "registering"] as const) {
      await update({ state });
      expect(container.querySelector("button")).toBe(original);
      expect(document.activeElement).toBe(original);
      expect(original.getAttribute("aria-disabled")).toBe("true");
    }
  });
  it("has one persistent status region that announces the final states and no alert", async () => {
    const { container, update } = await render({ state: "off" });
    const region = container.querySelector("[role=status]");
    expect(region).not.toBeNull();
    for (const [status, text] of [
      [{ state: "registered", tokenHint: "****1111" }, "Avisos activados en este dispositivo."],
      [{ state: "denied" }, "Los avisos están desactivados"],
      [{ state: "error" }, "No pudimos activar los avisos."],
    ] as const) {
      await update(status);
      expect(container.querySelectorAll("[role=status]")).toHaveLength(1);
      expect(container.querySelector("[role=status]")).toBe(region);
      expect(region?.textContent).toContain(text);
      expect(container.querySelector("[role=alert], [aria-live]")).toBeNull();
    }
  });
  it("when the pressed button disappears (registered) the focus moves into the panel instead of body", async () => {
    const { container, update } = await render({ state: "off" });
    await click(button(container, "Activar avisos"));
    container.querySelector("button")!.focus();
    await update({ state: "requesting" });
    await update({ state: "registered", tokenHint: "****1111" });
    expect(document.activeElement).not.toBe(document.body);
    expect(container.contains(document.activeElement)).toBe(true);
  });
  it("Ahora no also exists in the denied state when onDismiss is given", async () => {
    const onDismiss = vi.fn();
    const denied = await render({ state: "denied" }, { onDismiss });
    await click(button(denied.container, "Ahora no"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
  it("Ahora no only exists with onDismiss and in the off state, and calls nothing else", async () => {
    const onDismiss = vi.fn();
    const withDismiss = await render({ state: "off" }, { onDismiss });
    await click(button(withDismiss.container, "Ahora no"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(withDismiss.onEnable).not.toHaveBeenCalled();
    const without = await render({ state: "off" });
    expect(button(without.container, "Ahora no")).toBeUndefined();
    const registered = await render({ state: "registered", tokenHint: "****1111" }, { onDismiss });
    expect(button(registered.container, "Ahora no")).toBeUndefined();
  });
});
