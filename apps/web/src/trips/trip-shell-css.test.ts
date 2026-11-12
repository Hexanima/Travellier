import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** jsdom no calcula estilos: fija el contrato visual de cabecera/pestañas sobre el texto de los CSS. No sustituye revisión en dispositivo. */
const srcDir = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, srcDir), "utf8").replace(/\r\n/g, "\n");
const itinerary = read("trips/itinerary.css");
const app = read("App.css");
const index = read("index.css");
const html = readFileSync(new URL("../index.html", srcDir), "utf8");
const ruleBody = (css: string, selector: string) => {
  const start = css.lastIndexOf(`${selector} {`);
  if (start < 0) return "";
  return css.slice(start + selector.length + 2).split("}")[0] ?? "";
};
const tab = ruleBody(itinerary, ".trip-shell .ui-tab");
const selectedTab = ruleBody(itinerary, ".trip-shell .ui-tab[aria-selected=\"true\"]");
const chipSelected = ruleBody(itinerary, ".itinerary-day-chip[aria-current=\"date\"]");

describe("cabecera y pestañas del Trip", () => {
  it("la pestaña usa el control aprobado: 44px, radio de control, label 14/20/600 y reparto flex", () => {
    expect(tab).toContain("min-height: 44px");
    expect(tab).toContain("border-radius: var(--ui-radius-control)");
    expect(tab).toContain("font-size: 0.875rem");
    expect(tab).toContain("font-weight: 600");
    expect(tab).toContain("line-height: 1.25rem");
    expect(tab).toMatch(/flex: 1(;| 1 )/);
    expect(tab).toContain("min-width: 0");
    expect(tab).toContain("color: var(--ui-color-muted)");
  });
  it("la seleccionada usa marca sobre accent-contrast, sin subrayado ni negrita provisoria", () => {
    expect(selectedTab).toContain("background: var(--ui-color-brand)");
    expect(selectedTab).toContain("color: var(--ui-color-accent-contrast)");
    expect(selectedTab).not.toMatch(/underline|font-weight: 700/);
  });
  it("hover soft/marca solo en no seleccionadas y foco de 3px con token", () => {
    expect(itinerary).toMatch(/\.trip-shell \.ui-tab\[aria-selected="false"\]:hover \{[^}]*background: var\(--ui-color-soft\)[^}]*color: var\(--ui-color-brand\)/);
    const focus = ruleBody(itinerary, ".trip-shell .ui-tab:focus-visible");
    expect(focus).toContain("var(--ui-color-focus)");
    expect(focus).toContain("3px");
    expect(focus).toContain("outline-offset: 3px");
  });
  it("las pestañas del diario llevan borde de 1px", () => {
    expect(ruleBody(itinerary, ".trip-shell .ui-tabpanel .ui-tablist .ui-tab")).toContain("border: 1px solid var(--ui-color-border)");
  });
  it("el chip de día seleccionado repite el tratamiento sin subrayado", () => {
    expect(chipSelected).toContain("background: var(--ui-color-brand)");
    expect(chipSelected).toContain("color: var(--ui-color-accent-contrast)");
    expect(chipSelected).not.toMatch(/underline|font-weight: 700/);
  });
  it("tablist con separación de 8px y scroll horizontal; h1 24/32 y 16px bajo 360px", () => {
    const list = ruleBody(itinerary, ".trip-shell .ui-tablist");
    expect(list).toContain("gap: 8px");
    expect(list).toContain("overflow-x: auto");
    const h1 = ruleBody(itinerary.split("@media (max-width: 359px)")[0] ?? "", ".trip-shell-header h1");
    expect(h1).toContain("font-size: 1.5rem");
    expect(h1).toContain("line-height: 2rem");
    expect(itinerary).toMatch(/@media \(max-width: 359px\) \{[^@]*\.trip-shell-header h1 \{[^}]*font-size: 1rem/);
  });
  it("la cabecera de retorno mide al menos 44px", () => {
    expect(ruleBody(app, ".trips-back")).toContain("min-height: 44px");
  });
  it("respeta safe areas y ocupa la pantalla disponible", () => {
    const shell = ruleBody(app, ".trips-shell");
    for (const side of ["top", "right", "bottom", "left"]) expect(shell).toContain(`env(safe-area-inset-${side})`);
    expect(html).toContain("viewport-fit=cover");
    for (const [css, selector] of [[index, "body"], [index, "#root"], [app, "#root"], [app, ".app-shell"]] as const) {
      expect(ruleBody(css, selector)).toMatch(/min-height: 100vh;\s*min-height: 100dvh;/);
    }
  });
  it("sin marcos fijos de 844/390px ni sombra de marco, y sin barras fijas inferiores sin safe area", () => {
    for (const css of [itinerary, app, index]) {
      expect(css).not.toMatch(/\b(844|390)px/);
      expect(css).not.toContain("0 12px 32px");
      for (const rule of css.match(/[^{}]+\{[^}]*position:\s*(fixed|sticky)[^}]*\}/g) ?? []) {
        if (/\bbottom\s*:/.test(rule)) expect(rule).toContain("env(safe-area-inset-bottom)");
      }
    }
  });
});
