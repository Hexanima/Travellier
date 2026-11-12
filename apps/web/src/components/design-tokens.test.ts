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
