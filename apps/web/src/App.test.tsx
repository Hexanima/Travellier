import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import App from "./App.js";

describe("App", () => {
  it("renders the public initial route", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    expect(markup).toContain("Travellier");
    expect(markup).toContain("Inicio");
    expect(markup).not.toContain("Clean Architecture Template");
  });

  it("renders a protected route without reading an authentication session", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/trips"]}>
        <App />
      </MemoryRouter>,
    );

    expect(markup).toContain("Acceso protegido");
  });

  it("renders a fallback for an unknown route", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/missing"]}>
        <App />
      </MemoryRouter>,
    );

    expect(markup).toContain("Página no encontrada");
  });
});
