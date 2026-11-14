import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * jsdom no calcula estilos: fija el contrato visual (DESIGN.md / prototipo) de gastos, pagos y reparto y balance sobre el texto de
 * expenses.css. Las medidas reales se verifican en navegador.
 */
const css = readFileSync(new URL("./expenses.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const ruleBody = (selector: string) => {
  const marker = `\n${selector} {`;
  const start = css.lastIndexOf(marker);
  if (start < 0) return "";
  return css.slice(start + marker.length).split("}")[0] ?? "";
};
const mediaBlock = (query: string) => {
  const start = css.indexOf(`@media ${query} {`);
  if (start < 0) return "";
  const rest = css.slice(start);
  const end = rest.search(/\n\}/);
  return end < 0 ? rest : rest.slice(0, end);
};
const rules = () => Array.from(css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/^([^{}@\n][^{}]*)\{([^}]*)\}/gm)).map((match) => ({ selectors: (match[1] ?? "").split(",").map((item) => item.trim()), body: match[2] ?? "" }));
const scopes = [".trip-balance", ".expense-split", ".post-composer", ".itinerary-trip-expenses", ".itinerary-outside-expenses"];

describe("balance: tarjetas por moneda, saldos y compensaciones", () => {
  it("cada moneda es una tarjeta surface con borde 1px, radio de tarjeta, padding 16 y gap 12", () => {
    const body = ruleBody(".trip-balance .balance-currency");
    expect(body).toContain("border: 1px solid var(--ui-color-border)");
    expect(body).toContain("border-radius: var(--ui-radius-card)");
    expect(body).toContain("background: var(--ui-color-surface)");
    expect(body).toContain("padding: 16px");
    expect(body).toContain("gap: 12px");
  });
  it("el título de moneda es 18/26/700", () => {
    const body = ruleBody(".trip-balance .balance-currency h2");
    expect(body).toContain("font-size: 1.125rem");
    expect(body).toContain("line-height: 1.625rem");
    expect(body).toContain("font-weight: 700");
  });
  it("la fila de saldo tiene divisor de 1px, 16/24 y cifras tabulares", () => {
    const body = ruleBody(".trip-balance .balance-currency .balance-row");
    expect(body).toContain("border-top: 1px solid var(--ui-color-border)");
    expect(body).toContain("font-size: 1rem");
    expect(body).toContain("line-height: 1.5rem");
    expect(body).toContain("font-variant-numeric: tabular-nums");
  });
  it("las compensaciones tienen divisor y cifras tabulares", () => {
    const body = ruleBody(".trip-balance .balance-currency .balance-settlement");
    expect(body).toContain("border-top: 1px solid var(--ui-color-border)");
    expect(body).toContain("font-variant-numeric: tabular-nums");
  });
  it("los gastos por completar llevan divisores, motivos sin viñetas y enlace de 44px", () => {
    expect(ruleBody(".trip-balance .balance-pending .balance-pending-item")).toContain("border-top: 1px solid var(--ui-color-border)");
    const reasons = ruleBody(".trip-balance .balance-pending-item ul");
    expect(reasons).toContain("list-style: none");
    const action = ruleBody(".trip-balance .balance-pending-item .trips-settings-link");
    expect(action).toContain("min-height: 44px");
    expect(action).toContain("display: inline-flex");
    expect(action).toContain("align-items: center");
  });
  it("los vacíos apilan sus acciones solo bajo .trip-balance, sin recortar la altura del botón", () => {
    const empty = ruleBody(".trip-balance .trips-empty");
    expect(empty).toContain("display: grid");
    expect(empty).toContain("gap: 12px");
    // Las acciones son botones de 52px: ningún override con ámbito les baja la altura ni les quita el ancho disponible.
    expect(css).not.toContain(".trip-balance .trips-empty a {");
  });
  it("el enlace «Configurar modo de gastos» del balance llega a 44px", () => {
    const body = ruleBody(".trip-balance .balance-refresh .trips-settings-link");
    expect(body).toContain("display: inline-flex");
    expect(body).toContain("align-items: center");
    expect(body).toContain("min-height: 44px");
  });
  it("«Actualizar balance» queda alineado al inicio", () => {
    const body = ruleBody(".trip-balance .balance-refresh");
    expect(body).toContain("justify-items: start");
  });
});

describe("editor de pagos y reparto", () => {
  it("el total del gasto se destaca 18/26/700 con cifras tabulares", () => {
    const body = ruleBody(".expense-split .expense-split__total");
    expect(body).toContain("font-size: 1.125rem");
    expect(body).toContain("line-height: 1.625rem");
    expect(body).toContain("font-weight: 700");
    expect(body).toContain("font-variant-numeric: tabular-nums");
  });
  it("cada fila es una caja con borde 1px, radio de control y padding 12/16", () => {
    const body = ruleBody(".expense-split .split-rows .expense-split__row");
    expect(body).toContain("border: 1px solid var(--ui-color-border)");
    expect(body).toContain("border-radius: var(--ui-radius-control)");
    expect(body).toContain("padding: 12px 16px");
  });
  it("la fila es una grilla de dos columnas minmax(0, 1fr) y pasa a una columna bajo 360px", () => {
    expect(ruleBody(".expense-split .split-rows .expense-split__row")).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    const small = mediaBlock("(max-width: 359px)");
    expect(small).toMatch(/\.expense-split \.split-rows \.expense-split__row \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  });
  it("el nombre ocupa el ancho completo y parte palabras largas", () => {
    const body = ruleBody(".expense-split .split-person");
    expect(body).toContain("grid-column: 1 / -1");
    expect(body).toContain("overflow-wrap: anywhere");
  });
  it("selects e inputs pueden encogerse (min-width: 0)", () => {
    const body = ruleBody(".expense-split .expense-split__row .ui-control");
    expect(body).toContain("min-width: 0");
  });
  it("el error de fila ocupa el ancho completo y «Quitar» se alinea al final con 44px", () => {
    expect(ruleBody(".expense-split .expense-split__row .ui-field__error")).toContain("grid-column: 1 / -1");
    const remove = ruleBody(".expense-split .expense-split__row .ui-button");
    expect(remove).toContain("grid-column: 1 / -1");
    expect(remove).toContain("justify-self: end");
    expect(remove).toContain("min-height: 44px");
  });
  it("el resumen es una caja soft 14/20 con cifras tabulares", () => {
    const body = ruleBody(".expense-split .expense-split__summary");
    expect(body).toContain("background: var(--ui-color-soft)");
    expect(body).toContain("border-radius: var(--ui-radius-control)");
    expect(body).toContain("font-size: .875rem");
    expect(body).toContain("line-height: 1.25rem");
    expect(body).toContain("font-variant-numeric: tabular-nums");
  });
  it("los botones de agregar e incluir ocupan el ancho completo solo dentro de .expense-split", () => {
    expect(ruleBody(".expense-split .post-expense-section > .ui-button")).toContain("width: 100%");
    expect(ruleBody(".expense-split .split-rows li:not(.expense-split__row) .ui-button")).toContain("width: 100%");
  });
});

describe("bloque de gasto del compositor y listado de gastos", () => {
  it("el bloque del compositor es una tarjeta con ámbito .post-composer", () => {
    const body = ruleBody(".post-composer .post-expense-section");
    expect(body).toContain("border: 1px solid var(--ui-color-border)");
    expect(body).toContain("border-radius: var(--ui-radius-card)");
    expect(body).toContain("padding: 16px");
  });
  it("el resumen del gasto es 16/24 con cifras tabulares", () => {
    const body = ruleBody(".post-composer #post-expense-summary");
    expect(body).toContain("font-size: 1rem");
    expect(body).toContain("line-height: 1.5rem");
    expect(body).toContain("font-variant-numeric: tabular-nums");
  });
  it("cada fecha del gasto es inline-block", () => {
    expect(ruleBody(".expense-date")).toContain("display: inline-block");
  });
  it("el botón de gastos fuera del itinerario se alinea a la izquierda sin cambiar sus colores", () => {
    const body = ruleBody(".itinerary-trip-expenses .ui-button");
    expect(body).toContain("justify-self: start");
    expect(body).toContain("justify-content: flex-start");
    expect(body).not.toMatch(/(^|[\s;])(background|color)\s*:/);
  });
  it("cada gasto fuera del itinerario va separado por un divisor", () => {
    expect(ruleBody("section.itinerary-outside-expenses .itinerary-outside-expenses__item")).toContain("border-top: 1px solid var(--ui-color-border)");
  });
});

describe("invariantes de expenses.css", () => {
  it("no usa hex, clamp(, opacity, vh ni posicionamiento fixed/sticky", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toContain("clamp(");
    expect(css).not.toContain("opacity");
    expect(css).not.toMatch(/\d\s*vh\b/);
    expect(css).not.toMatch(/position:\s*(fixed|sticky)/);
  });
  it("todo foco usa el token, 3px solid y offset 3px", () => {
    const bodies = [...css.matchAll(/:focus(?:-visible)?\s*\{([^}]*)\}/g)].map((match) => match[1] ?? "");
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      expect(body).toContain("var(--ui-color-focus)");
      expect(body).toContain("outline: 3px solid");
      expect(body).toContain("outline-offset: 3px");
    }
  });
  it("todo override de .ui-button con background/color trae su :disabled", () => {
    for (const { selectors, body } of rules()) {
      if (!/(^|[\s;])(background|color)\s*:/.test(body)) continue;
      for (const selector of selectors) {
        if (!/\.ui-button(?![\w-])/.test(selector) || /:(hover|disabled|focus)|\[aria-/.test(selector)) continue;
        expect(css, selector).toContain(`${selector}:disabled`);
      }
    }
  });
  it("ningún selector de ancho completo ni de gasto sale sin un prefijo de contexto", () => {
    for (const { selectors, body } of rules()) {
      if (!/width:\s*100%/.test(body)) continue;
      for (const selector of selectors) expect(scopes.some((scope) => selector.startsWith(scope)), selector).toBe(true);
    }
  });
  it("no usa content: con texto de estado", () => {
    expect(css).not.toMatch(/content:\s*["'][^"']/);
  });
});

describe("imports de expenses.css y especificidad", () => {
  const sourceOf = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  it("TripItineraryScreen importa expenses.css despues de itinerary.css", () => {
    const source = sourceOf("./TripItineraryScreen.tsx");
    const itinerary = source.indexOf('import "./itinerary.css";');
    const expenses = source.indexOf('import "./expenses.css";');
    expect(itinerary).toBeGreaterThan(-1);
    expect(expenses).toBeGreaterThan(itinerary);
  });
  it("cada componente que usa clases de expenses.css lo importa", () => {
    for (const file of ["./ExpenseForm.tsx", "./ExpenseSplitForm.tsx", "./PostComposer.tsx", "./TripBalanceScreen.tsx", "./TripItineraryScreen.tsx"]) {
      expect(sourceOf(file), file).toContain('import "./expenses.css";');
    }
  });
  it("la regla del item fuera del itinerario supera la especificidad (0,2,0) de .itinerary-posts > .itinerary-nested-post", () => {
    expect(ruleBody("section.itinerary-outside-expenses .itinerary-outside-expenses__item")).toContain("display: grid");
    expect(css).not.toMatch(/^\.itinerary-outside-expenses \.itinerary-outside-expenses__item/m);
  });
});
