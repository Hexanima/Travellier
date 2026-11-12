import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Button } from "./Button.js";

describe("Button", () => {
  it("disables the action and exposes a busy state while loading", () => {
    const markup = renderToStaticMarkup(<Button loading>Guardar</Button>);

    expect(markup).toContain("disabled=\"\"");
    expect(markup).toContain("aria-busy=\"true\"");
    expect(markup).toContain("Guardando…");
  });

  it("renders an error state without losing its accessible label", () => {
    const markup = renderToStaticMarkup(<Button error>Reintentar</Button>);

    expect(markup).toContain("data-error=\"true\"");
    expect(markup).toContain("Reintentar");
  });

  it("keeps the primary look by default and adds the secondary variant only when requested", () => {
    expect(renderToStaticMarkup(<Button>Guardar</Button>)).not.toContain("ui-button--secondary");
    expect(renderToStaticMarkup(<Button variant="secondary">Cancelar</Button>)).toContain("ui-button ui-button--secondary");
  });

  it("stays disabled without busy state when only disabled", () => {
    const markup = renderToStaticMarkup(<Button disabled>Guardar</Button>);

    expect(markup).toContain("disabled=\"\"");
    expect(markup).not.toContain("aria-busy");
  });
});
