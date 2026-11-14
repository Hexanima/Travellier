import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** jsdom no calcula estilos: fija el contrato visual de cabecera/pestañas sobre el texto de los CSS. No sustituye revisión en dispositivo. */
const srcDir = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, srcDir), "utf8").replace(/\r\n/g, "\n");
const itinerary = read("trips/itinerary.css");
const components = read("components/components.css");
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
const chipBase = ruleBody(itinerary, ".itinerary-day-chip.ui-button");
const chipSelected = ruleBody(itinerary, ".itinerary-day-chip.ui-button[aria-current=\"date\"]");
const panelTab = ".trip-shell .ui-tabpanel .ui-tablist .ui-tab";

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
  it("las pestañas del diario: borde 1px, seleccionada soft con texto marca, sin relleno de marca, 44px", () => {
    const unselected = ruleBody(itinerary, `${panelTab}[aria-selected="false"]`);
    const selected = ruleBody(itinerary, `${panelTab}[aria-selected="true"]`);
    expect(ruleBody(itinerary, panelTab)).toContain("border: 1px solid var(--ui-color-border)");
    expect(ruleBody(itinerary, panelTab)).toContain("min-height: 44px");
    expect(unselected).toContain("color: var(--ui-color-muted)");
    expect(unselected).toContain("background: var(--ui-color-surface)");
    expect(selected).toContain("background: var(--ui-color-soft)");
    expect(selected).toContain("color: var(--ui-color-brand)");
    expect(selected).toContain("border-color: var(--ui-color-soft)");
    expect(unselected + selected).not.toContain("background: var(--ui-color-brand)");
  });
  it("el chip de día seleccionado se distingue del no seleccionado y ambos tienen :disabled", () => {
    expect(chipBase).toContain("background: var(--ui-color-surface)");
    expect(chipBase).toContain("color: var(--ui-color-brand)");
    expect(chipBase).toContain("border-color: var(--ui-color-border)");
    expect(chipSelected).toContain("background: var(--ui-color-brand)");
    expect(chipSelected).toContain("color: var(--ui-color-accent-contrast)");
    expect(chipSelected).not.toMatch(/underline|font-weight: 700/);
    expect(chipBase).not.toContain("background: var(--ui-color-brand)");
    expect(itinerary).toContain(".itinerary-day-chip.ui-button:disabled {");
    expect(ruleBody(itinerary, ".itinerary-day-chip.ui-button:disabled")).toContain("var(--ui-color-muted)");
  });
  it("el filtro de Mis viajes no depende de .trip-shell ni de itinerary.css: base global de Tabs en components.css", () => {
    const list = ruleBody(components, ".ui-tablist");
    const base = ruleBody(components, ".ui-tab");
    expect(list).toContain("display: flex");
    expect(list).toContain("gap: 8px");
    expect(list).toContain("overflow-x: auto");
    expect(base).toContain("min-height: 44px");
    expect(base).toContain("flex: none");
    expect(ruleBody(components, '.ui-tab[aria-selected="true"]')).toContain("background: var(--ui-color-brand)");
    expect(ruleBody(components, '.ui-tab[aria-selected="true"]')).toContain("color: var(--ui-color-accent-contrast)");
    const focus = ruleBody(components, ".ui-tab:focus-visible");
    expect(focus).toContain("var(--ui-color-focus)");
    expect(focus).toContain("outline-offset: 3px");
    expect(components).not.toContain(".trip-shell");
    expect(read("index.css")).toContain('@import "./components/components.css"');
    expect(readFileSync(new URL("main.tsx", srcDir), "utf8")).toContain("./index.css");
  });
  it("tablist con separación de 8px y scroll horizontal; h1 18/26/700 y 16px bajo 360px", () => {
    const list = ruleBody(itinerary, ".trip-shell .ui-tablist");
    expect(list).toContain("gap: 8px");
    expect(list).toContain("overflow-x: auto");
    const h1 = ruleBody(itinerary.split("@media (max-width: 359px)")[0] ?? "", ".trip-shell-header h1");
    expect(h1).toContain("font-size: 1.125rem");
    expect(h1).toContain("line-height: 1.625rem");
    expect(h1).toContain("font-weight: 700");
    expect(itinerary).toMatch(/@media \(max-width: 359px\) \{[^@]*\.trip-shell-header h1 \{[^}]*font-size: 1rem/);
  });
  it("«Actualizar» comparte la fila del nombre como acción sin relleno de 44px, no como primario (T153)", () => {
    const header = ruleBody(itinerary, ".trip-shell-header");
    expect(header).toContain("display: flex");
    expect(header).toContain("justify-content: space-between");
    expect(header).toContain("gap: 12px");
    const action = ruleBody(itinerary, ".trip-shell-refresh.ui-button");
    expect(action).toContain("background: transparent");
    expect(action).toContain("color: var(--ui-color-brand)");
    expect(action).toContain("min-height: 44px");
    expect(action).toContain("flex: none");
    expect(action).not.toContain("width: 100%");
    expect(ruleBody(itinerary, ".trip-shell-refresh.ui-button:hover:not(:disabled)")).toContain("background: var(--ui-color-soft)");
    const disabled = ruleBody(itinerary, '.trip-shell-refresh.ui-button:disabled, .trip-shell-refresh.ui-button[aria-disabled="true"]');
    expect(disabled).toContain("background: var(--ui-color-disabled-surface)");
    expect(disabled).toContain("color: var(--ui-color-muted)");
  });
  it("«Configuración» acompaña el nombre como acción sin relleno de 44px, sin subrayado (T153)", () => {
    const action = ruleBody(itinerary, ".trip-shell-settings");
    expect(action).toContain("min-height: 44px");
    expect(action).toContain("background: transparent");
    expect(action).toContain("color: var(--ui-color-brand)");
    expect(action).toContain("flex: none");
    expect(action).toContain("text-decoration: none");
    expect(action).not.toContain("width: 100%");
    expect(ruleBody(itinerary, ".trip-shell-settings:hover")).toContain("background: var(--ui-color-soft)");
    const focusRing = ruleBody(itinerary, ".trip-shell-settings:focus-visible");
    expect(focusRing).toContain("outline: 3px solid var(--ui-color-focus)");
    expect(focusRing).toContain("outline-offset: 3px");
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
  it("los modales compensan safe areas en los cuatro lados y el diálogo ajusta su altura máxima", () => {
    const backdrop = ruleBody(components, ".ui-modal-backdrop");
    for (const side of ["top", "right", "bottom", "left"]) expect(backdrop).toContain(`max(var(--ui-space-4), env(safe-area-inset-${side}))`);
    const dialog = ruleBody(itinerary, ".activity-dialog .ui-modal");
    expect(dialog).toContain("max-block-size: calc(100dvh - max(16px, env(safe-area-inset-top)) - max(16px, env(safe-area-inset-bottom)))");
    for (const css of [components, itinerary, app, index]) {
      for (const m of css.matchAll(/^[^{}\n]*\{[^}]*\d+d?vh[^}]*\}/gm)) {
        if (/min-height: 100d?vh/.test(m[0]) || /photo-viewer img/.test(m[0])) continue;
        expect(m[0]).toContain("env(safe-area-inset-");
      }
    }
  });
});
