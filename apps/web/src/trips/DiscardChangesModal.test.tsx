// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiscardChangesModal } from "./DiscardChangesModal.js";
import { BackNavigationProvider } from "../navigation/BackNavigationProvider.js";
import type { AppBackButton } from "../native/app-back-button.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });

function Where() { return <output data-where>{useLocation().pathname}</output>; }
const click = async (element: Element | null | undefined) => { expect(element).toBeTruthy(); await act(async () => element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }))); };
const named = (text: string) => Array.from(document.querySelectorAll("button")).find((item) => item.textContent === text);

async function render(node: React.ReactNode) {
  const listeners = new Set<() => void>();
  const exitApp = vi.fn();
  const port: AppBackButton = { onBack: (listener) => { listeners.add(listener); return () => listeners.delete(listener); }, exitApp };
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(
    <MemoryRouter initialEntries={["/trips/aaaaaaaaaaaaaaaaaaaaaaaa/memories/new/expense"]}>
      <BackNavigationProvider backButton={port}><Where />{node}</BackNavigationProvider>
    </MemoryRouter>,
  ));
  return { container, press: async () => { await act(async () => listeners.forEach((listener) => listener())); }, where: () => container.querySelector("[data-where]")?.textContent };
}

describe("DiscardChangesModal", () => {
  it("sin cambios el Atrás sale directo por la salida del formulario", async () => {
    const onDiscard = vi.fn();
    const view = await render(<DiscardChangesModal dirty={false} message="Si salís ahora, vas a perder los cambios de este gasto." onDiscard={onDiscard} />);
    await view.press();
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("con cambios el Atrás pide confirmación y no sale", async () => {
    const onDiscard = vi.fn();
    const view = await render(<DiscardChangesModal dirty message="Si salís ahora, vas a perder los cambios de este gasto." onDiscard={onDiscard} />);
    await view.press();
    expect(onDiscard).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe("Descartar cambios");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Si salís ahora, vas a perder los cambios de este gasto.");
    expect(view.where()).toBe("/trips/aaaaaaaaaaaaaaaaaaaaaaaa/memories/new/expense");
  });

  it("«Seguir editando» cierra la confirmación y deja el formulario", async () => {
    const onDiscard = vi.fn();
    const view = await render(<DiscardChangesModal dirty message="Perdés los cambios." onDiscard={onDiscard} />);
    await view.press();
    await click(named("Seguir editando"));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it("«Descartar» sale del formulario", async () => {
    const onDiscard = vi.fn();
    const view = await render(<DiscardChangesModal dirty message="Perdés los cambios." onDiscard={onDiscard} />);
    await view.press();
    await click(named("Descartar"));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("el Atrás sobre la confirmación abierta la cierra sin descartar", async () => {
    const onDiscard = vi.fn();
    const view = await render(<DiscardChangesModal dirty message="Perdés los cambios." onDiscard={onDiscard} />);
    await view.press();
    await view.press();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(onDiscard).not.toHaveBeenCalled();
    expect(view.where()).toBe("/trips/aaaaaaaaaaaaaaaaaaaaaaaa/memories/new/expense");
  });
});
