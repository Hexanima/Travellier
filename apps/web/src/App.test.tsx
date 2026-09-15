import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import App from "./App.js";

describe("App", () => {
  it("renders the Travellier application shell", () => {
    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain("Travellier");
    expect(markup).toContain("Organizá tus viajes en grupo.");
    expect(markup).not.toContain("Clean Architecture Template");
  });
});
