import type { CalendarEventsPort, CalendarEventSpec } from "app-domain";
import { NativeCapabilityError } from "app-domain";
import type { NativeDependencies, NativePlatform } from "./capabilities.js";
import { nativeResult } from "./native-result.js";

/**
 * What the installed plugin really does (node_modules/@capacitor/calendar, read, not run on a device):
 *  - Android createEvent appends the url to the notes as "$notes $url" (Calendar.kt 43-51) while definitions.d.ts says it is ignored; modifyEvent never
 *    reads `url` (Calendar.kt 72-120). iOS keeps a real URL field (Calendar.swift 252-254) that can never be cleared: an empty string does not parse.
 *    So `url` is NEVER sent: the link travels as its own line of the notes, just above the marker, and the marker stays a whole line on both platforms.
 *  - findEvents/modifyEvent/deleteEvent-by-filter match a case-insensitive SUBSTRING and every event that OVERLAPS the window (Calendar.kt 262-316,
 *    Calendar.swift 185-217); modifyEvent changes only the FIRST match (Calendar.kt 73, Calendar.swift 74), ordered by start on Android and unspecified on iOS.
 *  - Android reads strings with optString(...).takeIf { it.isNotEmpty() } (Calendar.kt 505-507): an empty `location` in modifyEvent is ignored,
 *    so a place cannot be cleared in place there. iOS applies `location: ""` (Calendar.swift 243-245).
 */

const lines = (notes: string | undefined) => (notes ?? "").split(/\r\n|\r|\n/);
/** The marker opens a line and ends it or is followed by whitespace (Android may append " <url>" to the last line). It is never the prefix of another key. */
const carriesMarker = (notes: string | undefined, marker: string) => lines(notes).some((line) => {
  const text = line.trim();
  return text === marker || (text.startsWith(marker) && /\s/.test(text.charAt(marker.length)));
});
/** The spec notes end with the marker line; the link goes on its own line right before it. */
function notesOf(spec: CalendarEventSpec) {
  if (!spec.url) return spec.notes;
  const at = spec.notes.lastIndexOf("\n");
  return `${at < 0 ? "" : spec.notes.slice(0, at + 1)}${spec.url}\n${spec.notes.slice(at + 1)}`;
}
const seconds = (ms: number) => Math.floor(ms / 1000);
/** Line endings and trailing spaces are not content: platforms may rewrite them. */
const plainNotes = (notes: string | undefined) => lines(notes).map((line) => line.trimEnd()).join("\n").trimEnd();
type Comparable = { title?: string; startMs: number; endMs: number; notes?: string; location?: string };
/**
 * «Identical» (the only copies ever deleted): same title, same window to the second (the plugin may truncate milliseconds), same notes without
 * line-ending/trailing-space differences (the marker line included, so an edit above, below or on it makes the copy different) and same place
 * (`location ?? ""`: an absent place is an empty one). Any difference, or a platform that normalizes something else, counts as NOT identical:
 * the copy is ignored, never deleted. Android never receives `url`, so the notes it returns are exactly the ones sent.
 */
export const isIdenticalCopy = (event: Comparable, other: Comparable) => event.title === other.title && seconds(event.startMs) === seconds(other.startMs) && seconds(event.endMs) === seconds(other.endMs)
  && plainNotes(event.notes) === plainNotes(other.notes) && (event.location ?? "") === (other.location ?? "");
type Found = { title?: string; startDate: number; endDate: number; notes?: string; location?: string };
const comparableOf = (event: Found): Comparable => ({ ...(event.title !== undefined ? { title: event.title } : {}), startMs: event.startDate, endMs: event.endDate,
  ...(event.notes !== undefined ? { notes: event.notes } : {}), ...(event.location !== undefined ? { location: event.location } : {}) });
/** What the spec writes into the calendar, as comparable data. */
export const plannedComparable = (spec: CalendarEventSpec): Comparable => ({ title: spec.title, startMs: spec.startDate, endMs: spec.endDate, notes: notesOf(spec), ...(spec.location ? { location: spec.location } : {}) });
const same = (event: Found, other: Found) => isIdenticalCopy(comparableOf(event), comparableOf(other));
const sameAsPlan = (event: Found, spec: CalendarEventSpec) => isIdenticalCopy(comparableOf(event), plannedComparable(spec));
const managed = (spec: CalendarEventSpec) => ({ title: spec.title, notes: notesOf(spec), ...(spec.location ? { location: spec.location } : {}), startDate: spec.startDate, endDate: spec.endDate });

/**
 * Event operations over the official calendar plugin. It never requests permissions (the caller checks them first), logs nothing and has no
 * effect at construction. Errors carry only a kind, never the plugin message or the event content.
 */
export function createCalendarEvents(calendar: NativeDependencies["calendar"], platform: NativePlatform): CalendarEventsPort {
  /** Every event the plugin returns for the marker and window (also those that only contain the text), once per id. */
  const search = async (marker: string, window: { startMs: number; endMs: number }) => {
    const { events } = await calendar.findEvents({ notes: marker, startDate: window.startMs, endDate: window.endMs });
    const seen = new Set<string>();
    return events.filter((event) => !seen.has(event.id) && seen.add(event.id));
  };
  const created = async (spec: CalendarEventSpec, calendarId?: string) => {
    const { id } = await calendar.createEvent({ ...managed(spec), ...(calendarId ? { calendarId } : {}) });
    // Without an id the event cannot be tracked: the failure keeps it from being reported as synchronized; the marker adopts it later.
    if (!id) throw new NativeCapabilityError("native");
    return { id };
  };
  return {
    find: (marker, window) => nativeResult(platform, async () => (await search(marker, window)).filter((event) => carriesMarker(event.notes, marker))
      .map((event) => ({ id: event.id, ...(event.title !== undefined ? { title: event.title } : {}), startMs: event.startDate, endMs: event.endDate, ...(event.calendarId !== undefined ? { calendarId: event.calendarId } : {}),
        ...(event.notes !== undefined ? { notes: event.notes } : {}), ...(event.location !== undefined ? { location: event.location } : {}) }))),
    create: (spec) => nativeResult(platform, () => created(spec)),
    update: (eventId, marker, window, spec) => nativeResult(platform, async () => {
      const found = await search(marker, window);
      const target = found.find((event) => event.id === eventId && carriesMarker(event.notes, marker));
      // The referenced event is not where it was (or lost its marker): the caller forgets the reference.
      if (!target) throw new NativeCapabilityError("missing");
      // Conservative: only copies that carry the marker AND are identical (title, window, notes and place) to the plan or to the referenced event are removed.
      // Copies the person edited are left alone; they are counted, never adopted here.
      const gone = new Set<string>();
      let ignoredCopies = 0;
      for (const copy of found) {
        if (copy.id === eventId || !carriesMarker(copy.notes, marker)) continue;
        if (!(sameAsPlan(copy, spec) || same(copy, target))) { ignoredCopies += 1; continue; }
        try { await calendar.deleteEvent({ id: copy.id }); gone.add(copy.id); } catch { /* it is still there: the plugin could then edit it instead of the referenced one */ }
      }
      const others = found.filter((event) => event.id !== eventId && !gone.has(event.id));
      const counted = ignoredCopies > 0 ? { ignoredCopies } : {};
      // Android cannot clear a place in place.
      const clearsPlace = platform() === "android" && !spec.location && Boolean(target.location);
      // modifyEvent targets the first match by filter, not by id: it is only safe when the referenced event is the only candidate.
      if (others.length === 0 && !clearsPlace) {
        await calendar.modifyEvent({ filter: { notes: marker, startDate: window.startMs, endDate: window.endMs },
          newEvent: { ...managed(spec), ...(!spec.location && platform() === "ios" ? { location: "" } : {}) } });
        return { id: eventId, ...counted };
      }
      // Safest way left: create the new one first (same calendar) and only then delete the previous one by id, so a failure never loses the event.
      const replacement = await created(spec, target.calendarId);
      try { await calendar.deleteEvent({ id: eventId }); } catch { return { ...replacement, staleCopy: true as const, ...counted }; }
      return { ...replacement, ...counted };
    }),
    remove: (id) => nativeResult(platform, () => calendar.deleteEvent({ id })),
  };
}
