import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * jsdom no calcula estilos: fija sobre el texto de los CSS la regla que evita el desborde horizontal de los nombres
 * que escribe la gente (viajes, destinos) y la composición en columna de Destinos y transportes. Las medidas reales
 * a 320 px se verifican en navegador.
 */
const srcDir = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, srcDir), "utf8").replace(/\r\n/g, "\n");
const app = read("App.css");
const index = read("index.css");
/** Cuerpo de la primera regla con ese selector: las reglas de los bloques @media ajustan, no definen el contrato. */
const baseBody = (css: string, selector: string) => {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) return "";
  return css.slice(start + selector.length + 2).split("}")[0] ?? "";
};
/** Cuerpo de la primera regla cuya lista de selectores incluye todos los pedidos: no depende del formato ni del orden de la lista. */
const ruleWith = (css: string, ...selectors: readonly string[]) => {
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const rule = rules.find((match) => {
    const list = (match[1] ?? "").replace(/\/\*[\s\S]*?\*\//g, "").split(",").map((item) => item.trim());
    return selectors.every((selector) => list.includes(selector));
  });
  return rule?.[2] ?? "";
};
/** Regla base de texto: un único bloque con los elementos que reciben nombres y textos de la gente. */
const textBase = (() => {
  const rules = [...index.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((match) => ({
    selectors: (match[1] ?? "").replace(/\/\*[\s\S]*?\*\//g, "").trim().split(/\s*,\s*/),
    body: match[2] ?? "",
  }));
  return rules.find((rule) => rule.selectors.includes("h2")) ?? { selectors: [], body: "" };
})();

describe("quiebre de palabras de base", () => {
  it("una sola regla hace que títulos y textos partan palabras largas", () => {
    expect(textBase.body).toContain("overflow-wrap: anywhere");
    for (const element of ["h1", "h2", "h3", "h4", "h5", "h6", "p", "dd", "li", "legend", "figcaption"]) {
      expect(textBase.selectors).toContain(element);
    }
  });
});

describe("Destinos y transportes", () => {
  it("la lista de destinos es una columna que puede encogerse", () => {
    const list = baseBody(app, ".journey-destinations");
    expect(list).toContain("display: grid");
    expect(list).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(baseBody(app, ".journey-destination, .journey-add")).toContain("min-width: 0");
  });
  it("ida y vuelta se apilan en una columna que puede encogerse", () => {
    const directions = baseBody(app, ".journey-directions");
    expect(directions).toContain("display: grid");
    expect(directions).toContain("grid-template-columns: minmax(0, 1fr)");
  });
  it("el panel del viaje no se ensancha con un nombre largo", () => {
    expect(ruleWith(app, ".trips-panel", ".trip-form-panel")).toContain("min-width: 0");
  });
});
