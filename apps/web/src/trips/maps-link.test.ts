import { describe, expect, it } from "vitest";
import { parseMapsLink } from "./maps-link.js";

const valid = (raw: string) => {
  const result = parseMapsLink(raw);
  if (result.kind !== "valid") throw new Error(`expected valid: ${raw}`);
  return result;
};

describe("parseMapsLink", () => {
  it.each([null, undefined, "", "   ", "\n\t "])("returns none for an absent value (%j)", (raw) => {
    expect(parseMapsLink(raw)).toEqual({ kind: "none" });
  });

  it.each([
    "https://maps.google.com/?q=Torre+Eiffel",
    "https://www.google.com/maps/place/Torre+Eiffel/@48.85,2.29,17z",
    "https://google.com/maps?q=1,2",
    "https://maps.apple.com/?ll=1,2&q=Caf%C3%A9",
    "https://maps.app.goo.gl/abc",
    "https://goo.gl/maps/abc",
    "https://maps.google.com:443/x",
    "  https://maps.google.com/x  ",
  ])("accepts an allowed https location (%s)", (raw) => {
    expect(parseMapsLink(raw).kind).toBe("valid");
  });

  it("returns the normalized href, never the raw string", () => {
    const result = valid("  https://MAPS.GOOGLE.COM:443/?q=a  ");
    expect(result.url).toBe("https://maps.google.com/?q=a");
    expect(result.host).toBe("maps.google.com");
    expect(valid("https://MAPS.GOOGLE.COM").url).toBe("https://maps.google.com/");
  });

  it.each(["https://maps.app.goo.gl/abc", "https://goo.gl/maps/abc"])("flags shorteners as open-only without place or coordinates (%s)", (raw) => {
    const result = valid(raw);
    expect(result.shortener).toBe(true);
    expect(result.place).toBeUndefined();
    expect(result.coordinates).toBeUndefined();
  });

  it("does not flag regular hosts as shorteners", () => {
    expect(valid("https://maps.google.com/?q=a").shortener).toBe(false);
  });

  it("does not extract anything from a shortener even with query data", () => {
    const result = valid("https://maps.app.goo.gl/abc?q=1,2");
    expect(result.coordinates).toBeUndefined();
    expect(result.place).toBeUndefined();
  });

  describe("coordinates", () => {
    it("reads @lat,lng from the path", () => {
      expect(valid("https://www.google.com/maps/place/Torre+Eiffel/@48.85,2.29,17z").coordinates).toEqual({ lat: 48.85, lng: 2.29 });
      expect(valid("https://www.google.com/maps/@-34.6,-58.38,15z").coordinates).toEqual({ lat: -34.6, lng: -58.38 });
    });
    it("reads q=lat,lng and ll=lat,lng", () => {
      const fromQ = valid("https://maps.google.com/?q=-34.6,-58.38");
      expect(fromQ.coordinates).toEqual({ lat: -34.6, lng: -58.38 });
      expect(fromQ.place).toBeUndefined();
      expect(valid("https://maps.google.com/?ll=10,20").coordinates).toEqual({ lat: 10, lng: 20 });
      expect(valid("https://maps.apple.com/?ll=1,2&q=Caf%C3%A9").coordinates).toEqual({ lat: 1, lng: 2 });
    });
    it.each([
      "https://maps.google.com/?q=91,10",
      "https://maps.google.com/?q=-91,10",
      "https://maps.google.com/?ll=10,181",
      "https://maps.google.com/?ll=10,-181",
      "https://maps.google.com/?ll=NaN,10",
      "https://maps.google.com/?ll=abc,def",
      "https://www.google.com/maps/@95,2,17z",
      "https://maps.google.com/?ll=1.12345678901234567890,2",
    ])("ignores out of range, NaN or over-long coordinates (%s)", (raw) => {
      expect(valid(raw).coordinates).toBeUndefined();
    });
    it("accepts the range limits", () => {
      expect(valid("https://maps.google.com/?ll=90,-180").coordinates).toEqual({ lat: 90, lng: -180 });
    });
  });

  describe("place text", () => {
    it("reads and decodes /maps/place/<text>, with + as a space", () => {
      expect(valid("https://www.google.com/maps/place/Torre+Eiffel/@48.85,2.29,17z").place).toBe("Torre Eiffel");
      expect(valid("https://www.google.com/maps/place/Caf%C3%A9%20Tortoni").place).toBe("Café Tortoni");
    });
    it("reads q=text and Apple q=", () => {
      expect(valid("https://maps.google.com/?q=Torre+Eiffel").place).toBe("Torre Eiffel");
      expect(valid("https://maps.apple.com/?ll=1,2&q=Caf%C3%A9").place).toBe("Café");
    });
    it("drops an undecodable place instead of throwing", () => {
      const result = valid("https://www.google.com/maps/place/%E0%A4%A/@1,2,3z");
      expect(result.place).toBeUndefined();
      expect(result.coordinates).toEqual({ lat: 1, lng: 2 });
    });
    it("trims and bounds the length", () => {
      expect(valid("https://maps.google.com/?q=%20%20Plaza%20%20").place).toBe("Plaza");
      expect(valid(`https://maps.google.com/?q=${"a".repeat(500)}`).place).toBeUndefined();
      expect(valid(`https://maps.google.com/?q=${"a".repeat(80)}`).place).toBe("a".repeat(80));
    });
    it("drops text with control characters", () => {
      expect(valid("https://maps.google.com/?q=a%00b").place).toBeUndefined();
      expect(valid("https://maps.google.com/?q=a%0Ab").place).toBeUndefined();
    });
    it("keeps literal markup as plain text for the caller to render as text", () => {
      expect(valid("https://www.google.com/maps/place/%3Cscript%3Ealert(1)%3C%2Fscript%3E").place).toBe("<script>alert(1)</script>");
    });
    it("is absent when the url carries no place", () => {
      expect(valid("https://maps.google.com/").place).toBeUndefined();
    });
  });

  it.each([
    "http://maps.google.com/x",
    "javascript:alert(1)",
    "data:text/html,x",
    "intent://maps.google.com/#Intent;scheme=https;end",
    "geo:0,0",
    "ftp://maps.google.com/x",
    "/relativo",
    "maps.google.com/x",
    "//maps.google.com",
    "https:maps.google.com",
    "mailto:a@b.c",
  ])("rejects a non-https or schemeless value (%s)", (raw) => {
    expect(parseMapsLink(raw)).toEqual({ kind: "invalid" });
  });

  it.each([
    "https://maps.google.com.evil.com/x",
    "https://evilmaps.google.com/x",
    "https://evil-maps.google.com.evil.com",
    "https://maps.google.com@evil.com",
    "https://user@maps.google.com",
    "https://user:pw@maps.google.com",
    "https://maps.google.com:8443",
    "https://maps.google.com:80",
    "https://mаps.google.com",
    "https://maps.google.com./x",
    "https://maps.google.com\\@evil.com",
    "https://maps.google.com\\x",
    "https://www.google.com/other",
    "https://www.google.com/",
    "https://www.google.com/mapsx",
    "https://google.com/search?q=maps",
    "https://goo.gl/other/abc",
    "https://goo.gl/",
    "https://maps.goo.gl/abc",
    "https://www.maps.google.com/x",
    "https://google.com.ar/maps",
    "https://g.co/kgs/abc",
    "https://share.google/abc",
  ])("rejects a lookalike or unlisted host/path (%s)", (raw) => {
    expect(parseMapsLink(raw)).toEqual({ kind: "invalid" });
  });

  it.each(["https://maps.google.com/a b", "https://maps.google.com/\tx", "https://maps.google.com/\u0000x", "https://maps.google.com/\u007fx"])("rejects whitespace and control characters (%j)", (raw) => {
    expect(parseMapsLink(raw)).toEqual({ kind: "invalid" });
  });

  it("rejects values longer than 2048 characters", () => {
    expect(parseMapsLink(`https://maps.google.com/?q=${"a".repeat(5000)}`)).toEqual({ kind: "invalid" });
    expect(parseMapsLink(`https://maps.google.com/?q=${"a".repeat(2048 - "https://maps.google.com/?q=".length)}`).kind).toBe("valid");
  });
});
