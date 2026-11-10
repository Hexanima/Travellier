import { wholeSeconds, type CalendarEvent } from "./calendar-events.js";

/** Native event limits, counted in code points so a pair is never split. Provisional values: the platforms do not publish a strict limit. */
export const maxTitleLength = 200;
export const maxNotesLength = 2000;

/** What the app manages in a native calendar event. Nothing else (expenses, participants, tokens, costs, flight data) is ever sent. */
export type NativeEventSpec = { title: string; notes: string; location?: string; url?: string; startDate: number; endDate: number };

/** Visible, stable identity written as the last line of the notes: `travellier:<kind>-<id>@<tripId>`. */
export const eventMarker = (key: string, tripId: string) => `travellier:${key}@${tripId}`;

const clip = (value: string, max: number) => { const points = [...value]; return points.length <= max ? value : points.slice(0, max).join(""); };

/**
 * Pure projection. Times are whole seconds (iOS truncates anyway) and the end equals the start when there is no duration:
 * an interval is never invented. The marker always survives trimming.
 */
export function toNativeEventSpec(event: CalendarEvent, tripId: string): NativeEventSpec {
  const marker = eventMarker(event.key, tripId);
  const room = maxNotesLength - [...marker].length - 1;
  const description = event.description ? clip(event.description, Math.max(room, 0)) : "";
  const startDate = wholeSeconds(event.start) * 1000;
  return {
    title: clip(event.summary, maxTitleLength),
    notes: description ? `${description}\n${marker}` : marker,
    ...(event.location ? { location: event.location } : {}),
    ...(event.url ? { url: event.url } : {}),
    startDate,
    endDate: event.end ? wholeSeconds(event.end) * 1000 : startDate,
  };
}

/** Two FNV-1a 32-bit passes with different bases: a change detector, not security. Depends only on the spec values (epoch numbers, no zone). */
export function specFingerprint(spec: NativeEventSpec): string {
  const text = JSON.stringify([spec.title, spec.notes, spec.location ?? "", spec.url ?? "", spec.startDate, spec.endDate]);
  const hash = (basis: number) => {
    let value = basis;
    for (let index = 0; index < text.length; index += 1) { value ^= text.charCodeAt(index); value = Math.imul(value, 0x01000193) >>> 0; }
    return value.toString(16).padStart(8, "0");
  };
  return hash(0x811c9dc5) + hash(0x9747b28c);
}
