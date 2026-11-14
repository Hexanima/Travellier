import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * jsdom no calcula estilos: fija el contrato visual (DESIGN.md / prototipo) de avisos, permiso de push, calendario, exportación .ics y la
 * tarjeta de lugar sobre el texto de integrations.css. Las medidas reales se verifican en navegador.
 */
const css = readFileSync(new URL("./integrations.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const ruleBody = (selector: string) => {
  const marker = `\n${selector} {`;
  const start = css.lastIndexOf(marker);
  if (start < 0) return "";
  return css.slice(start + marker.length).split("}")[0] ?? "";
};
const rules = () => Array.from(css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/^([^{}@\n][^{}]*)\{([^}]*)\}/gm)).map((match) => ({ selectors: (match[1] ?? "").split(",").map((item) => item.trim()), body: match[2] ?? "" }));
const card = ".location-preview[data-context]";
const open = ".location-preview[data-context] .location-preview__open";

describe("tarjeta de lugar (sin mapa dibujado)", () => {
  it("es una tarjeta soft con radio de tarjeta, padding 16 y gap 12", () => {
    const body = ruleBody(card);
    expect(body).toContain("background: var(--ui-color-soft)");
    expect(body).toContain("border-radius: var(--ui-radius-card)");
    expect(body).toContain("padding: 16px");
    expect(body).toContain("gap: 12px");
    expect(body).toContain("min-width: 0");
  });
  it("el ícono va en un cuadro con el token de marca", () => {
    const body = ruleBody(".location-preview[data-context] .location-preview__icon");
    expect(body).toContain("background: var(--ui-color-brand)");
    expect(body).toContain("color: var(--ui-color-accent-contrast)");
    expect(body).toContain("width: 40px");
    expect(body).toContain("height: 40px");
  });
  it("el texto no desborda", () => {
    expect(ruleBody(".location-preview[data-context] .location-preview__place")).toContain("overflow-wrap: anywhere");
    expect(ruleBody(".location-preview[data-context] .location-preview__text")).toContain("min-width: 0");
  });
  it("no dibuja un mapa ni un placeholder", () => {
    for (const forbidden of [".map-grid", ".map-point", ".map-street", ".map-preview", "linear-gradient", "background-image"]) expect(css).not.toContain(forbidden);
  });
  it("«Abrir en Maps» es inline-flex centrado, de 52px y acotado a la tarjeta", () => {
    const body = ruleBody(open);
    expect(body).toContain("display: inline-flex");
    expect(body).toContain("justify-content: center");
    expect(body).toContain("min-height: 52px");
    expect(body).toContain("width: 100%");
    expect(body).toContain("max-width: 100%");
    expect(body).toContain("grid-column: 1 / -1");
    expect(body).toContain("text-decoration: none");
  });
  it("el foco del enlace usa el token con 3px/3px", () => {
    const body = ruleBody(`${open}:focus-visible`);
    expect(body).toContain("outline: 3px solid var(--ui-color-focus)");
    expect(body).toContain("outline-offset: 3px");
  });
  it("la apertura (aria-disabled) muestra cursor de progreso y no baja el contraste con opacity", () => {
    const body = ruleBody(`${open}[aria-disabled="true"]`);
    expect(body).toContain("cursor: progress");
    expect(body).not.toContain("opacity");
  });
  it("el fallo de apertura lleva borde danger y un mensaje en la tarjeta completa", () => {
    expect(ruleBody(`${card}[data-state="failed"]`)).toContain("border: 1px solid var(--ui-color-danger)");
    const error = ruleBody(".location-preview[data-context] .location-preview__error");
    expect(error).toContain("grid-column: 1 / -1");
    expect(error).toContain("border: 1px solid var(--ui-color-danger)");
  });
});

describe("avisos personales", () => {
  it("la lista no tiene viñetas ni espacio entre filas", () => {
    const body = ruleBody(".notice-list.ui-list");
    expect(body).toContain("list-style: none");
    expect(body).toContain("gap: 0");
  });
  it("cada aviso es una fila con divisor de 1px", () => {
    const body = ruleBody(".notice-list .notice");
    expect(body).toContain("border-bottom: 1px solid var(--ui-color-border)");
    expect(body).toContain("padding: 16px 0");
  });
  it("el titular es 16/24/700 y lo secundario 14/20 muted", () => {
    const head = ruleBody(".notice-list .notice > p:first-child");
    expect(head).toContain("font-size: 1rem");
    expect(head).toContain("line-height: 1.5rem");
    expect(head).toContain("font-weight: 700");
    const secondary = ruleBody(".notice-list .notice .itinerary-secondary");
    expect(secondary).toContain("font-size: .875rem");
    expect(secondary).toContain("line-height: 1.25rem");
    expect(secondary).toContain("color: var(--ui-color-muted)");
  });
  it("los enlaces del aviso (recuerdo, decidir, planes incompatibles) miden 44px", () => {
    const body = ruleBody(".notice-list .notice a");
    expect(body).toContain("min-height: 44px");
    expect(body).toContain("display: inline-flex");
    expect(body).toContain("align-items: center");
  });
  it("el foco programático del aviso usa el token con 3px/3px", () => {
    const body = ruleBody(".notice-list [data-notification]:focus-visible");
    expect(body).toContain("outline: 3px solid var(--ui-color-focus)");
    expect(body).toContain("outline-offset: 3px");
  });
});

describe("permiso de push, calendario y exportación .ics", () => {
  it.each([".push-panel", ".calendar-sync[data-state]"])("%s es una tarjeta soft con borde, padding 16 y gap 12", (selector) => {
    const body = ruleBody(selector);
    expect(body).toContain("background: var(--ui-color-soft)");
    expect(body).toContain("border: 1px solid var(--ui-color-border)");
    expect(body).toContain("border-radius: var(--ui-radius-card)");
    expect(body).toContain("padding: 16px");
    expect(body).toContain("gap: 12px");
    expect(body).toContain("min-width: 0");
    expect(body).toContain("overflow-wrap: anywhere");
  });
  it("el título de la tarjeta de push es 18/26/700", () => {
    const body = ruleBody(".push-notices h2");
    expect(body).toContain("font-size: 1.125rem");
    expect(body).toContain("line-height: 1.625rem");
    expect(body).toContain("font-weight: 700");
  });
  it("el ancho completo se acota a las tarjetas de push y calendario", () => {
    expect(ruleBody(".push-panel > .ui-button")).toContain("width: 100%");
    expect(ruleBody(".calendar-sync[data-state] .ui-button")).toContain("width: 100%");
    expect(ruleBody('.calendar-sync[data-state] > [role="group"]')).toContain("justify-items: stretch");
    expect(css).not.toMatch(/^\.ui-button\s*\{/m);
  });
  it.each([".push-panel", ".calendar-sync"])("%s: denegado y error llevan borde danger y un indicador que no es solo color", (base) => {
    for (const state of ["denied", "error"]) {
      const body = ruleBody(`${base}[data-state="${state}"]`);
      expect(body, state).toContain("border-color: var(--ui-color-danger)");
      expect(body, state).toContain("background: var(--ui-color-surface)");
      const marker = ruleBody(`${base}[data-state="${state}"]::before`);
      expect(marker, state).toContain("content:");
      expect(marker, state).toContain('content: "!" / "";');
      expect(marker, state).toMatch(/content: "!";[^}]*content: "!" \/ "";/);
      expect(marker, state).toContain("border-radius: var(--ui-radius-pill)");
    }
  });
  it("todo content generado lleva texto alternativo vacio y respaldo previo", () => {
    const declarations = css.match(/content:[^;]*;/g) ?? [];
    expect(declarations.length).toBeGreaterThan(0);
    const generated = declarations.filter((d) => /content:\s*"[^"]+"/.test(d));
    const silenced = declarations.filter((d) => d === 'content: "!" / "";');
    expect(silenced.length).toBe(generated.length / 2);
    expect(generated.every((d) => d === 'content: "!";' || d === 'content: "!" / "";')).toBe(true);
  });
  it("los botones ocupados conservan el cursor de progreso sin opacity", () => {
    expect(ruleBody('.push-panel > .ui-button[aria-busy="true"]')).toContain("cursor: progress");
    expect(ruleBody('.calendar-sync[data-state] .ui-button[aria-busy="true"]')).toContain("cursor: progress");
  });
  it("la exportación .ics es una tarjeta con borde y nota estática 14/20 muted", () => {
    const body = ruleBody("section.ics-export");
    expect(body).toContain("border: 1px solid var(--ui-color-border)");
    expect(body).toContain("border-radius: var(--ui-radius-card)");
    expect(body).toContain("padding: 16px");
    expect(body).toContain("gap: 12px");
    const note = ruleBody("section.ics-export .ics-export-notice");
    expect(note).toContain("font-size: .875rem");
    expect(note).toContain("line-height: 1.25rem");
    expect(note).toContain("color: var(--ui-color-muted)");
  });
});

describe("invariantes del archivo", () => {
  it("no usa hex, clamp, opacity ni vh", () => {
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(bare).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(bare).not.toContain("clamp(");
    expect(bare).not.toMatch(/opacity/);
    expect(bare).not.toMatch(/\d\s*vh\b/);
  });
  it("todo override de .ui-button con background/color incluye su :disabled", () => {
    for (const { selectors, body } of rules()) {
      if (!/(^|[\s;])(background|color)\s*:/.test(body)) continue;
      for (const selector of selectors) {
        if (!/\.ui-button(?![\w-])/.test(selector) || /:(hover|disabled|focus)|\[aria-/.test(selector)) continue;
        expect(css, selector).toContain(`${selector}:disabled`);
      }
    }
  });
  it("no repite selectores", () => {
    const seen = new Set<string>();
    for (const { selectors } of rules()) for (const selector of selectors) {
      expect(seen.has(selector), selector).toBe(false);
      seen.add(selector);
    }
  });
  it("todo :focus/:focus-visible usa el token, 3px y offset 3px", () => {
    for (const match of css.matchAll(/:focus(?:-visible)?\s*\{([^}]*)\}/g)) {
      expect(match[1]).toContain("outline: 3px solid var(--ui-color-focus)");
      expect(match[1]).toContain("outline-offset: 3px");
    }
  });
  it.each(["notifications/NotificationsScreen.tsx", "push/PushNotices.tsx", "push/PushPermissionPanel.tsx", "calendar/CalendarSyncPanel.tsx", "calendar/ExportIcsButton.tsx", "trips/LocationPreview.tsx"])("%s importa integrations.css", (file) => {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    expect(source).toMatch(/import "\.\.\/components\/integrations\.css";/);
  });
});
