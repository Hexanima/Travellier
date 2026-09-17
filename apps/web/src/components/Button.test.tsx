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
});
