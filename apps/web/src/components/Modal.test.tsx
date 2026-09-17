// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { Modal } from "./Modal.js";

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
});
