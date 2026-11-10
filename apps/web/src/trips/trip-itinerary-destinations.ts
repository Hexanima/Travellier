import type { TripItineraryResponse } from "./trip-itinerary-api.js";
import { localDayKey } from "./expense-format.js";
import { projectTripItinerary, type LocalItineraryDay } from "./trip-itinerary-view.js";

export type DestinationStatus = "complete" | "missing-both" | "missing-outbound" | "missing-return" | "inconsistent";
/** One stop of the Trip. Limits are the local days of the outbound arrival and the return departure; they are `null` unless both transports exist and agree. */
export type DestinationChoice = {
  id: string; name: string; order: number; arrivalAt: string | null; departureAt: string | null;
  firstDay: string | null; lastDay: string | null; status: DestinationStatus;
};

const finite = (instant: string | undefined): instant is string => instant !== undefined && Number.isFinite(Date.parse(instant));

/** Stops ordered by `order` (id breaks ties). Nothing is invented for a stop without both transports. */
export function destinationChoices(itinerary: TripItineraryResponse, timeZone: string,
  days: readonly Pick<LocalItineraryDay, "date">[] = projectTripItinerary(itinerary, timeZone)): DestinationChoice[] {
  return [...itinerary.destinations].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)).map((destination) => {
    const arrivals = itinerary.transports.filter((t) => t.destinationId === destination.id && t.direction === "outbound" && finite(t.arrivalAt))
      .map((t) => t.arrivalAt).sort((a, b) => Date.parse(a) - Date.parse(b));
    const departures = itinerary.transports.filter((t) => t.destinationId === destination.id && t.direction === "return" && finite(t.departureAt))
      .map((t) => t.departureAt).sort((a, b) => Date.parse(b) - Date.parse(a));
    const arrivalAt = arrivals[0] ?? null, departureAt = departures[0] ?? null;
    const base = { id: destination.id, name: destination.name, order: destination.order, arrivalAt, departureAt };
    const none = { firstDay: null, lastDay: null };
    if (arrivalAt === null && departureAt === null) return { ...base, ...none, status: "missing-both" as const };
    if (arrivalAt === null) return { ...base, ...none, status: "missing-outbound" as const };
    if (departureAt === null) return { ...base, ...none, status: "missing-return" as const };
    const firstDay = localDayKey(arrivalAt, timeZone);
    if (Date.parse(arrivalAt) > Date.parse(departureAt) || !days.some((day) => day.date === firstDay)) return { ...base, ...none, status: "inconsistent" as const };
    return { ...base, firstDay, lastDay: localDayKey(departureAt, timeZone), status: "complete" as const };
  });
}

/** The stop a local date belongs to: the preferred complete one that contains it, else the first (by order) that does, else the first segment of that day. */
export function destinationForDate(choices: readonly DestinationChoice[], date: string, preferredId: string | undefined,
  daySegments: readonly { destinationId: string }[]): string | undefined {
  const contains = (c: DestinationChoice) => c.status === "complete" && c.firstDay! <= date && date <= c.lastDay!;
  const preferred = preferredId === undefined ? undefined : choices.find((c) => c.id === preferredId && contains(c));
  return preferred?.id ?? choices.find(contains)?.id ?? daySegments[0]?.destinationId;
}
