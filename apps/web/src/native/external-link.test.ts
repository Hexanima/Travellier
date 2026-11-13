import { afterEach, describe, expect, it, vi } from "vitest";
import { NativeCapabilityError } from "app-domain";
import { createExternalLink } from "./external-link.js";
import { createNativeCapabilities } from "./capabilities.js";
import type { NativeDependencies } from "./capabilities.js";

afterEach(() => vi.restoreAllMocks());
const url = "https://maps.google.com/?q=Torre+Eiffel";
const launcherOk = () => ({ openUrl: vi.fn(async () => ({ completed: true })) });

describe("external link adapter", () => {
  it.each(["android", "ios"])("opens the normalized url with the native launcher on %s", async (platform) => {
    const launcher = launcherOk();
    const open = vi.fn(() => ({}));
    expect(await createExternalLink({ launcher, open }, () => platform).open("  https://MAPS.GOOGLE.COM/?q=a ")).toEqual({ ok: true, value: undefined });
    expect(launcher.openUrl).toHaveBeenCalledTimes(1);
    expect(launcher.openUrl).toHaveBeenCalledWith({ url: "https://maps.google.com/?q=a" });
    expect(open).not.toHaveBeenCalled();
  });

  it("falls back to the webview opener outside android and ios, without touching the launcher", async () => {
    const launcher = launcherOk();
    const open = vi.fn(() => ({}));
    expect(await createExternalLink({ launcher, open }, () => "web").open("  https://MAPS.GOOGLE.COM/?q=a ")).toEqual({ ok: true, value: undefined });
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith("https://maps.google.com/?q=a", "_blank", "noopener,noreferrer");
    expect(launcher.openUrl).not.toHaveBeenCalled();
  });

  it("treats a null window as opened: noopener makes the result unobservable", async () => {
    const open = vi.fn(() => null);
    expect(await createExternalLink({ launcher: launcherOk(), open }, () => "web").open(url)).toEqual({ ok: true, value: undefined });
  });

  it("maps an incomplete native launch to a native error", async () => {
    const launcher = { openUrl: vi.fn(async () => ({ completed: false })) };
    const result = await createExternalLink({ launcher, open: vi.fn() }, () => "android").open(url);
    expect(result).toMatchObject({ ok: false, error: { tag: "NativeCapabilityError", kind: "native" } });
  });

  it.each(["javascript:alert(1)", "http://maps.google.com/", "https://maps.google.com.evil.com/", "intent://x", "", "   ", "geo:0,0", "https://user@maps.google.com/"])(
    "never reaches the opener or the launcher with an invalid url (%j)", async (value) => {
      const launcher = launcherOk();
      const open = vi.fn();
      for (const platform of ["android", "ios", "web"]) {
        const result = await createExternalLink({ launcher, open }, () => platform).open(value);
        expect(result).toMatchObject({ ok: false, error: { tag: "NativeCapabilityError", kind: "unsupported" } });
      }
      expect(open).not.toHaveBeenCalled();
      expect(launcher.openUrl).not.toHaveBeenCalled();
    });

  it.each([
    ["web", { launcher: launcherOk(), open: () => { throw new Error("secret detail https://maps.google.com/?q=private"); } }],
    ["ios", { launcher: { openUrl: async () => { throw new Error("secret detail https://maps.google.com/?q=private"); } }, open: vi.fn() }],
  ] as const)("maps a throwing opener to a native error without leaking the raw message (%s)", async (platform, dependencies) => {
    const result = await createExternalLink(dependencies, () => platform).open(url);
    expect(result).toMatchObject({ ok: false, error: { kind: "native" } });
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(NativeCapabilityError);
      expect(result.error.message).not.toContain("secret");
      expect(result.error.message).not.toContain("private");
    }
  });

  it("does not log the url on any platform", async () => {
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error"), vi.spyOn(console, "info"), vi.spyOn(console, "debug")];
    const throwing = () => { throw new Error("x"); };
    await createExternalLink({ launcher: launcherOk(), open: () => ({}) }, () => "web").open(url);
    await createExternalLink({ launcher: launcherOk(), open: throwing }, () => "web").open(url);
    await createExternalLink({ launcher: launcherOk(), open: vi.fn() }, () => "android").open(url);
    await createExternalLink({ launcher: { openUrl: async () => ({ completed: false }) }, open: vi.fn() }, () => "ios").open(url);
    await createExternalLink({ launcher: { openUrl: throwing }, open: vi.fn() }, () => "ios").open(url);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("is built without effects and is exposed by the native capabilities", () => {
    const open = vi.fn();
    const launcher = launcherOk();
    const dependencies = { platform: () => "web", camera: {}, push: {}, calendar: {}, externalLink: { launcher, open } } as unknown as NativeDependencies;
    const services = createNativeCapabilities(dependencies);
    expect(typeof services.externalLink.open).toBe("function");
    expect(open).not.toHaveBeenCalled();
    expect(launcher.openUrl).not.toHaveBeenCalled();
  });
});
