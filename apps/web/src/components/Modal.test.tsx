// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemoryRouter, useLocation } from "react-router-dom";

import { Modal } from "./Modal.js";
import { BackNavigationProvider } from "../navigation/BackNavigationProvider.js";
import type { AppBackButton } from "../native/app-back-button.js";

function Where() { return <output data-where>{useLocation().pathname}</output>; }

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const mountedRoots: ReturnType<typeof createRoot>[] = [];

afterEach(async () => {
  await act(async () => {
    mountedRoots.splice(0).forEach((root) => root.unmount());
  });
  document.body.replaceChildren();
});

describe("Modal", () => {
  it("does not render when closed", () => {
    const markup = renderToStaticMarkup(
      <Modal isOpen={false} title="Crear viaje">Contenido</Modal>,
    );

    expect(markup).toBe("");
  });

  it("renders accessible loading, error and disabled states", () => {
    const markup = renderToStaticMarkup(
      <Modal isOpen title="Crear viaje" loading error="No se pudo guardar" disabled>
        Contenido
      </Modal>,
    );

    expect(markup).toContain("role=\"dialog\"");
    expect(markup).toContain("aria-modal=\"true\"");
    expect(markup).toContain("aria-busy=\"true\"");
    expect(markup).toContain("No se pudo guardar");
    expect(markup).toContain("disabled=\"\"");
  });

  it("disables controls rendered in its content", () => {
    const markup = renderToStaticMarkup(
      <Modal isOpen title="Crear viaje" disabled>
        <input aria-label="Nombre del viaje" />
        <button type="submit">Guardar</button>
        <a href="/trips">Volver a viajes</a>
      </Modal>,
    );

    expect(markup).toMatch(/<fieldset[^>]*disabled=""/);
    expect(markup).toMatch(/<fieldset[^>]*inert=""/);
  });

  it("keeps its close action available when only its form is disabled", () => {
    const markup = renderToStaticMarkup(
      <Modal isOpen title="Editar viaje" disabled onClose={() => undefined}>
        <input aria-label="Nombre del viaje" />
      </Modal>,
    );

    expect(markup).not.toContain("aria-label=\"Cerrar\" disabled=\"\"");
  });

  it("moves focus to the dialog when it opens", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mountedRoots.push(root);

    await act(async () => {
      root.render(
        <Modal isOpen title="Editar viaje" onClose={() => undefined}>
          <button type="submit">Guardar</button>
        </Modal>,
      );
    });

    expect(document.activeElement).toBe(container.querySelector("[role=dialog]"));
  });

  it("traps Tab at the final control", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mountedRoots.push(root);

    await act(async () => {
      root.render(
        <Modal isOpen title="Editar viaje" onClose={() => undefined}>
          <button type="submit">Guardar</button>
        </Modal>,
      );
    });

    const save = container.querySelector("[type=submit]") as HTMLButtonElement;
    save.focus();
    await act(async () => {
      save.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Tab" }));
    });

    expect(document.activeElement).toBe(container.querySelector("[aria-label=Cerrar]"));
  });

  it("restores focus to the trigger when it closes", async () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mountedRoots.push(root);

    await act(async () => {
      root.render(
        <Modal isOpen title="Editar viaje" onClose={() => undefined}>
          <button type="submit">Guardar</button>
        </Modal>,
      );
    });

    (container.querySelector("[type=submit]") as HTMLButtonElement).focus();
    await act(async () => {
      root.render(
        <Modal isOpen={false} title="Editar viaje" onClose={() => undefined}>
          <button type="submit">Guardar</button>
        </Modal>,
      );
    });

    expect(document.activeElement).toBe(trigger);
  });

  describe("Escape", () => {
    const mount = async (modal: React.ReactElement) => {
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      mountedRoots.push(root);
      await act(async () => { root.render(modal); });
      return container;
    };
    const press = async (container: HTMLElement) => act(async () => {
      container.querySelector("[role=dialog]")!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });
    it("calls onClose when closeOnEscape is enabled", async () => {
      const onClose = vi.fn();
      const container = await mount(<Modal isOpen closeOnEscape title="Cambiar" onClose={onClose}><button>Ok</button></Modal>);
      await press(container);
      expect(onClose).toHaveBeenCalledOnce();
    });
    it("does not close while loading", async () => {
      const onClose = vi.fn();
      const container = await mount(<Modal isOpen closeOnEscape loading title="Cambiar" onClose={onClose}>Ok</Modal>);
      await press(container);
      expect(onClose).not.toHaveBeenCalled();
    });
    it("does nothing without onClose", async () => {
      const container = await mount(<Modal isOpen closeOnEscape title="Cambiar">Ok</Modal>);
      await expect(press(container)).resolves.toBeUndefined();
      expect(container.querySelector("[role=dialog]")).not.toBeNull();
    });
    it("is opt-in: existing modals ignore Escape", async () => {
      const onClose = vi.fn();
      const container = await mount(<Modal isOpen title="Cambiar" onClose={onClose}>Ok</Modal>);
      await press(container);
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe("Atrás nativo", () => {
    const mountWithBack = async (modal: React.ReactElement) => {
      const listeners = new Set<() => void>();
      const exitApp = vi.fn();
      const port: AppBackButton = { onBack: (listener) => { listeners.add(listener); return () => listeners.delete(listener); }, exitApp };
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      mountedRoots.push(root);
      await act(async () => { root.render(
        <MemoryRouter initialEntries={["/trips/aaaaaaaaaaaaaaaaaaaaaaaa/journey"]}>
          <BackNavigationProvider backButton={port}><Where />{modal}</BackNavigationProvider>
        </MemoryRouter>,
      ); });
      return { container, exitApp, press: async () => { await act(async () => listeners.forEach((listener) => listener())); } };
    };
    const where = (container: HTMLElement) => container.querySelector("[data-where]")?.textContent;

    it("cierra el diálogo abierto sin navegar", async () => {
      const onClose = vi.fn();
      const back = await mountWithBack(<Modal isOpen title="Cambiar" onClose={onClose}>Ok</Modal>);
      await back.press();
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(where(back.container)).toBe("/trips/aaaaaaaaaaaaaaaaaaaaaaaa/journey");
      expect(back.exitApp).not.toHaveBeenCalled();
    });

    it("mientras guarda se traga el Atrás: no cierra ni navega", async () => {
      const onClose = vi.fn();
      const back = await mountWithBack(<Modal isOpen loading title="Cambiar" onClose={onClose}>Ok</Modal>);
      await back.press();
      expect(onClose).not.toHaveBeenCalled();
      expect(where(back.container)).toBe("/trips/aaaaaaaaaaaaaaaaaaaaaaaa/journey");
    });

    it("un diálogo sin cierre retiene el Atrás en vez de dejar la pantalla", async () => {
      const back = await mountWithBack(<Modal isOpen title="Cambiar">Ok</Modal>);
      await back.press();
      expect(where(back.container)).toBe("/trips/aaaaaaaaaaaaaaaaaaaaaaaa/journey");
    });

    it("cerrado no toma el Atrás: la pantalla navega", async () => {
      const onClose = vi.fn();
      const back = await mountWithBack(<Modal isOpen={false} title="Cambiar" onClose={onClose}>Ok</Modal>);
      await back.press();
      expect(onClose).not.toHaveBeenCalled();
      expect(where(back.container)).toBe("/trips");
    });
  });
  describe("toque fuera del modal", () => {
    const mount = async (modal: React.ReactElement) => {
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      mountedRoots.push(root);
      await act(async () => { root.render(modal); });
      return container;
    };
    const parts = (container: HTMLElement) => ({
      backdrop: container.querySelector(".ui-modal-backdrop") as HTMLElement,
      dialog: container.querySelector(".ui-modal") as HTMLElement,
    });
    /** Secuencia real de un toque: pointerdown (jsdom no tiene PointerEvent), mousedown y click sobre el mismo objetivo. */
    const tap = async (down: HTMLElement, up: HTMLElement = down) => act(async () => {
      down.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      down.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      up.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    it("cierra al tocar el fondo, fuera del modal", async () => {
      const onClose = vi.fn();
      const container = await mount(<Modal isOpen title="Cambiar" onClose={onClose}><button>Ok</button></Modal>);
      await tap(parts(container).backdrop);
      expect(onClose).toHaveBeenCalledOnce();
    });

    it("no cierra al tocar dentro del modal", async () => {
      const onClose = vi.fn();
      const container = await mount(<Modal isOpen title="Cambiar" onClose={onClose}><button>Ok</button></Modal>);
      await tap(parts(container).dialog);
      expect(onClose).not.toHaveBeenCalled();
    });

    it("no cierra mientras guarda", async () => {
      const onClose = vi.fn();
      const container = await mount(<Modal isOpen loading title="Cambiar" onClose={onClose}>Ok</Modal>);
      await tap(parts(container).backdrop);
      expect(onClose).not.toHaveBeenCalled();
    });

    it("un diálogo sin cierre no se cierra con el toque de fuera", async () => {
      const container = await mount(<Modal isOpen title="Cambiar">Ok</Modal>);
      await tap(parts(container).backdrop);
      expect(container.querySelector("[role=dialog]")).not.toBeNull();
    });

    it("no cierra si el gesto empezó dentro (arrastre al seleccionar texto)", async () => {
      const onClose = vi.fn();
      const container = await mount(<Modal isOpen title="Cambiar" onClose={onClose}><button>Ok</button></Modal>);
      const { backdrop, dialog } = parts(container);
      await tap(dialog, backdrop);
      expect(onClose).not.toHaveBeenCalled();
    });

    it("el fondo no es un control: sin rol propio ni foco", async () => {
      const container = await mount(<Modal isOpen title="Cambiar" onClose={() => undefined}>Ok</Modal>);
      const { backdrop } = parts(container);
      expect(backdrop.getAttribute("role")).toBeNull();
      expect(backdrop.getAttribute("tabindex")).toBeNull();
    });

    it("el fondo del modal de arriba no cierra el de abajo", async () => {
      const onCloseUnder = vi.fn();
      const onCloseOver = vi.fn();
      const container = await mount(
        <Modal isOpen title="Actividad" onClose={onCloseUnder}>
          <Modal isOpen title="Conflicto" onClose={onCloseOver}>Ok</Modal>
        </Modal>,
      );
      const backdrops = container.querySelectorAll(".ui-modal-backdrop");
      await tap(backdrops[backdrops.length - 1] as HTMLElement);
      expect(onCloseOver).toHaveBeenCalledOnce();
      expect(onCloseUnder).not.toHaveBeenCalled();
    });
  });
});
