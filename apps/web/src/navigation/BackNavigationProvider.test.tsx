// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackNavigationProvider } from "./BackNavigationProvider.js";
import { useBackLayer } from "./back-layer-context.js";
import type { AppBackButton } from "../native/app-back-button.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });

const fakeButton = () => {
  const listeners = new Set<() => void>();
  const exitApp = vi.fn();
  const onBack = vi.fn((listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); });
  const port: AppBackButton = { onBack, exitApp };
  return { port, exitApp, onBack, count: () => listeners.size, press: async () => { await act(async () => listeners.forEach((listener) => listener())); } };
};

function Where() { const location = useLocation(); return <output data-where>{location.pathname}</output>; }
const where = () => document.querySelector("[data-where]")?.textContent;
const click = async (element: Element | null | undefined) => { expect(element).toBeTruthy(); await act(async () => element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }))); };
const named = (text: string) => Array.from(document.querySelectorAll("button")).find((item) => item.textContent === text);

/** A screen with an optional dialog and, inside it, an optional confirmation: two nested layers. */
function Screen({ saving = false }: { saving?: boolean }) {
  const [open, setOpen] = useState(false);
  useBackLayer(open, () => { if (saving) return true; setOpen(false); return true; });
  return <>
    <button onClick={() => setOpen(true)}>Abrir</button>
    {open ? <Inner /> : null}
    <output data-open>{open ? "abierto" : "cerrado"}</output>
  </>;
}
function Inner() {
  const [confirming, setConfirming] = useState(false);
  useBackLayer(confirming, () => setConfirming(false));
  return <>
    <button onClick={() => setConfirming(true)}>Confirmar</button>
    <output data-confirm>{confirming ? "confirmando" : "sin confirmar"}</output>
  </>;
}

async function render(entries: string[], node: React.ReactNode, button?: AppBackButton) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <BackNavigationProvider backButton={button}>
        <Where />
        <Routes><Route path="*" element={node} /></Routes>
      </BackNavigationProvider>
    </MemoryRouter>,
  ));
  return container;
}

describe("BackNavigationProvider", () => {
  it("sin puerto nativo no se suscribe a nada: el Atrás del navegador queda intacto", async () => {
    await render(["/trips"], <Screen />);
    await click(named("Abrir"));
    expect(document.querySelector("[data-open]")?.textContent).toBe("abierto");
  });

  it("una capa abierta se cierra con el Atrás y no navega", async () => {
    const button = fakeButton();
    await render([`/trips/${"a".repeat(24)}/journey`], <Screen />, button.port);
    expect(button.onBack).toHaveBeenCalledTimes(1);
    await click(named("Abrir"));
    await button.press();
    expect(document.querySelector("[data-open]")?.textContent).toBe("cerrado");
    expect(where()).toBe(`/trips/${"a".repeat(24)}/journey`);
    expect(button.exitApp).not.toHaveBeenCalled();
  });

  it("con dos capas anidadas cierra primero la última abierta", async () => {
    const button = fakeButton();
    await render(["/trips"], <Screen />, button.port);
    await click(named("Abrir"));
    await click(named("Confirmar"));
    await button.press();
    expect(document.querySelector("[data-confirm]")?.textContent).toBe("sin confirmar");
    expect(document.querySelector("[data-open]")?.textContent).toBe("abierto");
    await button.press();
    expect(document.querySelector("[data-open]")?.textContent).toBe("cerrado");
  });

  it("una capa que está guardando se traga el Atrás sin cerrarse ni navegar", async () => {
    const button = fakeButton();
    await render(["/trips"], <Screen saving />, button.port);
    await click(named("Abrir"));
    await button.press();
    expect(document.querySelector("[data-open]")?.textContent).toBe("abierto");
    expect(button.exitApp).not.toHaveBeenCalled();
  });

  it("sin capas abiertas aplica la resolución: raíz del Trip vuelve a Mis viajes", async () => {
    const button = fakeButton();
    await render([`/trips/${"a".repeat(24)}/itinerary`], <Screen />, button.port);
    await button.press();
    expect(where()).toBe("/trips");
  });

  it("sin capas abiertas y sin historial en Mis viajes cierra la app", async () => {
    const button = fakeButton();
    await render(["/trips"], <Screen />, button.port);
    await button.press();
    expect(button.exitApp).toHaveBeenCalledTimes(1);
    expect(where()).toBe("/trips");
  });

  it("con historial vuelve a la entrada anterior", async () => {
    const button = fakeButton();
    await render(["/trips", "/profile"], <Screen />, button.port);
    await button.press();
    expect(where()).toBe("/trips");
  });

  it("al desmontar se desuscribe del puerto", async () => {
    const button = fakeButton();
    await render(["/trips"], <Screen />, button.port);
    expect(button.count()).toBe(1);
    await act(async () => roots.splice(0).forEach((root) => root.unmount()));
    expect(button.count()).toBe(0);
  });
});
