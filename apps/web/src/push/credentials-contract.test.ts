import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Paths are relative to this file, so the test does not depend on the working directory.
const webRoot = fileURLToPath(new URL("../../", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const self = fileURLToPath(import.meta.url);
const posix = (path: string) => path.split(sep).join("/");

const trackedFiles = (): string[] | undefined => {
  try {
    return execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 })
      .split("\n").map((line) => line.trim()).filter(Boolean);
  } catch {
    return undefined;
  }
};
const tracked = trackedFiles();

const textExtensions = /\.(ts|tsx|js|mjs|json|xml|gradle|kts|java|kt|properties|swift|plist|pbxproj|md|txt|yml|yaml|html|css|pro|cfg)$/i;
const skipDirectories = new Set(["node_modules", "build", ".gradle", ".git", "dist", "Pods", ".swiftpm", "DerivedData"]);
const walk = (directory: string): string[] => {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return skipDirectories.has(name) ? [] : walk(path);
    return [path];
  });
};
/** Everything under src/ and android/ on disk, tracked or not; the ignored local google-services.json is the legitimate place for real values and is never part of the repository. */
const scanned = (): string[] =>
  [...walk(join(webRoot, "src")), ...walk(join(webRoot, "android"))]
    .filter((path) => path !== self && basename(path) !== "google-services.json" && textExtensions.test(path));

const privateKeyHeader = new RegExp(`-----BEGIN (?:[A-Z]+ )*PRIVATE ${"KEY"}-----`);
const googleApiKey = new RegExp(`${"AI"}za[0-9A-Za-z_-]{30,}`);
const fcmConfigValue = new RegExp(`"(?:private_key|private_key_id|client_email|mobilesdk_app_id|current_key|project_number)"\\s*:|${"firebase"}-adminsdk|\\bAAAA[0-9A-Za-z_-]{7}:[0-9A-Za-z_-]{100,}`);

describe("push credentials stay out of the repository", () => {
  it.skipIf(tracked === undefined)("does not track google-services.json, GoogleService-Info.plist or .p8 keys (needs git to list files)", () => {
    const forbidden = (tracked ?? []).filter((path) => {
      const name = basename(path);
      return name === "google-services.json" || name === "GoogleService-Info.plist" || /\.p8$/i.test(name);
    });
    expect(forbidden).toEqual([]);
  });

  it("the Android gitignore ignores google-services.json", () => {
    const lines = readFileSync(join(webRoot, "android", ".gitignore"), "utf8").split(/\r?\n/).map((line) => line.trim());
    expect(lines).toContain("app/google-services.json");
  });

  it("the root gitignore ignores .p8 keys", () => {
    const lines = readFileSync(join(repoRoot, ".gitignore"), "utf8").split(/\r?\n/).map((line) => line.trim());
    expect(lines).toContain("*.p8");
  });

  it("src/ and android/ hold no private keys, Google API keys or FCM configuration values", () => {
    const files = scanned();
    expect(files.length).toBeGreaterThan(20);
    const offenders = files.filter((path) => {
      const content = readFileSync(path, "utf8");
      return privateKeyHeader.test(content) || googleApiKey.test(content) || fcmConfigValue.test(content);
    }).map((path) => posix(relative(repoRoot, path)));
    expect(offenders).toEqual([]);
  });

  it("capacitor.config.ts does not reference credentials", () => {
    const config = readFileSync(join(webRoot, "capacitor.config.ts"), "utf8");
    expect(config).not.toMatch(/google-services|GoogleService|firebase|apiKey|serverKey|senderId|privateKey|private_key|secret|\.p8|token/i);
  });
});
