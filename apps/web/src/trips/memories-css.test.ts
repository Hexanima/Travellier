import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * jsdom no calcula estilos: fija el contrato visual (DESIGN.md / prototipo) de Posts, Fotos, cadenas y miniaturas de actividad
 * sobre el texto de itinerary.css. Las medidas reales se verifican en navegador.
 */
const css = readFileSync(new URL("./itinerary.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const componentsCss = readFileSync(new URL("../components/components.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const ruleBody = (selector: string) => {
  const marker = `\n${selector} {`;
  const start = css.lastIndexOf(marker);
  if (start < 0) return "";
  return css.slice(start + marker.length).split("}")[0] ?? "";
};
const mediaBlock = (query: string) => {
  let out = "";
  let from = 0;
  for (let start = css.indexOf(`@media ${query} {`, from); start >= 0; start = css.indexOf(`@media ${query} {`, from)) {
    const rest = css.slice(start);
    const end = rest.search(/\n\}/);
    out += end < 0 ? rest : rest.slice(0, end);
    from = start + 1;
  }
  return out;
};
const focus = (body: string) => {
  expect(body).toContain("outline: 3px solid var(--ui-color-focus)");
  expect(body).toContain("outline-offset: 3px");
};
const paddingBottom = /padding(?:-bottom)?:[^;]*calc\(104px \+ env\(safe-area-inset-bottom\)\)/;

describe("recuerdos: acceso flotante", () => {
  it("el FAB es un círculo de 56px fijo con safe areas y por debajo de todo modal (backdrop genérico z-index 10)", () => {
    const fab = ruleBody(".memory-fab");
    expect(fab).toContain("position: fixed");
    expect(fab).toContain("right: max(24px, env(safe-area-inset-right))");
    expect(fab).toContain("bottom: max(24px, env(safe-area-inset-bottom))");
    expect(fab).toContain("width: 56px");
    expect(fab).toContain("height: 56px");
    expect(fab).toContain("border-radius: var(--ui-radius-pill)");
    expect(fab).toContain("background: var(--ui-color-brand)");
    expect(fab).toContain("color: var(--ui-color-accent-contrast)");
    const z = Number(/z-index:\s*(\d+)/.exec(fab)?.[1]);
    expect(z).toBeGreaterThan(0);
    const backdropZ = Number(/z-index:\s*(\d+)/.exec(componentsCss.split("\n.ui-modal-backdrop {")[1]?.split("}")[0] ?? "")?.[1]);
    expect(backdropZ).toBeGreaterThan(z);
    const layers = [".activity-dialog", ".participation-conflict-layer", ".activity-confirm-layer"].map((layer) => Number(/z-index:\s*(\d+)/.exec(ruleBody(`${layer} .ui-modal-backdrop`))?.[1]));
    expect(layers).toEqual([10, 20, 20]);
    for (const layer of layers) expect(layer).toBeGreaterThanOrEqual(backdropZ);
    expect(fab).not.toContain("opacity");
  });
  it("foco con token y offset 3px, hover más oscuro y 16px bajo 360px", () => {
    focus(ruleBody(".memory-fab:focus-visible"));
    expect(ruleBody(".memory-fab:hover")).toContain("var(--ui-color-brand-pressed)");
    const small = mediaBlock("(max-width: 359px)");
    expect(small).toContain(".memory-fab");
    expect(small).toContain("right: max(16px, env(safe-area-inset-right))");
    expect(small).toContain("bottom: max(16px, env(safe-area-inset-bottom))");
  });
  it("el texto accesible queda oculto visualmente sin display:none", () => {
    const label = ruleBody(".memory-fab__label");
    expect(label).toContain("position: absolute");
    expect(label).toContain("overflow: hidden");
    expect(label).not.toContain("display: none");
  });
  it("el último elemento se puede desplazar por encima del FAB (más de 104px y safe area)", () => {
    expect(ruleBody(".memory-feed")).toMatch(paddingBottom);
  });
});

describe("fotos: grilla y miniaturas", () => {
  it("grilla alineada arriba con filas iguales y columnas auto-fit de 160px", () => {
    const grid = ruleBody(".photo-grid");
    expect(grid).toContain("grid-template-columns: repeat(auto-fit, minmax(min(160px, 100%), 1fr))");
    expect(grid).toContain("grid-auto-rows: 1fr");
    expect(grid).toContain("align-items: start");
    expect(grid).toContain("gap: 12px");
  });
  it("cada ítem va en columna desde arriba y el texto largo se parte sin ensanchar", () => {
    const item = ruleBody(".photo-grid__item");
    expect(item).toContain("align-content: start");
    expect(item).toContain("min-width: 0");
    const caption = ruleBody(".photo-grid__caption");
    expect(caption).toContain("overflow-wrap: anywhere");
    expect(caption).toContain("min-width: 0");
    expect(caption).toContain("color: var(--ui-color-muted)");
    expect(caption).toContain("font-size: .75rem");
    expect(caption).toContain("line-height: 1.125rem");
  });
  it("la imagen es cuadrada con radio de control y fondo soft", () => {
    const img = ruleBody(".photo-grid__open img");
    expect(img).toContain("aspect-ratio: 1 / 1");
    expect(img).toContain("object-fit: cover");
    expect(img).toContain("border-radius: var(--ui-radius-control)");
    expect(img).toContain("background: var(--ui-color-soft)");
    focus(ruleBody(".photo-grid__open:focus-visible"));
  });
  it("las fotos fallidas son un bloque con texto y botón de 44px", () => {
    const failed = ruleBody(".photo-grid__failed");
    expect(failed).toContain("aspect-ratio: 1 / 1");
    expect(failed).toContain("background: var(--ui-color-soft)");
    expect(failed).toContain("border-radius: var(--ui-radius-control)");
    expect(ruleBody(".photo-grid__failed button")).toContain("min-height: 44px");
    focus(ruleBody(".photo-grid__failed button:focus-visible"));
  });
  it("miniaturas de actividad de 64px (56px bajo 360px), recortadas y sin encoger", () => {
    const thumb = ruleBody(".activity-memories__list img");
    expect(thumb).toContain("width: 64px");
    expect(thumb).toContain("height: 64px");
    expect(thumb).toContain("flex: none");
    expect(thumb).toContain("object-fit: cover");
    expect(thumb).toContain("border-radius: var(--ui-radius-control)");
    const small = mediaBlock("(max-width: 359px)");
    expect(small).toContain(".activity-memories__list img");
    expect(small).toContain("width: 56px");
    expect(small).toContain("height: 56px");
    const failed = ruleBody(".activity-memories__failed");
    expect(failed).toContain("width: 64px");
    expect(failed).toContain("flex: none");
    expect(failed).toContain("background: var(--ui-color-soft)");
  });
  it("el visor contiene la imagen con radio, fondo soft, dvh con safe area y navegación de 44px", () => {
    const img = ruleBody(".photo-viewer img");
    expect(img).toContain("max-height: calc(70dvh - env(safe-area-inset-bottom))");
    expect(img).toContain("border-radius: var(--ui-radius-control)");
    expect(img).toContain("background: var(--ui-color-soft)");
    expect(ruleBody(".photo-viewer__nav")).toContain("justify-content: center");
    expect(ruleBody(".photo-viewer__nav button")).toContain("min-height: 44px");
    expect(css).toMatch(/\.photo-viewer__nav button:disabled[^{]*\[aria-disabled="true"\][^{]*\{[^}]*cursor: not-allowed/);
    focus(ruleBody(".photo-viewer__nav button:focus-visible"));
    expect(ruleBody(".photo-viewer__failed")).toContain("background: var(--ui-color-soft)");
    expect(ruleBody(".photo-viewer__failed button")).toContain("min-height: 44px");
  });
});

describe("recuerdos de actividad y cadenas", () => {
  it("pestañas de actividad: 44px, borde 1px, soft con texto de marca al seleccionar y foco con token", () => {
    const tab = ruleBody(".activity-memories__tab");
    expect(tab).toContain("min-height: 44px");
    expect(tab).toContain("flex: 1");
    expect(tab).toContain("border: 1px solid var(--ui-color-border)");
    const selected = ruleBody(".activity-memories__tab[aria-selected=\"true\"]");
    expect(selected).toContain("background: var(--ui-color-soft)");
    expect(selected).toContain("color: var(--ui-color-brand)");
    focus(ruleBody(".activity-memories__tab:focus-visible"));
  });
  it("las pestañas Continuaciones/Comentarios seleccionadas son soft con texto de marca y borde soft, como las del diario", () => {
    const selected = ruleBody(".memory-tab.ui-button[aria-selected=\"true\"]");
    expect(selected).toContain("background: var(--ui-color-soft)");
    expect(selected).toContain("border-color: var(--ui-color-soft)");
    expect(selected).toContain("color: var(--ui-color-brand)");
    expect(selected).not.toContain("accent-contrast");
  });
  it("la pestaña no seleccionada es surface con borde y texto atenuados, distinta de la seleccionada", () => {
    const tab = ruleBody(".memory-tab.ui-button");
    expect(tab).toContain("min-height: 44px");
    expect(tab).toContain("border-color: var(--ui-color-border)");
    expect(tab).toContain("background: var(--ui-color-surface)");
    expect(tab).toContain("color: var(--ui-color-muted)");
    expect(tab).not.toContain("--ui-color-brand");
    expect(tab).not.toContain("--ui-color-accent)");
    const selected = ruleBody(".memory-tab.ui-button[aria-selected=\"true\"]");
    expect(selected).not.toContain("var(--ui-color-border)");
    expect(selected).not.toContain("var(--ui-color-surface)");
    const hover = ruleBody(".memory-tab.ui-button:not([aria-selected=\"true\"]):hover:not(:disabled)");
    expect(hover).toContain("background: var(--ui-color-soft)");
    expect(hover).toContain("color: var(--ui-color-brand)");
    focus(ruleBody(".memory-tab.ui-button:focus-visible"));
  });
  it("el recuerdo anterior es una fila compacta soft con texto de marca", () => {
    const parent = ruleBody(".memory-parent");
    expect(parent).toContain("min-height: 80px");
    expect(parent).toContain("padding: 12px");
    expect(parent).toContain("border-radius: var(--ui-radius-control)");
    expect(parent).toContain("background: var(--ui-color-soft)");
    expect(parent).toContain("color: var(--ui-color-brand)");
    focus(ruleBody(".memory-parent__excerpt:focus-visible"));
    const excerpt = ruleBody(".memory-parent__excerpt");
    expect(excerpt).toContain("overflow: hidden");
    expect(excerpt).toContain("text-overflow: ellipsis");
    expect(excerpt).toContain("white-space: nowrap");
  });
  it("los comentarios van en tarjetas y las continuaciones como filas con divisor", () => {
    expect(ruleBody(".comment-item")).toContain("border: 1px solid var(--ui-color-border)");
    expect(ruleBody(".itinerary-posts > .itinerary-nested-post")).toContain("border-top: 1px solid var(--ui-color-border)");
  });
  it("los extractos largos se parten sin ensanchar la lista", () => {
    expect(ruleBody(".memories-list .itinerary-post-description")).toContain("overflow-wrap: anywhere");
    expect(ruleBody(".memories-list .itinerary-post-description a")).toContain("min-width: 0");
  });
  it("el compositor ocupa el ancho y alinea el resumen del vínculo a la izquierda", () => {
    const summary = ruleBody(".post-composer #post-link-summary");
    expect(summary).toContain("display: block");
    expect(summary).toContain("text-align: left");
    expect(summary).toContain("width: 100%");
  });
});

describe("recuerdos: invariantes", () => {
  it("no hay colores en hex, clamp ni opacity en las reglas de recuerdos", () => {
    const own = [".memory-", ".photo-", ".activity-memories", ".post-composer #"]
      .flatMap((prefix) => css.split("\n").filter((line) => line.startsWith(prefix)));
    expect(own.length).toBeGreaterThan(10);
    for (const line of own) {
      expect(line).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(line).not.toContain("clamp(");
      expect(line).not.toContain("opacity");
    }
  });
  it("todo foco de recuerdos usa el token y offset 3px", () => {
    const lines = css.split("\n").filter((l) => /^(\.memory-|\.photo-|\.activity-memories)/.test(l) && l.includes("outline"));
    expect(lines.length).toBeGreaterThan(4);
    for (const line of lines) {
      expect(line).toContain("outline: 3px solid var(--ui-color-focus)");
      expect(line).toContain("outline-offset: 3px");
    }
  });
});
