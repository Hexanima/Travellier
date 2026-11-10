import { describe, expect, it } from "vitest";
import { itineraryFixture, itineraryId } from "../trips/itinerary-test-fixture.js";
import type { TripItineraryResponse } from "../trips/trip-itinerary-api.js";
import { buildItineraryIcs, icsFileName } from "./ics.js";

const exportedAt = new Date("2026-11-10T12:34:56.789Z");
const unfold = (text: string) => text.replace(/\r\n[ \t]/g, "");
const activityEvent = (mapsUrl: string | null) => {
  const itinerary = itineraryFixture() as TripItineraryResponse;
  itinerary.activities[0].mapsUrl = mapsUrl;
  const text = unfold(buildItineraryIcs({ tripName: "Viaje", itinerary, exportedAt }));
  const chunk = text.split("BEGIN:VEVENT\r\n").find((part) => part.includes(`activity-${itineraryId(8)}@`))!.split("END:VEVENT")[0];
  return { text, lines: chunk.split("\r\n").filter(Boolean) };
};
const field = (lines: string[], name: string) => lines.find((line) => line.startsWith(`${name}:`))?.slice(name.length + 1);

describe("ics place", () => {
  it("valid link with a place: LOCATION is the place and URL the normalized link", () => {
    const { lines } = activityEvent("https://www.google.com/maps/place/Plaza+San+Mart%C3%ADn/@-31.42,-64.18,17z");
    expect(field(lines, "LOCATION")).toBe("Plaza San Martín");
    expect(field(lines, "URL")).toBe("https://www.google.com/maps/place/Plaza+San+Mart%C3%ADn/@-31.42,-64.18,17z");
  });
  it("escapes commas and semicolons in LOCATION but leaves the URL value untouched", () => {
    const { lines } = activityEvent("https://www.google.com/maps/place/Caf%C3%A9%2C+Centro%3B+Norte");
    expect(field(lines, "LOCATION")).toBe("Café\\, Centro\\; Norte");
    expect(field(activityEvent("https://www.google.com/maps/@-31.42,-64.18,15z").lines, "URL")).toBe("https://www.google.com/maps/@-31.42,-64.18,15z");
  });
  it("only coordinates: LOCATION is lat,lng (escaped comma)", () => {
    const { lines } = activityEvent("https://www.google.com/maps/@-31.42,-64.18,15z");
    expect(field(lines, "LOCATION")).toBe("-31.42\\,-64.18");
    expect(field(lines, "URL")).toBeDefined();
  });
  it("shortener: only URL, nothing is resolved", () => {
    const { lines } = activityEvent("https://maps.app.goo.gl/abc123");
    expect(field(lines, "LOCATION")).toBeUndefined();
    expect(field(lines, "URL")).toBe("https://maps.app.goo.gl/abc123");
  });
  it.each([["invalid host", "https://evil.example/maps/place/Casa"], ["free text", "calle falsa 123"], ["javascript", "javascript:alert(1)"], ["empty", ""], ["none", null]])
  ("%s: neither LOCATION nor URL and the raw text is not dumped", (_name, value) => {
    const { lines, text } = activityEvent(value);
    expect(field(lines, "LOCATION")).toBeUndefined();
    expect(field(lines, "URL")).toBeUndefined();
    if (value) expect(text).not.toContain(value);
  });
});

/** Minimal structural validator: unfold, `NAME[;param=value]:value` per line and balanced BEGIN/END. */
function validate(text: string) {
  expect(text.endsWith("\r\n")).toBe(true);
  const stack: string[] = [];
  for (const line of unfold(text).split("\r\n").slice(0, -1)) {
    const match = /^([A-Z][A-Z0-9-]*)((?:;[A-Z][A-Z0-9-]*=[^:;]+)*):(.*)$/.exec(line);
    expect(match, line).not.toBeNull();
    // eslint-disable-next-line no-control-regex
    expect(match![3]).not.toMatch(/[\u0000-\u001f\u007f]/);
    if (match![1] === "BEGIN") stack.push(match![3]);
    if (match![1] === "END") expect(stack.pop()).toBe(match![3]);
  }
  expect(stack).toEqual([]);
}

describe("ics structure", () => {
  it("passes the structural validator with places, accents, long and hostile text", () => {
    const itinerary = itineraryFixture() as TripItineraryResponse;
    itinerary.activities[0].mapsUrl = "https://www.google.com/maps/place/Caf%C3%A9%2C+Centro/@-31.42,-64.18,17z";
    itinerary.activities[0].title = "Cena; 🌎 con vista, ñandú\nSegunda línea " + "x".repeat(200);
    itinerary.activities[0].description = "BEGIN:VEVENT\r\nEND:VCALENDAR\r\nlinea larga " + "é".repeat(120);
    itinerary.activities[0].durationMinutes = 45;
    const text = buildItineraryIcs({ tripName: "Viaje; a, Córdoba", itinerary, exportedAt });
    validate(text);
    expect(text.match(/^BEGIN:VEVENT/gm)).toHaveLength(5);
    expect(unfold(text).match(/^END:VCALENDAR/gm)).toHaveLength(1);
  });
  it("the validator itself rejects a malformed line", () => {
    expect(() => validate("BEGIN:VCALENDAR\r\nnot a property\r\nEND:VCALENDAR\r\n")).toThrow();
  });
});

describe("icsFileName", () => {
  it.each([
    ["Viaje a Córdoba", "travellier-viaje-a-cordoba.ics"],
    ["  Ñandú / Salta\\..:*?\"<>|  ", "travellier-nandu-salta.ics"],
    ["a\u0000b\nc", "travellier-a-b-c.ics"],
    ["..", "travellier-viaje.ics"],
    ["", "travellier-viaje.ics"],
    ["///", "travellier-viaje.ics"],
    ["🌎", "travellier-viaje.ics"],
  ])("%j -> %s", (name, expected) => { expect(icsFileName(name)).toBe(expected); });
  it("bounds the length and never ends the slug with a hyphen", () => {
    const name = icsFileName("palabra ".repeat(100));
    expect(name.length).toBeLessThanOrEqual(80);
    expect(name).toMatch(/^travellier-[a-z0-9]+(-[a-z0-9]+)*\.ics$/);
  });
});
