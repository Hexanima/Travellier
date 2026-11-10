import { buildCalendarEvents } from "./calendar-events.js";
import type { TripItineraryResponse } from "../trips/trip-itinerary-api.js";

/** Pure iCalendar (RFC 5545) builder: no Intl, no local zone, no I/O. Everything is UTC. */
const maxOctets = 75;
const encoder = new TextEncoder();

/** RFC 5545 TEXT excludes C0 controls (HTAB allowed; CR/LF are escaped before this runs) and DEL. Built from code points to avoid control-character regexes. */
const withoutControls = (value: string) => [...value].filter((char) => { const code = char.codePointAt(0)!; return code >= 0x20 ? code !== 0x7f : code === 0x09; }).join("");

/** TEXT escaping: backslash, semicolon, comma and every newline form (CRLF, CR, LF) become `\n`; other control characters are dropped. */
export const escapeText = (value: string) => withoutControls(value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n"));

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

const pad = (value: number, size = 2) => String(value).padStart(size, "0");
/** `YYYYMMDDTHHMMSSZ` in UTC. The iCalendar DATE-TIME has no fraction, so milliseconds are truncated to seconds. */
const formatUtc = (instant: Date) => `${pad(instant.getUTCFullYear(), 4)}${pad(instant.getUTCMonth() + 1)}${pad(instant.getUTCDate())}`
  + `T${pad(instant.getUTCHours())}${pad(instant.getUTCMinutes())}${pad(instant.getUTCSeconds())}Z`;

const fallbackTripName = "Viaje Travellier";

export const icsEventCount = (itinerary: TripItineraryResponse) => buildCalendarEvents(itinerary).length;

export type BuildIcsInput = { tripName: string; itinerary: TripItineraryResponse; exportedAt: Date };

/**
 * Static copy of the itinerary: every activity (no confirmation filter), transports and activity days, UID `<kind>-<ObjectId>@travellier`.
 * `exportedAt` is injected as DTSTAMP; there is no SEQUENCE nor LAST-MODIFIED because the itinerary carries no `updatedAt`.
 */
export function buildItineraryIcs({ tripName, itinerary, exportedAt }: BuildIcsInput): string {
  const stamp = formatUtc(exportedAt);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Travellier//Export ICS//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(tripName.trim() || fallbackTripName)}`];
  for (const event of buildCalendarEvents(itinerary)) {
    lines.push("BEGIN:VEVENT", `UID:${event.kind}-${event.id}@travellier`, `DTSTAMP:${stamp}`, `DTSTART:${formatUtc(event.start)}`);
    if (event.end) lines.push(`DTEND:${formatUtc(event.end)}`);
    lines.push(`SUMMARY:${escapeText(event.summary)}`);
    if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
    // URL is a URI value, not TEXT: the normalized href has no spaces or newlines and escaping would corrupt it.
    if (event.url) lines.push(`URL:${event.url}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** `travellier-<slug>.ics`: accents folded, anything that is not a letter or digit (paths, controls, emoji) becomes a separator. */
export function icsFileName(tripName: string): string {
  const slug = tripName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 60).replace(/-+$/, "");
  return `travellier-${slug || "viaje"}.ics`;
}
