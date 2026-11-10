import type { CalendarEventsPort, CalendarEventSpec } from "app-domain";
import { NativeCapabilityError } from "app-domain";
import type { NativeDependencies, NativePlatform } from "./capabilities.js";
import { nativeResult } from "./native-result.js";

/** The marker must be a whole line of the notes: the plugin filter is a substring match, so neighbours and quotes are discarded here. */
const carriesMarker = (notes: string | undefined, marker: string) => (notes ?? "").split(/\r\n|\r|\n/).some((line) => line.trim() === marker);
const managed = (spec: CalendarEventSpec) => ({
  title: spec.title, notes: spec.notes, ...(spec.location !== undefined ? { location: spec.location } : {}),
  ...(spec.url !== undefined ? { url: spec.url } : {}), startDate: spec.startDate, endDate: spec.endDate,
});

/**
 * Event operations over the official calendar plugin. It never requests permissions (the caller checks them first), logs nothing and has no
 * effect at construction. Errors carry only a kind, never the plugin message or the event content.
 */
export function createCalendarEvents(calendar: NativeDependencies["calendar"], platform: NativePlatform): CalendarEventsPort {
  return {
    find: (marker, window) => nativeResult(platform, async () => {
      const { events } = await calendar.findEvents({ notes: marker, startDate: window.startMs, endDate: window.endMs });
      const seen = new Set<string>();
      return events.filter((event) => carriesMarker(event.notes, marker) && !seen.has(event.id) && seen.add(event.id))
        .map((event) => ({ id: event.id, startMs: event.startDate, endMs: event.endDate, ...(event.calendarId !== undefined ? { calendarId: event.calendarId } : {}) }));
    }),
    create: (spec) => nativeResult(platform, async () => {
      const { id } = await calendar.createEvent(managed(spec));
      // Without an id the event cannot be tracked: the failure keeps it from being reported as synchronized; the marker adopts it later.
      if (!id) throw new NativeCapabilityError("native");
      return { id };
    }),
    update: (marker, window, spec) => nativeResult(platform, () =>
      calendar.modifyEvent({ filter: { notes: marker, startDate: window.startMs, endDate: window.endMs }, newEvent: managed(spec) })),
    remove: (id) => nativeResult(platform, () => calendar.deleteEvent({ id })),
  };
}
