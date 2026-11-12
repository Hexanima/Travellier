import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * jsdom no calcula estilos: fija el contrato visual (DESIGN.md / prototipo) del itinerario, la participación, el selector de
 * destinos y los modales de actividad sobre el texto de itinerary.css. Las medidas reales se verifican en navegador.
 */
const css = readFileSync(new URL("./itinerary.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");
/** Cuerpo de la última regla de primer nivel (en columna 0): ignora las reglas indentadas de los bloques @media. */
const ruleBody = (selector: string) => {
  const marker = `
${selector} {`;
  const start = css.lastIndexOf(marker);
  if (start < 0) return "";
  return css.slice(start + marker.length).split("}")[0] ?? "";
};
/** Texto del primer bloque @media con esa condición (los bloques son multilínea y cierran con "}" en columna 0). */
const mediaBlock = (query: string) => {
  const start = css.indexOf(`@media ${query} {`);
  if (start < 0) return "";
  const rest = css.slice(start);
  const end = rest.search(/\n\}/);
  return end < 0 ? rest : rest.slice(0, end);
};
const ink = "color: var(--ui-color-text)";
const focus = (body: string) => {
  expect(body).toContain("var(--ui-color-focus)");
  expect(body).toContain("outline: 3px solid");
  expect(body).toContain("outline-offset: 3px");
};

describe("itinerario: tarjetas y filas", () => {
  it("columna horaria de 50px (38px bajo 360px, gap 10px), cifras tabulares y sin 5ch", () => {
    const row = ruleBody(".itinerary-items > .itinerary-item");
    expect(row).toContain("grid-template-columns: 50px minmax(0, 1fr)");
    expect(row).toContain("gap: 12px");
    expect(css).not.toContain("5ch");
    const small = mediaBlock("(max-width: 359px)");
    expect(small).toContain("grid-template-columns: 38px minmax(0, 1fr)");
    expect(small).toContain("gap: 10px");
    expect(css).toMatch(/\.itinerary-range, \.itinerary-item-time[^{]*\{[^}]*font-variant-numeric: tabular-nums/);
  });
  it("hora 12/18/600 muted; texto secundario 14/20 muted", () => {
    const time = ruleBody(".itinerary-item-time");
    expect(time).toContain("font-size: .75rem");
    expect(time).toContain("line-height: 1.125rem");
    expect(time).toContain("font-weight: 600");
    expect(time).toContain("color: var(--ui-color-muted)");
    const secondary = ruleBody(".itinerary-secondary, .itinerary-band-empty");
    expect(secondary).toContain("font-size: .875rem");
    expect(secondary).toContain("line-height: 1.25rem");
    expect(secondary).toContain("color: var(--ui-color-muted)");
  });
  it("título del evento 18/26/700 (16/24 bajo 360px), en tinta, con hover de marca y :disabled conservado", () => {
    const heading = ruleBody(".itinerary-item-content h4");
    expect(heading).toContain("font-size: 1.125rem");
    expect(heading).toContain("line-height: 1.625rem");
    expect(heading).toContain("font-weight: 700");
    const small = mediaBlock("(max-width: 359px)");
    expect(small).toMatch(/\.itinerary-item-content h4 \{[^}]*font-size: 1rem[^}]*line-height: 1\.5rem/);
    const title = ruleBody(".activity-title.ui-button, .transport-title.ui-button");
    expect(title).toContain(ink);
    expect(title).toContain("font-size: inherit");
    expect(title).toContain("font-weight: inherit");
    expect(title).toContain("text-decoration: underline");
    expect(title).toContain("min-height: 44px");
    expect(ruleBody(".activity-title.ui-button:hover:not(:disabled), .transport-title.ui-button:hover:not(:disabled)")).toContain("color: var(--ui-color-brand)");
    expect(ruleBody(".activity-title.ui-button:disabled, .transport-title.ui-button:disabled, .activity-title.ui-button[aria-disabled=\"true\"], .transport-title.ui-button[aria-disabled=\"true\"]")).toContain("color: var(--ui-color-muted)");
  });
  it("tarjeta de franja con padding 16 (12 bajo 360px), radio card y sin referencias muertas a arrival", () => {
    const band = ruleBody(".itinerary-band");
    expect(band).toContain("padding: 16px");
    expect(band).toContain("border-radius: var(--ui-radius-card)");
    expect(css).not.toContain("--arrival");
    expect(mediaBlock("(max-width: 359px)")).toMatch(/\.itinerary-band \{[^}]*padding: 12px/);
  });
});

describe("participación y «Modificado»", () => {
  const actions = ".activity-participation-actions .ui-button";
  it("Voy / No voy: 44px, radio de control, 14/20/600; seleccionado con relleno de marca, el resto surface con texto de marca", () => {
    const base = ruleBody(actions);
    expect(base).toContain("min-height: 44px");
    expect(base).toContain("border-radius: var(--ui-radius-control)");
    expect(base).toContain("font-size: .875rem");
    expect(base).toContain("line-height: 1.25rem");
    expect(base).toContain("font-weight: 600");
    expect(base).toContain("background: var(--ui-color-surface)");
    expect(base).toContain("color: var(--ui-color-brand)");
    const selected = ruleBody(`${actions}[aria-pressed="true"]`);
    expect(selected).toContain("background: var(--ui-color-brand)");
    expect(selected).toContain("color: var(--ui-color-accent-contrast)");
  });
  it("hover solo en no seleccionados, foco con token 3px/3px y :disabled sin pisar seleccionado ni ocupado", () => {
    expect(ruleBody(`${actions}:hover:not(:disabled):not([aria-pressed="true"])`)).toContain("background: var(--ui-color-soft)");
    focus(ruleBody(`${actions}:focus-visible`));
    const disabled = ruleBody(`${actions}:disabled:not([aria-pressed="true"]):not([aria-busy="true"]), ${actions}[aria-disabled="true"]:not([aria-pressed="true"]):not([aria-busy="true"])`);
    expect(disabled).toContain("var(--ui-color-disabled-surface)");
    expect(disabled).toContain("var(--ui-color-muted)");
    expect(disabled).toContain("cursor: not-allowed");
  });
  it("«Modificado» es un chip soft/marca de 12/18/600, radio de control, mínimo 44px y con :disabled", () => {
    const chip = ruleBody(".activity-participation-modified .activity-modified");
    expect(chip).toContain("background: var(--ui-color-soft)");
    expect(chip).toContain("color: var(--ui-color-brand)");
    expect(chip).toContain("border-radius: var(--ui-radius-control)");
    expect(chip).toContain("font-size: .75rem");
    expect(chip).toContain("line-height: 1.125rem");
    expect(chip).toContain("font-weight: 600");
    expect(chip).toContain("min-height: 44px");
    expect(css).toContain(".activity-participation-modified .activity-modified:disabled");
    focus(ruleBody(".activity-participation-modified .activity-modified:focus-visible"));
  });
  it("la región explicativa es soft, con padding 12px y no fuerza display (respeta hidden)", () => {
    const region = ruleBody(".activity-participation-modified [role=\"region\"]");
    expect(region).toContain("background: var(--ui-color-soft)");
    expect(region).toContain("padding: 12px");
    expect(region).not.toContain("display:");
  });
});

describe("selector de destinos", () => {
  const stop = ".destination-picker__stop.ui-button";
  it("la parada conserva display block / izquierda / 100% y es una fila transparente en tinta", () => {
    const body = ruleBody(stop);
    expect(body).toContain("display: block");
    expect(body).toContain("text-align: left");
    expect(body).toContain("width: 100%");
    expect(body).toContain("background: transparent");
    expect(body).toContain(ink);
    expect(body).toContain("border-radius: var(--ui-radius-control)");
  });
  it("la parada actual suma una señal no cromática: borde de marca y check por pseudo-elemento", () => {
    const current = ruleBody(`${stop}[aria-current="true"]`);
    expect(current).toContain("box-shadow: inset 0 0 0 2px var(--ui-color-brand)");
    expect(current).toContain("position: relative");
    const check = ruleBody(`${stop}[aria-current="true"]::after`);
    expect(check).toContain('content: "\\2713"');
    expect(check).toContain("position: absolute");
    expect(check).toContain("color: var(--ui-color-brand)");
    expect(check).not.toMatch(/#[0-9a-f]{3,8}|opacity|clamp\(/i);
  });
  it("la parada actual es soft; la incompleta usa disabled-surface y muted (sin opacity)", () => {
    expect(ruleBody(`${stop}[aria-current="true"]`)).toContain("background: var(--ui-color-soft)");
    expect(ruleBody(`${stop}[aria-current="true"] .destination-picker__order`)).toContain("background: var(--ui-color-surface)");
    expect(ruleBody(`${stop}:hover:not(:disabled)`)).toContain("background: var(--ui-color-soft)");
    const disabled = ruleBody(`${stop}:disabled`);
    expect(disabled).toContain("background: var(--ui-color-disabled-surface)");
    expect(disabled).toContain("color: var(--ui-color-muted)");
    expect(disabled).toContain("cursor: not-allowed");
  });
  it("aro numerado de 28px redondo soft/marca; nombre 18/26/700; faltante 14/20 y fechas 12/18 muted en bloque", () => {
    const order = ruleBody(".destination-picker__order");
    expect(order).toContain("width: 28px");
    expect(order).toContain("height: 28px");
    expect(order).toContain("border-radius: var(--ui-radius-pill)");
    expect(order).toContain("background: var(--ui-color-soft)");
    expect(order).toContain("color: var(--ui-color-brand)");
    const name = ruleBody(".destination-picker__name");
    expect(name).toContain("font-size: 1.125rem");
    expect(name).toContain("line-height: 1.625rem");
    expect(name).toContain("font-weight: 700");
    const reason = ruleBody(".destination-picker__reason");
    expect(reason).toContain("display: block");
    expect(reason).toContain("font-size: .875rem");
    expect(reason).toContain("line-height: 1.25rem");
    expect(reason).toContain("color: var(--ui-color-muted)");
    const when = ruleBody(".destination-picker__when");
    expect(when).toContain("display: block");
    expect(when).toContain("font-size: .75rem");
    expect(when).toContain("line-height: 1.125rem");
    expect(when).toContain("color: var(--ui-color-muted)");
  });
  it("la capa del selector es hoja inferior en móvil (85dvh, radio superior) y diálogo centrado de 520px desde 600px", () => {
    expect(ruleBody(".destination-picker-layer .ui-modal-backdrop")).toContain("align-items: end");
    const modal = ruleBody(".destination-picker-layer .ui-modal");
    expect(modal).toContain("width: 100%");
    expect(modal).toContain("border-radius: 16px 16px 0 0");
    expect(modal).toContain("max-block-size: 85dvh");
    expect(modal).toContain("overflow-y: auto");
    const wide = mediaBlock("(min-width: 600px)");
    expect(wide).toContain(".destination-picker-layer .ui-modal-backdrop");
    expect(wide).toContain("align-items: center");
    expect(wide).toContain("min(100%, 520px)");
    expect(wide).toContain("border-radius: var(--ui-radius-card)");
    expect(ruleBody(".destination-picker-layer .ui-modal-backdrop")).not.toContain("z-index");
  });
});

describe("banner de destino y días", () => {
  it("banner de destino: radio card, padding 16, 1rem/700, conserva izquierda/ancho completo", () => {
    const banner = ruleBody(".itinerary-destination-banner.ui-button");
    expect(banner).toContain("border-radius: var(--ui-radius-card)");
    expect(banner).toContain("padding: 16px");
    expect(banner).toContain("font-size: 1rem");
    expect(banner).toContain("font-weight: 700");
    expect(banner).toContain("justify-content: flex-start");
    expect(banner).toContain("text-align: left");
    expect(banner).toContain("width: 100%");
  });
  it("el calendario se separa del destino (16px), los chips miden 64px sin ancho fijo y la tira deja sitio al foco", () => {
    expect(ruleBody(".itinerary-days-nav")).toContain("margin-top: 16px");
    const chip = ruleBody(".itinerary-day-chip.ui-button");
    expect(chip).toContain("min-height: 64px");
    expect(chip).not.toMatch(/(^|[\s;])(width|min-width|flex-basis)\s*:/);
    const strip = ruleBody(".itinerary-day-strip");
    expect(strip).toContain("overflow-x: auto");
    expect(strip).toContain("padding: 6px");
  });
});

describe("modales y formularios de actividad", () => {
  it("el diálogo usa padding 24 y título 24/32/700", () => {
    expect(ruleBody(".activity-dialog .ui-modal")).toContain("padding: 24px");
    const title = ruleBody(".activity-dialog .ui-modal__title, .participation-conflict-layer .ui-modal__title, .activity-confirm-layer .ui-modal__title");
    expect(title).toContain("font-size: 1.5rem");
    expect(title).toContain("line-height: 2rem");
    expect(title).toContain("font-weight: 700");
    expect(title).toContain("overflow-wrap: anywhere");
    expect(ruleBody(".participation-conflict-layer .ui-modal, .activity-confirm-layer .ui-modal")).toContain("padding: 24px");
  });
  it("botones de formulario y de confirmación a ancho completo, en columna con gap 12 y sin forzar 44px", () => {
    const widths = ruleBody(".activity-form > .ui-button, .participation-conflict-actions .ui-button, .activity-confirm-actions .ui-button");
    expect(widths).toContain("width: 100%");
    expect(widths).not.toContain("min-height");
    for (const selector of [".participation-conflict-actions", ".activity-confirm-actions"]) {
      const body = ruleBody(selector);
      expect(body).toContain("flex-direction: column");
      expect(body).toContain("gap: 12px");
    }
    expect(css).not.toMatch(/\.(participation-conflict|activity-confirm)-actions \.ui-button \{[^}]*min-height: 44px/);
  });
  it("la duración es un fieldset sin borde con leyenda 14/20/600", () => {
    const set = ruleBody(".activity-duration");
    for (const part of ["border: 0", "padding: 0", "min-width: 0", "display: grid"]) expect(set).toContain(part);
    const legend = ruleBody(".activity-duration legend");
    expect(legend).toContain("font-size: .875rem");
    expect(legend).toContain("line-height: 1.25rem");
    expect(legend).toContain("font-weight: 600");
  });
  it("la lista de conflictos no lleva viñetas: filas con divisor, plan en bloque y motivo muted", () => {
    expect(ruleBody(".participation-conflict-list")).toContain("list-style: none");
    const row = ruleBody(".participation-conflict-list li");
    expect(row).toContain("padding: 12px 0");
    expect(row).toContain("border-bottom: 1px solid var(--ui-color-border)");
    expect(row).toContain("color: var(--ui-color-muted)");
    expect(ruleBody(".participation-conflict-list strong")).toContain("display: block");
  });
  it("el detalle de transporte tiene jerarquía: h4 18/26/700, dt muted, listas con gap y marcador en tinta", () => {
    const heading = ruleBody(".activity-detail h4");
    expect(heading).toContain("font-size: 1.125rem");
    expect(heading).toContain("line-height: 1.625rem");
    expect(heading).toContain("font-weight: 700");
    expect(ruleBody(".transport-facts dt")).toContain("color: var(--ui-color-muted)");
    expect(ruleBody(".transport-steps li::marker, .transport-days li::marker")).toContain(ink);
  });
});

describe("invariantes del archivo", () => {
  it("sin hex, clamp( ni opacity que atenúe; los z-index de capas siguen en su línea", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toContain("clamp(");
    expect(css.replace(/opacity: 1;/g, "")).not.toContain("opacity");
    for (const line of [".activity-dialog .ui-modal-backdrop { z-index: 10; }", ".participation-conflict-layer .ui-modal-backdrop { z-index: 20; }", ".activity-confirm-layer .ui-modal-backdrop { z-index: 20; }"]) {
      expect(css.split("\n")).toContain(line);
    }
  });
  it("todo foco usa el token con offset de 3px", () => {
    for (const match of css.matchAll(/([^{}\n]*:focus(?:-visible)?)\s*\{([^}]*)\}/g)) {
      expect(match[2], match[1]).toContain("var(--ui-color-focus)");
      expect(match[2], match[1]).toContain("outline-offset: 3px");
    }
  });
});
