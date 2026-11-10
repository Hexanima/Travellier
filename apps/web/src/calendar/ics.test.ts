import { describe, expect, it } from "vitest";
import { itineraryFixture } from "../trips/itinerary-test-fixture.js";
import type { TripItineraryResponse } from "../trips/trip-itinerary-api.js";
import { buildItineraryIcs } from "./ics.js";

const exportedAt = new Date("2026-11-10T12:34:56.789Z");
const empty = (): TripItineraryResponse => ({ ...(itineraryFixture() as TripItineraryResponse), days: [], transports: [], activities: [] });
const build = (tripName: string, itinerary: TripItineraryResponse = empty()) => buildItineraryIcs({ tripName, itinerary, exportedAt });
/** RFC 5545 unfolding: CRLF followed by one space or tab continues the previous line. */
const unfold = (text: string) => text.replace(/\r\n[ \t]/g, "");
const physicalLines = (text: string) => text.split("\r\n").slice(0, -1);
/** RFC 5545 TEXT excludes C0 controls (except HTAB, and CR/LF only as the line terminator) and DEL. */
const hasControl = (text: string) => [...text.replace(/\r\n/g, "")].some((char) => { const code = char.codePointAt(0)!; return (code < 0x20 && code !== 0x09) || code === 0x7f; });

describe("ics base format", () => {
  it("is a balanced VCALENDAR with CRLF line ends and a final CRLF", () => {
    const text = build("Viaje a Córdoba");
    expect(text.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(text.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    expect(text.match(/^BEGIN:/gm)).toHaveLength(text.match(/^END:/gm)!.length);
  });
  it("declares the fixed header and no other X- property", () => {
    const lines = physicalLines(build("Viaje a Córdoba"));
    expect(lines).toEqual(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Travellier//Export ICS//ES", "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH", "X-WR-CALNAME:Viaje a Córdoba", "END:VCALENDAR"]);
    expect(unfold(build("x")).match(/^X-[A-Z-]+/gm)).toEqual(["X-WR-CALNAME"]);
    expect(build("x")).not.toMatch(/X-WR-TIMEZONE|VTIMEZONE|SEQUENCE|LAST-MODIFIED/);
  });
  it("escapes TEXT: backslash, semicolon, comma and any newline form", () => {
    expect(unfold(build("a\\b; c, d\ne\r\nf\rg"))).toContain("X-WR-CALNAME:a\\\\b\\; c\\, d\\ne\\nf\\ng\r\n");
  });
  it("folds at 75 octets without splitting multibyte characters and unfolds back to the original", () => {
    for (const name of ["ñandú ".repeat(40).trim(),"a".repeat(200), "🌎✈️".repeat(40), "á🌎".repeat(37), "€".repeat(80)]) {
      const text = build(name);
      for (const line of physicalLines(text)) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
      // A split inside a code point would leave a lone surrogate or a replacement character.
      expect(text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]|�/);
      expect(unfold(text)).toContain(`X-WR-CALNAME:${name}\r\n`);
      expect(physicalLines(text).some((line) => line.startsWith(" "))).toBe(true);
    }
  });
  describe("control characters", () => {
    const hostile = "a\u0000b\u0008c\u000bd\u000ce\u000ef\u001fg\u007fh";
    it("the structural check detects controls if they slipped through", () => {
      expect(hasControl("ok\tfine\r\n")).toBe(false);
      for (const code of ["\u0000", "\u0008", "\u000b", "\u000c", "\u001f", "\u007f"]) expect(hasControl(`x${code}y`)).toBe(true);
    });
    it("strips them from the calendar name and keeps the rest of the text and HTAB", () => {
      const text = build(hostile);
      expect(hasControl(text)).toBe(false);
      expect(unfold(text)).toContain("X-WR-CALNAME:abcdefgh\r\n");
      expect(unfold(build("a\tb"))).toContain("X-WR-CALNAME:a\tb\r\n");
    });
    it("strips them from title, description and place of events", () => {
      const value = empty();
      value.activities = [{ ...(itineraryFixture() as TripItineraryResponse).activities[0], title: hostile, description: `d${hostile}\tz`,
        mapsUrl: `https://www.google.com/maps/place/Lugar${encodeURIComponent("\u0001")}Raro/@-31.4,-64.2,15z` }];
      const text = build("Viaje", value);
      expect(hasControl(text)).toBe(false);
      const unfolded = unfold(text);
      expect(unfolded).toContain("SUMMARY:abcdefgh\r\n");
      expect(unfolded).toContain("DESCRIPTION:dabcdefgh\tz\r\n");
    });
  });
});
