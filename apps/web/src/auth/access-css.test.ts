import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** jsdom no calcula estilos: fija el contrato visual de bienvenida, acceso y perfil sobre el texto de App.css. No sustituye revisión en dispositivo. */
const srcDir = new URL("../", import.meta.url);
const app = readFileSync(new URL("App.css", srcDir), "utf8").replace(/\r\n/g, "\n");
const ruleBody = (css: string, selector: string) => {
  const lines = css.split("\n");
  const index = lines.findIndex((line) => line.trim().startsWith(`${selector} {`));
  if (index < 0) return "";
  return css.slice(css.indexOf(`${selector} {`, css.split("\n").slice(0, index).join("\n").length) + selector.length + 2).split("}")[0] ?? "";
};
const mobile = app.slice(app.indexOf("@media (max-width: 359px)"));

describe("bienvenida, acceso y perfil", () => {
  it("welcome-brand: marca sobre accent-contrast, radio de card y relleno 32/24", () => {
    const brand = ruleBody(app, ".welcome-brand");
    expect(brand).toContain("background: var(--ui-color-brand)");
    expect(brand).toContain("color: var(--ui-color-accent-contrast)");
    expect(brand).toContain("border-radius: var(--ui-radius-card)");
    expect(brand).toContain("padding: 32px 24px");
    expect(ruleBody(app, ".welcome-brand p")).toContain("color: var(--ui-color-on-brand-muted)");
    expect(ruleBody(app, ".welcome-brand h1")).toContain("font-size: 2rem");
    expect(ruleBody(app, ".welcome-brand h1")).toContain("line-height: 2.5rem");
  });

  it("bajo 360px reduce el h1 de bienvenida a 28/36 y el relleno del acceso a 16px", () => {
    expect(app).toContain("@media (max-width: 359px)");
    expect(ruleBody(mobile, ".welcome-brand h1")).toContain("font-size: 1.75rem");
    expect(ruleBody(mobile, ".welcome-brand h1")).toContain("line-height: 2.25rem");
    expect(ruleBody(mobile, ".access-shell")).toContain("16px");
  });

  it("el avatar del perfil mide 80px y el resumen se centra", () => {
    const avatar = ruleBody(app, ".profile-avatar");
    expect(avatar).toContain("width: 80px");
    expect(avatar).toContain("height: 80px");
    expect(avatar).toContain("border-radius: 50%");
    const summary = ruleBody(app, ".profile-summary");
    expect(summary).toContain("align-items: center");
    expect(summary).toContain("min-width: 0");
  });

  it("nombre y email largos se parten sin desbordar", () => {
    // El quiebre viene de la regla base de index.css para p: acá solo se fija que el elemento pueda encogerse.
    for (const selector of [".profile-name", ".profile-email"]) {
      expect(ruleBody(app, selector)).toContain("min-width: 0");
    }
    expect(ruleBody(app, ".auth-panel")).toContain("min-width: 0");
  });

  it("el ancho completo se acota a los formularios de acceso y a los enlaces de bienvenida, no es global", () => {
    expect(ruleBody(app, ".auth-form .ui-button")).toContain("width: 100%");
    expect(ruleBody(app, ".welcome-actions .ui-button")).toContain("width: 100%");
    expect(app).not.toMatch(/(^|\n)\.ui-button \{[^}]*width: 100%/);
  });

  it("el foco usa el token con contorno y desplazamiento de 3px", () => {
    const focus = ruleBody(app, ".auth-switch a:focus-visible");
    expect(focus).toContain("outline: 3px solid var(--ui-color-focus)");
    expect(focus).toContain("outline-offset: 3px");
  });

  it("no usa clamp ni colores literales y los enlaces del acceso mantienen 44px táctiles", () => {
    expect(app).not.toContain("clamp(");
    expect(app).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(ruleBody(app, ".auth-switch a")).toContain("min-height: 44px");
  });

  it("ningún override de .ui-button del acceso cambia fondo o color sin su :disabled", () => {
    const overrides = [...app.matchAll(/(^|\n)((?:\.auth|\.welcome|\.profile)[^{\n]*\.ui-button[^{\n,]*) \{([^}]*)\}/g)];
    for (const [, , selector, body] of overrides) {
      if (/background|(^|[;\s])color:/.test(body ?? "")) {
        expect(app, `${selector} requiere :disabled`).toContain(`${selector}:disabled`);
      }
    }
  });
});
