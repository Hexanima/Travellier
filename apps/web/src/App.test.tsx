import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import App from "./App.js";

const apiBaseUrl = "https://api.example.test";

describe("App", () => {
  it("does not expose auth entry points when the API URL is not configured", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/"]}>
        <App apiBaseUrl="" />
      </MemoryRouter>,
    );

    expect(markup).toContain("Configuración de API requerida");
    expect(markup).not.toContain('href="/login"');
  });

  it("renders the welcome with brand heading and the two entry links", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/"]}>
        <App apiBaseUrl={apiBaseUrl} />
      </MemoryRouter>,
    );
    const anchors = markup.match(/<a [^>]*>[^<]*<\/a>/g) ?? [];
    const link = (text: string) => anchors.find((anchor) => anchor.endsWith(`>${text}</a>`)) ?? "";

    expect(markup).toMatch(/<h1[^>]*>[^<]*Travellier/);
    expect(markup).toContain("welcome-brand");
    expect(link("Crear cuenta")).toContain('href="/register"');
    expect(link("Crear cuenta")).toMatch(/class="ui-button"/);
    expect(link("Ya tengo cuenta")).toContain('href="/login"');
    expect(link("Ya tengo cuenta")).toContain("ui-button ui-button--secondary");
    expect(markup).not.toContain("Inicio");
    expect(markup).not.toContain("BUE");
    expect(markup).not.toMatch(/estudio|próximamente|futur/i);
    expect(markup).not.toContain("Clean Architecture Template");
  });

  it.each([
    ["/login", "Iniciar sesión"],
    ["/register", "Crear cuenta"],
  ])("renders the public auth route %s", (route, title) => {
    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={[route]}>
        <App apiBaseUrl={apiBaseUrl} />
      </MemoryRouter>,
    );

    expect(markup).toContain(title);
    expect(markup).toContain('type="password"');
  });

  it("waits for session restoration before showing private Trips", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/trips"]}>
        <App apiBaseUrl={apiBaseUrl} />
      </MemoryRouter>,
    );

    expect(markup).toContain("Restaurando sesión…");
    expect(markup).not.toContain("Mis viajes");
  });

  it("waits for session restoration before mounting the profile screen", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/profile"]}>
        <App apiBaseUrl={apiBaseUrl} />
      </MemoryRouter>,
    );

    expect(markup).toContain("Restaurando sesión…");
    expect(markup).not.toContain("Mi perfil");
  });

  it("has no screen for an unknown route: it waits for the session instead of a dead end", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/missing"]}>
        <App apiBaseUrl={apiBaseUrl} />
      </MemoryRouter>,
    );

    expect(markup).not.toContain("Página no encontrada");
    expect(markup).toContain("Restaurando sesión…");
  });
});
