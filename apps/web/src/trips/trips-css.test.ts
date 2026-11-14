import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** jsdom no calcula estilos: fija el contrato visual de Mis viajes, Explorar, creación y Grupo sobre el texto de App.css. No sustituye revisión en dispositivo. */
const srcDir = new URL("../", import.meta.url);
const app = readFileSync(new URL("App.css", srcDir), "utf8").replace(/\r\n/g, "\n");
/** Cuerpo de la última regla de primer nivel (en columna 0): ignora las reglas indentadas de los bloques @media. */
const ruleBody = (css: string, selector: string) => {
  const marker = `\n${selector} {`;
  const start = css.lastIndexOf(marker);
  if (start < 0) return "";
  return css.slice(start + marker.length).split("}")[0] ?? "";
};
/** Regla base: solo cuenta si el selector abre la línea (no como parte de otro ámbito). */
const baseBody = (selector: string) => {
  const start = app.search(new RegExp(`^${selector.replace(/[.\\[\]()]/g, "\\$&")} \\{`, "m"));
  if (start < 0) return "";
  return app.slice(start + selector.length + 2).split("}")[0] ?? "";
};
const marker = "/* T110:";
const added = app.includes(marker) ? app.slice(app.indexOf(marker)) : "";
const addedRules = [...added.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((match) => ({ selector: (match[1] ?? "").replace(/\/\*[\s\S]*?\*\//g, "").trim(), body: match[2] ?? "" }));

describe("Mis viajes y Explorar", () => {
  it("la fila es una tarjeta surface con borde 1px, radio card y padding 16", () => {
    const item = ruleBody(app, ".trips-panel--catalog .trips-item");
    expect(item).toContain("border: 1px solid var(--ui-color-border)");
    expect(item).toContain("border-radius: var(--ui-radius-card)");
    expect(item).toContain("padding: 16px");
    expect(item).toContain("background: var(--ui-color-surface)");
    expect(item).toContain("gap: 12px");
  });
  it("nombre 18/26/700, destino 14/20 de marca y fechas 12/18 muted tabulares", () => {
    const name = ruleBody(app, ".trips-panel--catalog .trips-item h2");
    expect(name).toContain("font-size: 1.125rem");
    expect(name).toContain("line-height: 1.625rem");
    expect(name).toContain("font-weight: 700");
    const destination = ruleBody(app, ".trips-panel--catalog .trips-destination");
    expect(destination).toContain("font-size: 0.875rem");
    expect(destination).toContain("line-height: 1.25rem");
    expect(destination).toContain("color: var(--ui-color-brand)");
    const dates = ruleBody(app, ".trips-panel--catalog .trips-dates");
    expect(dates).toContain("font-size: 0.75rem");
    expect(dates).toContain("line-height: 1.125rem");
    expect(dates).toContain("color: var(--ui-color-muted)");
    expect(dates).toContain("font-variant-numeric: tabular-nums");
  });
  it("los enlaces de acción son botones de 52px al ancho disponible, sin subrayado, con foco de 3px con token y offset 3px", () => {
    const link = ruleBody(app, ".trips-panel--catalog .trips-settings-link");
    expect(link).toContain("min-height: 52px");
    expect(link).toContain("display: inline-flex");
    expect(link).toContain("width: 100%");
    expect(link).toContain("text-decoration: none");
    expect(link).not.toContain("text-decoration: underline");
    const focus = ruleBody(app, ".trips-panel--catalog .trips-settings-link:focus-visible");
    expect(focus).toContain("outline: 3px solid var(--ui-color-focus)");
    expect(focus).toContain("outline-offset: 3px");
    // La base compartida sigue siendo una fila flexible; el catálogo agrupa en columna con el ritmo de 12px.
    expect(baseBody(".trips-item-links")).toContain("flex-wrap: wrap");
    expect(ruleBody(app, ".trips-panel--catalog .trips-item-links")).toContain("display: grid");
    expect(ruleBody(app, ".trips-panel--catalog .trips-item-links")).toContain("gap: 12px");
  });
  it("la tarjeta es un enlace de bloque: sin subrayado, color heredado, con hover y foco con token (T153)", () => {
    const open = ruleBody(app, ".trips-panel--catalog .trips-item-open");
    expect(open).toContain("display: grid");
    expect(open).toContain("text-decoration: none");
    expect(open).toContain("color: inherit");
    expect(open).toContain("min-height: 44px");
    const hover = ruleBody(app, ".trips-panel--catalog .trips-item-open:hover");
    expect(hover).toContain("background: var(--ui-color-soft)");
    const focus = ruleBody(app, ".trips-panel--catalog .trips-item-open:focus-visible");
    expect(focus).toContain("outline: 3px solid var(--ui-color-focus)");
    expect(focus).toContain("outline-offset: 3px");
    // El realce se anima solo con movimiento permitido: la transición vive dentro de la consulta, como en components.css.
    expect(open).not.toContain("transition:");
    expect(app).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*\.trips-panel--catalog \.trips-item-open \{[^}]*transition: background-color 150ms ease/);
  });

  it("las entradas y el vacío usan botones de ancho completo acotados a su contenedor", () => {
    expect(ruleBody(app, ".trips-panel--catalog .trips-entry-actions .ui-button")).toContain("width: 100%");
    // El ancho del vacío vive una sola vez, en la regla base compartida por Mis viajes, Explorar, itinerario, Diario y balance.
    expect(baseBody(".trips-empty .ui-button")).toContain("width: 100%");
    expect(app).not.toContain(".trips-panel--catalog .trips-empty .ui-button");
    expect(app).not.toMatch(/^\.ui-button \{[^}]*width: 100%/m);
  });
  it("la navegación Cuenta agrupa botones de 52px al ancho disponible con gap de 12px", () => {
    const link = ruleBody(app, ".trips-panel--catalog .trips-secondary a");
    expect(link).toContain("min-height: 52px");
    expect(link).toContain("display: inline-flex");
    expect(link).toContain("width: 100%");
    const group = ruleBody(app, ".trips-panel--catalog .trips-secondary");
    expect(group).toContain("display: grid");
    expect(group).toContain("gap: 12px");
    expect(ruleBody(app, ".trips-panel--catalog .trips-secondary .ui-button")).toContain("width: 100%");
  });
  it("el vacío es una tarjeta con h2 18/26/700", () => {
    const heading = ruleBody(app, ".trips-panel--catalog .trips-empty h2");
    expect(heading).toContain("font-size: 1.125rem");
    expect(heading).toContain("line-height: 1.625rem");
    expect(heading).toContain("font-weight: 700");
  });
});

describe("Crear, configurar y unirse", () => {
  it("la introducción es 16/24 muted, el gap del formulario es 20px y el nombre es 14/20 muted", () => {
    const intro = ruleBody(app, ".trips-shell .trip-form-panel > p");
    expect(intro).toContain("font-size: 1rem");
    expect(intro).toContain("line-height: 1.5rem");
    expect(intro).toContain("color: var(--ui-color-muted)");
    expect(ruleBody(app, ".trip-form-panel .auth-form")).toContain("gap: 20px");
    const name = ruleBody(app, ".trips-shell .trip-form-panel .trip-config-name");
    expect(name).toContain("font-size: 0.875rem");
    expect(name).toContain("line-height: 1.25rem");
    expect(name).toContain("color: var(--ui-color-muted)");
  });
  it("la vista pública es tarjeta de marca con radio card, padding 24 y descripción on-brand-muted", () => {
    const preview = ruleBody(app, ".trip-form-panel .trip-public-preview");
    expect(preview).toContain("background: var(--ui-color-brand)");
    expect(preview).toContain("color: var(--ui-color-accent-contrast)");
    expect(preview).toContain("border-radius: var(--ui-radius-card)");
    expect(preview).toContain("padding: 24px");
    expect(ruleBody(app, ".trip-form-panel .trip-public-preview .trips-description")).toContain("color: var(--ui-color-on-brand-muted)");
    expect(ruleBody(app, ".trip-form-panel .trip-public-preview .trips-destination")).toContain("color: var(--ui-color-on-brand-muted)");
    expect(ruleBody(app, ".trip-form-panel .trip-public-preview .ui-button")).toContain("width: 100%");
  });
  it("la unión por link usa un panel propio con botón de ancho completo", () => {
    expect(ruleBody(app, ".invite-panel .ui-button")).toContain("width: 100%");
    expect(ruleBody(app, ".invite-panel strong")).toContain("overflow-wrap: anywhere");
  });
});

describe("Grupo", () => {
  it("el código de invitación es una tarjeta de marca 32/40 tabular", () => {
    const code = ruleBody(app, "section.trip-members-section .trip-invite-code");
    expect(code).toContain("background: var(--ui-color-brand)");
    expect(code).toContain("color: var(--ui-color-accent-contrast)");
    expect(code).toContain("font-size: 2rem");
    expect(code).toContain("line-height: 2.5rem");
    expect(code).toContain("font-variant-numeric: tabular-nums");
    expect(code).toContain("border-radius: var(--ui-radius-card)");
  });
  it("la insignia de rol es una píldora 12/18 soft/marca y la del titular invierte", () => {
    const badge = ruleBody(app, ".role-badge");
    expect(badge).toContain("font-size: 0.75rem");
    expect(badge).toContain("line-height: 1.125rem");
    expect(badge).toContain("border-radius: var(--ui-radius-control)");
    expect(badge).toContain("background: var(--ui-color-soft)");
    expect(badge).toContain("color: var(--ui-color-brand)");
    const owner = ruleBody(app, ".role-badge.role-badge--owner");
    expect(owner).toContain("background: var(--ui-color-brand)");
    expect(owner).toContain("color: var(--ui-color-accent-contrast)");
  });
  it("la fila de integrante tiene divisor 1px y permite encoger", () => {
    const row = ruleBody(app, "section.trip-members-section .trip-member-item");
    expect(row).toContain("border-bottom: 1px solid var(--ui-color-border)");
    expect(row).toContain("min-width: 0");
  });
  it("Gestionar mide 44px con alineación explícita", () => {
    const manage = ruleBody(app, ".trip-member-item .ui-button");
    expect(manage).toContain("min-height: 44px");
    expect(manage).toContain("display: inline-flex");
    expect(manage).toContain("align-items: center");
    expect(manage).toContain("justify-content: center");
  });
  it("el título de sección es 18/26/700 y la sección no lleva borde", () => {
    const title = ruleBody(app, "section.trip-members-section :is(h2, h3)");
    expect(title).toContain("font-size: 1.125rem");
    expect(title).toContain("line-height: 1.625rem");
    expect(title).toContain("font-weight: 700");
    expect(ruleBody(app, "section.trip-members-section")).toContain("border: 0");
  });
});

describe("Diálogos de Grupo", () => {
  it("el diálogo respeta safe areas, scrollea internamente y no desborda", () => {
    const modal = ruleBody(app, ".members-dialog .ui-modal");
    expect(modal).toContain("padding: 24px");
    expect(modal).toContain("max-block-size: calc(100dvh - max(16px, env(safe-area-inset-top)) - max(16px, env(safe-area-inset-bottom)))");
    expect(modal).toContain("overflow-y: auto");
    expect(modal).toContain("overscroll-behavior: contain");
  });
  it("título 24/32/700 y cierre de 44px", () => {
    const title = ruleBody(app, ".members-dialog .ui-modal__title");
    expect(title).toContain("font-size: 1.5rem");
    expect(title).toContain("line-height: 2rem");
    expect(title).toContain("font-weight: 700");
    expect(ruleBody(app, ".members-dialog .ui-modal__close")).toContain("min-height: 44px");
  });
  it("las acciones van en columna con botones de ancho completo solo dentro del diálogo", () => {
    const actions = ruleBody(app, ".members-dialog .trip-members-actions");
    expect(actions).toContain("flex-direction: column");
    expect(actions).toContain("gap: 12px");
    expect(ruleBody(app, ".members-dialog .trip-members-actions .ui-button")).toContain("width: 100%");
    expect(ruleBody(app, ".members-dialog .trip-members-ack")).toContain("min-height: 44px");
    expect(ruleBody(app, ".members-dialog .trip-members-ack input")).toContain("accent-color: var(--ui-color-brand)");
  });
});

describe("invariantes y reglas compartidas", () => {
  it("no se tocaron las reglas base compartidas", () => {
    expect(app).toContain(".trips-shell {\n  display: block;");
    expect(baseBody(".trips-back")).toContain("min-height: 44px");
    expect(app).toContain(".trips-header h1,\n.trip-form-panel h1 {");
    expect(baseBody(".trips-empty")).toContain("padding: 28px");
    expect(baseBody(".trips-state")).toContain("justify-items: start");
    expect(baseBody(".trip-members-actions")).toBe(" display: flex; flex-wrap: wrap; gap: 12px; ");
    expect(baseBody(".trips-settings-link")).toContain("flex: none");
    // .trips-secondary solo vive bajo el catálogo: su base aporta la separación y nada que el ámbito ya reemplace.
    expect(baseBody(".trips-secondary")).toBe(" margin-top: 32px; ");
  });
  it("lo nuevo no usa hex, clamp, opacity, vh, ni fixed/sticky", () => {
    expect(added).not.toBe("");
    expect(added).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(added).not.toMatch(/clamp\(|opacity/);
    expect(added.replace(/\d+dvh/g, "")).not.toMatch(/\d+s?vh\b/);
    expect(added).not.toMatch(/position:\s*(fixed|sticky)/);
  });
  it("todo override de .ui-button con background o color excluye estados desactivados y ocupados", () => {
    const overrides = addedRules.filter((rule) => /\.ui-button(?![\w-])/.test(rule.selector) && !rule.selector.includes(":") && /(background|(^|[\s;])color):/.test(rule.body));
    for (const rule of overrides) {
      for (const selector of rule.selector.split(",").map((s) => s.trim())) {
        const disabled = addedRules.find((other) => other.selector.split(",").some((s) => s.trim().startsWith(selector) && s.includes(":disabled")));
        expect(disabled, selector).toBeDefined();
        expect(disabled?.selector).toMatch(/aria-busy/);
      }
    }
  });
  it("todo foco nuevo usa el token con offset 3px", () => {
    const focuses = addedRules.filter((rule) => rule.selector.includes(":focus-visible"));
    expect(focuses.length).toBeGreaterThan(0);
    for (const rule of focuses) {
      expect(rule.body).toContain("var(--ui-color-focus)");
      expect(rule.body).toContain("outline-offset: 3px");
      // Sobre la tarjeta de marca el contorno solo no contrasta: un anillo accent-contrast lo separa.
      if (rule.selector.includes(".trip-public-preview")) expect(rule.body).toContain("box-shadow: 0 0 0 3px var(--ui-color-accent-contrast)");
    }
  });
  it("la insignia de rol no depende de contenido generado: el texto acompaña siempre", () => {
    expect(added).not.toMatch(/(^|[\s;{])content:/);
  });
  it("hay bloque móvil de 359px con código 28/36 y padding 16 en el diálogo", () => {
    const tail = app.slice(app.lastIndexOf("@media (max-width: 359px)"));
    expect(tail).toContain("section.trip-members-section p.trip-invite-code");
    expect(tail).toContain("font-size: 1.75rem");
    expect(tail).toContain("line-height: 2.25rem");
    expect(tail).toMatch(/\.members-dialog \.ui-modal\[role="dialog"\] \{ padding: 16px; \}/);
  });
});
