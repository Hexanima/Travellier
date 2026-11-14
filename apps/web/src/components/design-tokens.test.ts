import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * jsdom no calcula estilos reales: este test fija el contrato de tokens de design/prototype/DESIGN.md sobre el
 * texto de los CSS. No sustituye una revisión visual a 320/390 px y pantalla amplia.
 */
const srcDir = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, srcDir), "utf8").replace(/\r\n/g, "\n");
const components = read("components/components.css");
const index = read("index.css");

const cssFiles = (readdirSync(srcDir, { recursive: true }) as string[])
  .map((entry) => entry.split("\\").join("/"))
  .filter((entry) => entry.endsWith(".css"));

/** Cuerpo de la última regla `selector {` (la de medidas, tras la de bordes agrupados). */
const ruleBody = (css: string, selector: string) => {
  const start = css.lastIndexOf(`${selector} {`);
  if (start < 0) return "";
  return css.slice(start + selector.length + 2).split("}")[0] ?? "";
};
const outsideMotionQuery = (css: string) =>
  css.replace(/@media \(prefers-reduced-motion: no-preference\) \{(?:[^{}]*\{[^{}]*\})*\s*\}/g, "");

describe("design tokens", () => {
  const tokens: Record<string, string> = {
    "--ui-color-brand": "#16324f",
    "--ui-color-brand-pressed": "#11263a",
    "--ui-color-focus": "#264b70",
    "--ui-color-text": "#1c2c3c",
    "--ui-color-muted": "#5e6c79",
    "--ui-color-paper": "#faf8f4",
    "--ui-color-surface": "#ffffff",
    "--ui-color-soft": "#eaf0f6",
    "--ui-color-on-brand-muted": "#c5d5e5",
    "--ui-color-border": "#d9dfe4",
    "--ui-color-disabled-surface": "#f0ebe3",
    "--ui-color-danger": "#bc3030",
    "--ui-color-form-error": "#a13333",
    "--ui-color-success-surface": "#e6f2eb",
    "--ui-color-success": "#25634b",
    "--ui-radius-control": "12px",
    "--ui-radius-card": "16px",
    "--ui-radius-linked": "8px",
    "--ui-radius-pill": "999px",
  };
  const root = /:root\s*\{([^}]*)\}/.exec(components)?.[1] ?? "";

  it.each(Object.entries(tokens))("defines %s as %s", (name, value) => {
    expect(root).toContain(`${name}: ${value};`);
  });

  it("keeps the accent token as an alias of the brand", () => {
    expect(root).toContain("--ui-color-accent: var(--ui-color-brand);");
  });

  it("uses Manrope with system fallbacks", () => {
    expect(components + index).toContain("Manrope, system-ui, sans-serif");
    expect(index).toMatch(/@font-face\s*\{[^}]*font-family: "?Manrope"?[^}]*display: swap/);
    const src = /url\("?\.\/(assets\/fonts\/manrope\.woff2)"?\)/.exec(index)?.[1];
    expect(src).toBeDefined();
    expect(existsSync(new URL(src ?? "missing", srcDir))).toBe(true);
  });

  it("does not keep the inherited green/brown palette or Inter in any stylesheet", () => {
    const banned = ["#286053", "#1c4c42", "#8dbdb0", "#18202f", "#f6f7f9", "#526270", "#d6dde3", "#667582",
      "#4b6b7a", "#bdcdd2", "#d9e2f2"];
    expect(cssFiles.length).toBeGreaterThan(2);
    for (const file of cssFiles) {
      const css = read(file).toLowerCase();
      for (const hex of banned) expect(css, `${file} contains ${hex}`).not.toContain(hex);
      expect(css, `${file} mentions Inter`).not.toMatch(/\binter\b/);
    }
  });
});

describe("control geometry and states", () => {
  it("sizes buttons at 52px and fields at 56px with touch targets of at least 44px", () => {
    expect(ruleBody(components, ".ui-button")).toMatch(/min-height: 52px/);
    expect(ruleBody(components, ".ui-control")).toMatch(/min-height: 56px/);
    expect(ruleBody(components, ".ui-password-toggle")).toMatch(/min-height: 44px/);
    expect(ruleBody(components, ".ui-modal__close")).toMatch(/min-height: 44px/);
  });

  it("keeps the left-aligned layout of composite ui-buttons under inline-flex", () => {
    const itinerary = read("trips/itinerary.css");
    const stop = ruleBody(itinerary, ".destination-picker__stop.ui-button");
    expect(stop).toMatch(/display: block/);
    expect(stop).toMatch(/text-align: left/);
    expect(stop).toMatch(/width: 100%/);
    const banner = ruleBody(itinerary, ".itinerary-destination-banner.ui-button");
    expect(banner).toMatch(/justify-content: flex-start/);
    expect(banner).toMatch(/text-align: left/);
    expect(banner).toMatch(/width: 100%/);
    expect(ruleBody(itinerary, ".destination-picker__when")).toMatch(/display: block/);
  });

  it("styles the disabled modal close with tokens instead of opacity", () => {
    const disabled = ruleBody(components, ".ui-modal__close:disabled");
    expect(disabled).toMatch(/background: var\(--ui-color-disabled-surface\)/);
    expect(disabled).toMatch(/color: var\(--ui-color-muted\)/);
    expect(disabled).toMatch(/cursor: not-allowed/);
    expect(disabled).not.toMatch(/opacity/);
  });

  it("uses a 3px focus outline offset by 3px on buttons and 2px on fields", () => {
    expect(ruleBody(components, ".ui-button:focus-visible")).toMatch(/outline: 3px solid[^;]*;[\s\S]*outline-offset: 3px/);
    expect(ruleBody(components, ".ui-control:focus-visible")).toMatch(/outline: 2px solid[^;]*;[\s\S]*outline-offset: 3px/);
  });

  it("applies card radius to cards, lists, feedback and modals", () => {
    for (const selector of [".ui-feedback", ".ui-modal"]) {
      expect(ruleBody(components, selector)).toContain("var(--ui-radius-card)");
    }
    expect(components).toMatch(/\.ui-list__item,\s*\.ui-list__state\s*\{[^}]*var\(--ui-radius-card\)/);
  });

  it("uses the label typography (14px/600/20px) on buttons", () => {
    const body = ruleBody(components, ".ui-button");
    expect(body).toMatch(/font-size: 0\.875rem/);
    expect(body).toMatch(/font-weight: 600/);
    expect(body).toMatch(/line-height: 20px/);
  });

  it("keeps enabled colors while loading for both disabled and aria-disabled buttons", () => {
    const busy = ':is(:disabled, [aria-disabled="true"])';
    const primary = ruleBody(components, `.ui-button[aria-busy="true"]${busy}`);
    expect(primary).toContain("background: var(--ui-color-brand)");
    expect(primary).toContain("color: var(--ui-color-accent-contrast)");
    expect(primary).toContain("cursor: progress");
    const secondary = ruleBody(components, `.ui-button--secondary[aria-busy="true"]${busy}`);
    expect(secondary).toContain("background: var(--ui-color-surface)");
    expect(secondary).toContain("color: var(--ui-color-brand)");
    expect(ruleBody(components, `.ui-button[data-error="true"][aria-busy="true"]${busy}`)).toContain("var(--ui-color-danger)");
  });

  it("styles disabled, aria-disabled and aria-busy states", () => {
    expect(components).toContain(".ui-button:disabled");
    expect(components).toContain('.ui-button[aria-disabled="true"]');
    expect(components).toContain('.ui-button[aria-busy="true"]');
    expect(components).toContain(".ui-control:disabled");
    expect(components).toContain('.ui-control[aria-busy="true"]');
  });

  it("limits transitions and the pressed translate to prefers-reduced-motion: no-preference", () => {
    expect(components).toMatch(/@media \(prefers-reduced-motion: no-preference\)/);
    expect(components).toMatch(/transition:[^;]*150ms/);
    expect(components).toMatch(/translateY\(1px\)/);
    const rest = outsideMotionQuery(components);
    expect(rest).not.toContain("transition:");
    expect(rest).not.toContain("translateY");
  });
});

describe("itinerary overrides, focus and type scale", () => {
  const itinerary = read("trips/itinerary.css");
  const app = read("App.css");
  const rule = (css: string, selector: string) => {
    const start = css.indexOf(selector);
    return start < 0 ? "" : css.slice(css.indexOf("{", start) + 1).split("}")[0] ?? "";
  };

  it("does not lower the contrast of the loading Maps button with opacity", () => {
    expect(rule(itinerary, '.location-preview__open[aria-disabled="true"]')).not.toContain("opacity");
  });

  it("keeps disabled itinerary buttons distinguishable with disabled-surface and muted", () => {
    for (const selector of [
      '.activity-participation-actions .ui-button:disabled:not([aria-pressed="true"]):not([aria-busy="true"])',
      '.activity-participation-modified .activity-modified:disabled:not([aria-busy="true"])',
      '.memory-tab.ui-button:disabled:not([aria-selected="true"]):not([aria-busy="true"])',
    ]) {
      const body = rule(itinerary, selector);
      expect(body, selector).toContain("var(--ui-color-disabled-surface)");
      expect(body, selector).toContain("var(--ui-color-muted)");
      expect(body, selector).toContain("cursor: not-allowed");
    }
    const title = rule(itinerary, ".activity-title.ui-button:disabled, .transport-title.ui-button:disabled");
    expect(title).toContain("var(--ui-color-muted)");
    expect(rule(itinerary, '.activity-participation-actions .ui-button[aria-pressed="true"]:disabled')).toContain("cursor: not-allowed");
  });

  it("keeps disabled state on App.css journey step buttons", () => {
    for (const selector of [
      '.journey-step-heading .ui-button:disabled:not([aria-busy="true"])',
      '.journey-step-heading .ui-button[aria-disabled="true"]:not([aria-busy="true"])',
    ]) {
      const body = rule(app, selector);
      expect(body, selector).toContain("var(--ui-color-disabled-surface)");
      expect(body, selector).toContain("var(--ui-color-muted)");
      expect(body, selector).toContain("cursor: not-allowed");
    }
  });

  it("gives every .ui-button background/color override outside components.css its own disabled rule", () => {
    for (const file of cssFiles.filter((f) => f !== "components/components.css")) {
      const css = read(file);
      // Un comentario antes de una regla no es parte de su selector: se quita antes de leer los selectores.
      const selectors = css.replace(/\/\*[\s\S]*?\*\//g, "");
      for (const match of selectors.matchAll(/^([^{}@\n][^{}]*)\{([^}]*)\}/gm)) {
        const body = match[2] ?? "";
        if (!/(^|[\s;])(background|color)\s*:/.test(body)) continue;
        for (const sel of (match[1] ?? "").split(",").map((x) => x.trim())) {
          if (!/\.ui-button(?![\w-])/.test(sel) || /:(hover|disabled|focus)|\[aria-/.test(sel)) continue;
          if (/background:\s*transparent/.test(body) && /\.(activity|transport)-title/.test(sel)) continue;
          expect(css, `${file}: ${sel}`).toContain(`${sel}:disabled`);
        }
      }
    }
  });

  it("uses the focus token, 3px outline and 3px offset in programmatic :focus rules", () => {
    for (const file of cssFiles) {
      const css = read(file);
      for (const match of css.matchAll(/:focus\s*\{([^}]*)\}/g)) {
        const body = match[1] ?? "";
        expect(body, `${file}: ${body}`).toMatch(/outline: 3px solid var\(--ui-color-focus\)/);
        expect(body, `${file}: ${body}`).toMatch(/outline-offset: 3px/);
      }
      for (const match of css.matchAll(/([^{}]*)\{([^}]*outline-offset[^}]*)\}/g)) {
        expect(match[2], `${file}: ${match[1]}`).toMatch(/outline-offset: 3px/);
      }
    }
    expect(read("trips/itinerary.css")).toMatch(/\.transport-dialog h3:focus\s*\{[^}]*outline: 3px solid var\(--ui-color-focus\)/);
  });

  it("uses the focus token with a 3px offset in every focus-visible rule", () => {
    for (const file of cssFiles) {
      const css = read(file);
      for (const match of css.matchAll(/:focus-visible\s*\{([^}]*)\}/g)) {
        const body = match[1] ?? "";
        expect(body, `${file}: ${body}`).toContain("var(--ui-color-focus)");
        expect(body, `${file}: ${body}`).toMatch(/outline-offset: 3px/);
      }
    }
  });

  it("keeps link-like titles at 44px, start aligned", () => {
    const body = rule(itinerary, ".activity-title.ui-button, .transport-title.ui-button");
    expect(body).toContain("min-height: 44px");
    expect(body).toContain("justify-content: flex-start");
  });

  it("uses the DESIGN.md scale (title 24/32 for screens, heading 18/26 for days) without clamp", () => {
    for (const file of cssFiles) expect(read(file), file).not.toContain("clamp(");
    expect(rule(app, "h1")).toMatch(/font-size: 1\.5rem;[\s\S]*line-height: 2rem/);
    expect(rule(app, ".trips-header h1,\n.trip-form-panel h1")).toMatch(/font-size: 1\.5rem/);
    expect(rule(itinerary, ".itinerary-header h1")).toMatch(/font-size: 1\.5rem; line-height: 2rem/);
    expect(rule(itinerary, ".itinerary-day h2")).toMatch(/font-size: 1\.125rem; line-height: 1\.625rem/);
  });
});
