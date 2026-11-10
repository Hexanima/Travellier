import { activityEndsAt } from "app-domain";
import { parseMapsLink } from "../trips/maps-link.js";
import type { TripItineraryResponse } from "../trips/trip-itinerary-api.js";

/** Projection of the itinerary into calendar events, shared by the .ics export and the native sync. Pure: UTC instants only. */
export type CalendarEvent = {
  /** `<kind>-<id>`: stable identity of the event (the ICS UID without the `@travellier` domain). */
  key: string;
  kind: "activity" | "day" | "transport";
  id: string;
  start: Date;
  end: Date | null;
  summary: string;
  description?: string;
  location?: string;
  url?: string;
};

export const wholeSeconds = (instant: Date) => Math.floor(instant.getTime() / 1000);

const transportLabels = { bus_local: "Colectivo", bus_long: "Ómnibus", flight: "Avión", car: "Auto", other: "Otro transporte" } as const;

/**
 * Place from the stored maps link, never resolved nor copied raw: LOCATION is the extracted place, or `lat,lng` when only
 * coordinates exist; URL is the normalized link. A shortener only gives URL; an invalid or empty link gives nothing.
 */
function placeOf(mapsUrl: string | null | undefined): Pick<CalendarEvent, "location" | "url"> {
  const link = parseMapsLink(mapsUrl);
  if (link.kind !== "valid") return {};
  const location = link.place ?? (link.coordinates ? `${link.coordinates.lat},${link.coordinates.lng}` : undefined);
  return { ...(location !== undefined ? { location } : {}), url: link.url };
}

/** `end` only when it is a real instant after the start at the second resolution of the format; never invented. */
const endAfter = (start: Date, end: Date | null) => end !== null && Number.isFinite(end.getTime()) && wholeSeconds(end) > wholeSeconds(start) ? end : null;

export function buildCalendarEvents(itinerary: TripItineraryResponse): CalendarEvent[] {
  const events = new Map<string, CalendarEvent>();
  const add = (event: Omit<CalendarEvent, "key">) => { if (Number.isFinite(event.start.getTime())) events.set(`${event.kind}-${event.id}`, { ...event, key: `${event.kind}-${event.id}` }); };
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
