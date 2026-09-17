import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { List, ListItem } from "./List.js";

describe("List", () => {
  it("replaces its items with a loading state", () => {
    const markup = renderToStaticMarkup(
      <List loading>
        <ListItem>Bariloche</ListItem>
      </List>,
    );

    expect(markup).toContain("role=\"status\"");
    expect(markup).toContain("Cargando…");
    expect(markup).not.toContain("Bariloche");
  });

  it("exposes list and item disabled and error states", () => {
    const markup = renderToStaticMarkup(
      <List disabled error="No se pudieron cargar los viajes">
        <ListItem disabled>Bariloche</ListItem>
      </List>,
    );

    expect(markup).toContain("aria-disabled=\"true\"");
    expect(markup).toContain("role=\"alert\"");
    expect(markup).toContain("No se pudieron cargar los viajes");
  });

  it("prevents interaction with controls in a disabled list", () => {
    const markup = renderToStaticMarkup(
      <List disabled>
        <ListItem>
          <button type="button">Eliminar</button>
        </ListItem>
      </List>,
    );

    expect(markup).toContain("inert=\"\"");
  });
});
