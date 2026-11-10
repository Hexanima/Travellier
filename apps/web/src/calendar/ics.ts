import type { TripItineraryResponse } from "../trips/trip-itinerary-api.js";

/** Pure iCalendar (RFC 5545) builder: no Intl, no local zone, no I/O. Everything is UTC. */
const maxOctets = 75;
const encoder = new TextEncoder();

/** TEXT escaping: backslash, semicolon, comma and every newline form (CRLF, CR, LF) become `\n`. */
export const escapeText = (value: string) => value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");

/** Folds a logical line at 75 octets (UTF-8) with `CRLF + space`; whole code points only (surrogate pairs included). */
export function foldLine(line: string): string {
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const width = encoder.encode(char).length;
    // Continuation lines start with a space that counts toward the 75 octets.
    if (size + width > maxOctets) { parts.push(current); current = " "; size = 1; }
    current += char; size += width;
  }
  parts.push(current);
  return parts.join("\r\n");
}

export type BuildIcsInput = { tripName: string; itinerary: TripItineraryResponse; exportedAt: Date };

export function buildItineraryIcs({ tripName }: BuildIcsInput): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Travellier//Export ICS//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(tripName)}`, "END:VCALENDAR"];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
