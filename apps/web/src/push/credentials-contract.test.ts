import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

const textExtensions = /\.(ts|tsx|js|mjs|json|xml|gradle|kts|java|kt|properties|swift|plist|pbxproj|xcconfig|entitlements|storyboard|md|txt|yml|yaml|html|css|pro|cfg)$/i;
const skipDirectories = new Set(["node_modules", "build", ".gradle", ".git", "dist", "Pods", ".swiftpm", "DerivedData"]);
const walk = (directory: string): string[] => {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return skipDirectories.has(name) ? [] : walk(path);
    return [path];
  });
};
const maxScannedBytes = 1024 * 1024;
/** Binary or oversized files are skipped explicitly: a NUL byte means binary, and anything over 1 MiB is not a configuration file. */
const readText = (path: string): string | undefined => {
  if (statSync(path).size > maxScannedBytes) return undefined;
  const buffer = readFileSync(path);
  return buffer.includes(0) ? undefined : buffer.toString("utf8");
};
/** Everything under src/, android/ and ios/ on disk, tracked or not; the ignored local google-services.json is the legitimate place for real values and is never part of the repository. */
const scannedIn = (...directories: string[]): string[] =>
  directories.flatMap((directory) => walk(join(webRoot, directory)))
    .filter((path) => path !== self && basename(path) !== "google-services.json" && textExtensions.test(path));
const scanned = (): string[] => scannedIn("src", "android", "ios");

const privateKeyHeader = new RegExp(`-----BEGIN (?:[A-Z]+ )*PRIVATE ${"KEY"}-----`);
const googleApiKey = new RegExp(`${"AI"}za[0-9A-Za-z_-]{30,}`);
const apnsKeyReference = /\bAuthKey_[0-9A-Za-z]+\.p8\b/;
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

  it("src/, android/ and ios/ hold no private keys, Google API keys, APNs key references or FCM configuration values", () => {
    const files = scanned();
    expect(files.length).toBeGreaterThan(20);
    const contents = files.map((path) => ({ path, content: readText(path) })).filter((item): item is { path: string; content: string } => item.content !== undefined);
    expect(contents.length).toBeGreaterThan(20);
    const offenders = contents.filter(({ content }) => privateKeyHeader.test(content) || googleApiKey.test(content) || apnsKeyReference.test(content) || fcmConfigValue.test(content))
      .map(({ path }) => posix(relative(repoRoot, path)));
    expect(offenders).toEqual([]);
  });

  it("the content of ios/ is actually scanned (not only its file names)", () => {
    const ios = scannedIn("ios").map((path) => posix(relative(webRoot, path)));
    expect(ios.length).toBeGreaterThanOrEqual(10);
    expect(ios.some((path) => path.endsWith("project.pbxproj"))).toBe(true);
    expect(ios.every((path) => path.startsWith("ios/"))).toBe(true);
    // The scan used by the content test includes them.
    expect(scanned().filter((path) => posix(relative(webRoot, path)).startsWith("ios/")).length).toBe(ios.length);
  });

  it("the detectors flag synthetic secrets and ignore binary files", () => {
    expect(privateKeyHeader.test(`-----BEGIN ${"PRIVATE"} KEY-----`)).toBe(true);
    expect(googleApiKey.test(`${"AI"}za${"x".repeat(35)}`)).toBe(true);
    expect(apnsKeyReference.test("AuthKey_ABC123DEF4.p8")).toBe(true);
    expect(fcmConfigValue.test('"private_key": "x"')).toBe(true);
    const directory = mkdtempSync(join(tmpdir(), "push-contract-"));
    try {
      const binary = join(directory, "asset.json");
      writeFileSync(binary, Buffer.from([0x7b, 0x00, 0xff, 0x00]));
      const text = join(directory, "plain.json");
      writeFileSync(text, "{}");
      expect(readText(binary)).toBeUndefined();
      expect(readText(text)).toBe("{}");
      for (const extension of ["xcconfig", "entitlements", "storyboard"]) expect(textExtensions.test(`Config.${extension}`)).toBe(true);
      const xcconfig = join(directory, "Debug.xcconfig");
      writeFileSync(xcconfig, `KEY = AuthKey_ABC123DEF4.p8`);
      expect(textExtensions.test(xcconfig)).toBe(true);
      expect(apnsKeyReference.test(readText(xcconfig) ?? "")).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("capacitor.config.ts does not reference credentials", () => {
    const config = readFileSync(join(webRoot, "capacitor.config.ts"), "utf8");
    expect(config).not.toMatch(/google-services|GoogleService|firebase|apiKey|serverKey|senderId|privateKey|private_key|secret|\.p8|token/i);
  });
});
