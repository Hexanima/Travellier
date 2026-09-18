import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Feedback, LoadingState } from "./Feedback.js";

describe("feedback states", () => {
  it("renders errors as alerts", () => {
    const markup = renderToStaticMarkup(
      <Feedback variant="error">No se pudo guardar el viaje</Feedback>,
    );

    expect(markup).toContain("role=\"alert\"");
    expect(markup).toContain("No se pudo guardar el viaje");
  });

  it("renders loading feedback as a busy status", () => {
    const markup = renderToStaticMarkup(<LoadingState label="Cargando viajes" />);

    expect(markup).toContain("role=\"status\"");
    expect(markup).toContain("aria-busy=\"true\"");
    expect(markup).toContain("Cargando viajes");
  });
});
