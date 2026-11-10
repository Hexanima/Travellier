import { afterEach, describe, expect, it, vi } from "vitest";
import { NativeCapabilityError } from "app-domain";
import { createExternalLink } from "./external-link.js";
import { createNativeCapabilities } from "./capabilities.js";
import type { NativeDependencies } from "./capabilities.js";

afterEach(() => vi.restoreAllMocks());
const url = "https://maps.google.com/?q=Torre+Eiffel";

describe("external link adapter", () => {
  it("opens the normalized url in a new context without opener or referrer", async () => {
    const open = vi.fn(() => ({}));
    expect(await createExternalLink({ open }).open("  https://MAPS.GOOGLE.COM/?q=a ")).toEqual({ ok: true, value: undefined });
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith("https://maps.google.com/?q=a", "_blank", "noopener,noreferrer");
  });

  it("treats a null window as opened: noopener makes the result unobservable", async () => {
    const open = vi.fn(() => null);
    expect(await createExternalLink({ open }).open(url)).toEqual({ ok: true, value: undefined });
  });

  it.each(["javascript:alert(1)", "http://maps.google.com/", "https://maps.google.com.evil.com/", "intent://x", "", "   ", "geo:0,0", "https://user@maps.google.com/"])(
    "never reaches the opener with an invalid url (%j)", async (value) => {
      const open = vi.fn();
      const result = await createExternalLink({ open }).open(value);
      expect(result).toMatchObject({ ok: false, error: { tag: "NativeCapabilityError", kind: "unsupported" } });
      expect(open).not.toHaveBeenCalled();
    });

  it("maps a throwing opener to a native error without leaking the raw message", async () => {
    const open = vi.fn(() => { throw new Error("secret detail https://maps.google.com/?q=private"); });
    const result = await createExternalLink({ open }).open(url);
    expect(result).toMatchObject({ ok: false, error: { kind: "native" } });
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(NativeCapabilityError);
      expect(result.error.message).not.toContain("secret");
      expect(result.error.message).not.toContain("private");
    }
  });

  it("does not log the url", async () => {
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error"), vi.spyOn(console, "info"), vi.spyOn(console, "debug")];
    await createExternalLink({ open: () => ({}) }).open(url);
    await createExternalLink({ open: () => { throw new Error("x"); } }).open(url);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("is built without effects and is exposed by the native capabilities", () => {
    const open = vi.fn();
    const dependencies = { platform: () => "web", camera: {}, push: {}, calendar: {}, externalLink: { open } } as unknown as NativeDependencies;
    const services = createNativeCapabilities(dependencies);
    expect(typeof services.externalLink.open).toBe("function");
    expect(open).not.toHaveBeenCalled();
  });
});
