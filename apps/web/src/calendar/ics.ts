import { activityEndsAt } from "app-domain";
import { parseMapsLink } from "../trips/maps-link.js";
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

const pad = (value: number, size = 2) => String(value).padStart(size, "0");
/** `YYYYMMDDTHHMMSSZ` in UTC. The iCalendar DATE-TIME has no fraction, so milliseconds are truncated to seconds. */
const formatUtc = (instant: Date) => `${pad(instant.getUTCFullYear(), 4)}${pad(instant.getUTCMonth() + 1)}${pad(instant.getUTCDate())}`
  + `T${pad(instant.getUTCHours())}${pad(instant.getUTCMinutes())}${pad(instant.getUTCSeconds())}Z`;
const wholeSeconds = (instant: Date) => Math.floor(instant.getTime() / 1000);

const transportLabels = { bus_local: "Colectivo", bus_long: "Ómnibus", flight: "Avión", car: "Auto", other: "Otro transporte" } as const;
const fallbackTripName = "Viaje Travellier";

type IcsEvent = { kind: "activity" | "day" | "transport"; id: string; start: Date; end: Date | null; summary: string; description?: string; location?: string; url?: string };

/**
 * Place from the stored maps link, never resolved nor copied raw: LOCATION is the extracted place, or `lat,lng` when only
 * coordinates exist; URL is the normalized link. A shortener only gives URL; an invalid or empty link gives nothing.
 */
function placeOf(mapsUrl: string | null | undefined): Pick<IcsEvent, "location" | "url"> {
  const link = parseMapsLink(mapsUrl);
  if (link.kind !== "valid") return {};
  const location = link.place ?? (link.coordinates ? `${link.coordinates.lat},${link.coordinates.lng}` : undefined);
  return { ...(location !== undefined ? { location } : {}), url: link.url };
}

/** `end` only when it is a real instant after the start at the second resolution of the format; never invented. */
const endAfter = (start: Date, end: Date | null) => end !== null && Number.isFinite(end.getTime()) && wholeSeconds(end) > wholeSeconds(start) ? end : null;

function collectEvents(itinerary: TripItineraryResponse): IcsEvent[] {
  const events = new Map<string, IcsEvent>();
  const add = (event: IcsEvent) => { if (Number.isFinite(event.start.getTime())) events.set(`${event.kind}-${event.id}`, event); };
  const names = new Map(itinerary.destinations.map((destination) => [destination.id, destination.name]));
  for (const transport of itinerary.transports) {
    const start = new Date(transport.departureAt);
    add({ kind: "transport", id: transport.id, start, end: endAfter(start, transport.arrivalAt ? new Date(transport.arrivalAt) : null),
      summary: `${transportLabels[transport.type] ?? transportLabels.other}: ${transport.departurePlace} → ${transport.arrivalPlace}` });
  }
  for (const activity of itinerary.activities) {
    const start = new Date(activity.scheduledAt);
    add({ kind: "activity", id: activity.id, start, end: endAfter(start, activityEndsAt({ scheduledAt: start, durationMinutes: activity.durationMinutes })),
      summary: activity.title, ...(activity.description ? { description: activity.description } : {}), ...placeOf(activity.mapsUrl) });
  }
  // One band per canonical activity day (UTC, stable id); transit days are not bands: the transport is already an event.
  for (const day of itinerary.days) {
    if (day.type !== "activity") continue;
    const start = new Date(day.startsAt);
    add({ kind: "day", id: day.id, start, end: endAfter(start, day.endsAt ? new Date(day.endsAt) : null),
      summary: `${names.get(day.destinationId) ?? "Destino"} — actividades` });
  }
  return [...events.values()].sort((a, b) => wholeSeconds(a.start) - wholeSeconds(b.start) || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export const icsEventCount = (itinerary: TripItineraryResponse) => collectEvents(itinerary).length;

export type BuildIcsInput = { tripName: string; itinerary: TripItineraryResponse; exportedAt: Date };

/**
 * Static copy of the itinerary: every activity (no confirmation filter), transports and activity days, UID `<kind>-<ObjectId>@travellier`.
 * `exportedAt` is injected as DTSTAMP; there is no SEQUENCE nor LAST-MODIFIED because the itinerary carries no `updatedAt`.
 */
export function buildItineraryIcs({ tripName, itinerary, exportedAt }: BuildIcsInput): string {
  const stamp = formatUtc(exportedAt);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Travellier//Export ICS//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(tripName.trim() || fallbackTripName)}`];
  for (const event of collectEvents(itinerary)) {
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
