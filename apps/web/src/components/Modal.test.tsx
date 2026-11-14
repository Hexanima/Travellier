// @vitest-environment jsdom

import { act } from "react";
import { createPortal } from "react-dom";
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
    /** Ancestro común de los dos extremos del gesto: el navegador emite ahí el click cuando el press y el release difieren. */
    const commonAncestor = (down: HTMLElement, up: HTMLElement) => {
      let node: HTMLElement | null = down;
      while (node && !node.contains(up)) node = node.parentElement;
      return node ?? down;
    };
    /** Secuencia real de un toque: pointerdown/mousedown en el origen, pointerup/mouseup en el final y click en el ancestro común (jsdom no tiene PointerEvent). */
    const tap = async (down: HTMLElement, up: HTMLElement = down) => act(async () => {
      down.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      down.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      up.dispatchEvent(new Event("pointerup", { bubbles: true }));
      up.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      commonAncestor(down, up).dispatchEvent(new MouseEvent("click", { bubbles: true }));
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

    it("no cierra si el gesto terminó dentro del modal (arrastre desde el fondo)", async () => {
      const onClose = vi.fn();
      const container = await mount(<Modal isOpen title="Cambiar" onClose={onClose}><button>Ok</button></Modal>);
      const { backdrop, dialog } = parts(container);
      await tap(backdrop, dialog);
      expect(onClose).not.toHaveBeenCalled();
    });

    it("el fondo no es un control: sin rol propio ni foco", async () => {
      const container = await mount(<Modal isOpen title="Cambiar" onClose={() => undefined}>Ok</Modal>);
      const { backdrop } = parts(container);
      expect(backdrop.getAttribute("role")).toBeNull();
      expect(backdrop.getAttribute("tabindex")).toBeNull();
    });

    // Regresión del guard de `target`: con dos modales apilados en portales el fondo del de arriba no es el `currentTarget` del
    // de abajo, así que el de abajo ignora ese click aunque el evento de React le llegue por el árbol de componentes. El cruce de
    // portales en sí lo vigilan los tests de los manejadores de la pantalla, no este.
    it("el guard de target protege al modal de abajo del toque en el fondo del de arriba", async () => {
      const onCloseUnder = vi.fn();
      const onCloseOver = vi.fn();
      await mount(
        <Modal isOpen title="Actividad" onClose={onCloseUnder}>
          {createPortal(<Modal isOpen title="Conflicto" onClose={onCloseOver}>Ok</Modal>, document.body)}
        </Modal>,
      );
      const backdrops = document.body.querySelectorAll<HTMLElement>(".ui-modal-backdrop");
      expect(backdrops).toHaveLength(2);
      const [under, over] = [backdrops[0], backdrops[1]];
      expect(over.contains(under)).toBe(false);
      expect(under.contains(over)).toBe(false);
      await tap(over);
      expect(onCloseOver).toHaveBeenCalledOnce();
      expect(onCloseUnder).not.toHaveBeenCalled();
    });

    // Mismo motivo: el portal saca el modal del DOM de la pantalla que lo abrió, pero el evento sigue subiendo por el árbol de
    // React hasta sus manejadores (una fila o tarjeta pulsable), que no deben reaccionar al toque de cierre.
    it("el toque del fondo no activa los manejadores de la pantalla que abrió el modal", async () => {
      const onClose = vi.fn();
      const onScreenClick = vi.fn();
      await mount(
        <div onClick={onScreenClick}>
          {createPortal(<Modal isOpen title="Conflicto" onClose={onClose}>Ok</Modal>, document.body)}
        </div>,
      );
      await tap(document.body.querySelector(".ui-modal-backdrop") as HTMLElement);
      expect(onClose).toHaveBeenCalledOnce();
      expect(onScreenClick).not.toHaveBeenCalled();
    });

    // El corte de propagación no depende de que el modal pueda cerrarse: mientras guarda, el toque del fondo no cierra, pero
    // tampoco debe llegar por el portal a los manejadores de la pantalla que abrió el modal.
    it("el toque del fondo no activa esos manejadores tampoco mientras el modal guarda", async () => {
      const onClose = vi.fn();
      const onScreenClick = vi.fn();
      await mount(
        <div onClick={onScreenClick}>
          {createPortal(<Modal isOpen loading title="Conflicto" onClose={onClose}>Ok</Modal>, document.body)}
        </div>,
      );
      await tap(document.body.querySelector(".ui-modal-backdrop") as HTMLElement);
      expect(onClose).not.toHaveBeenCalled();
      expect(onScreenClick).not.toHaveBeenCalled();
    });

    // Mismo caso sin salida posible: un modal sin `onClose` no cierra con el toque del fondo y sigue conteniendo el evento.
    it("el toque del fondo no activa esos manejadores tampoco en un modal sin salida", async () => {
      const onScreenClick = vi.fn();
      await mount(
        <div onClick={onScreenClick}>
          {createPortal(<Modal isOpen title="Conflicto">Ok</Modal>, document.body)}
        </div>,
      );
      await tap(document.body.querySelector(".ui-modal-backdrop") as HTMLElement);
      expect(onScreenClick).not.toHaveBeenCalled();
    });
  });
});
