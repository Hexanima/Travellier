import { describe, expect, it } from "vitest";

import { resolveDeepLinkUrl } from "./deep-link.js";

describe("resolveDeepLinkUrl", () => {
  it("maps a custom-scheme URL to an internal route", () => {
    expect(resolveDeepLinkUrl("com.travellier.app://invite/VIAJE-X7K2?source=share")).toBe(
      "/invite/VIAJE-X7K2?source=share",
    );
  });

  it("maps the default Capacitor application scheme to an internal route", () => {
    expect(resolveDeepLinkUrl("com.travellier.app://trips/abc123")).toBe(
      "/trips/abc123",
    );
  });

  it("ignores URLs outside the application scheme", () => {
    expect(resolveDeepLinkUrl("https://example.com/invite/VIAJE-X7K2")).toBeNull();
  });

  it("ignores the deprecated placeholder scheme", () => {
    expect(resolveDeepLinkUrl("com.tuapp://invite/VIAJE-X7K2")).toBeNull();
  });

  it("ignores malformed URLs", () => {
    expect(resolveDeepLinkUrl("not a url")).toBeNull();
  });
});
