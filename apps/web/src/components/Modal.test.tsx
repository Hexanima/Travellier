import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Modal } from "./Modal.js";

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
});
