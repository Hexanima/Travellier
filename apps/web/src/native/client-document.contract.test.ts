import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const html = read("../../index.html");
const capacitor = read("../../capacitor.config.ts");
const android = read("../../android/app/src/main/AndroidManifest.xml");

describe("client document (T146)", () => {
  it("declares the document in Spanish with the product title", () => {
    expect(html).toMatch(/<html\s+lang="es"/);
    expect(html).toMatch(/<title>Travellier<\/title>/);
    expect(html).not.toContain("Clean Architecture Template");
  });

  it("keeps the viewport that covers the notch", () => {
    expect(html).toContain("viewport-fit=cover");
  });

  it("configures the keyboard resize mode with the plugin type (T149)", () => {
    expect(capacitor).toMatch(/import \{ KeyboardResize \} from "@capacitor\/keyboard";/);
    expect(capacitor).toMatch(/Keyboard:\s*\{[^}]*resize:\s*KeyboardResize\.Native/s);
    expect(capacitor).toMatch(/Keyboard:\s*\{[^}]*resizeOnFullScreen:\s*true/s);
    expect(capacitor).not.toMatch(/resize:\s*"native"/);
  });

  it("makes the Android main activity resize instead of panning under the keyboard", () => {
    const activity = android.slice(android.indexOf("<activity"), android.indexOf("</activity>"));
    expect(activity).toContain('android:name=".MainActivity"');
    expect(activity).toContain('android:windowSoftInputMode="adjustResize"');
  });
});
