import { newerFirst, type ActivityTab } from "./activity-memories.js";
import type { ItineraryPostResponse, ItineraryTransportResponse, TripItineraryResponse } from "./trip-itinerary-api.js";
import { projectItineraryView } from "./trip-itinerary-view.js";
import { formatActivityClock } from "./activity-time-format.js";

export type TransportTab = ActivityTab;
const idPattern = /^[0-9a-f]{24}$/;

/**
 * `?transport=<id>&tab=memories|photos`: an invalid id is dropped and an invalid or missing tab is «Recuerdos». An activity in the same URL
 * (valid or not) means no detail opens: two resources are never guessed between.
 */
export const readTransportParams = (search: string): { transportId: string | undefined; tab: TransportTab } => {
  const params = new URLSearchParams(search);
  const transport = params.get("transport");
  const valid = transport !== null && idPattern.test(transport) && !params.has("activity");
  return { transportId: valid ? transport : undefined, tab: params.get("tab") === "photos" ? "photos" : "memories" };
};

/** Memories of a transport from the loaded itinerary: every post whose root transport is this one (descendants, unplaced, also with an activity), once each, newest first. */
export const transportMemories = (posts: readonly ItineraryPostResponse[], unplacedPosts: readonly ItineraryPostResponse[], transportId: string): ItineraryPostResponse[] => {
  const seen = new Set<string>();
  const result: ItineraryPostResponse[] = [];
  for (const item of [...posts, ...unplacedPosts]) {
    if (item.context.rootTransportId !== transportId || seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }
  return result.sort(newerFirst);
};

export type TransportDayKind = "Salida" | "Llegada" | "Salida y llegada" | "En tránsito";
/** `startsAt`/`endsAt` are the real departure/arrival instants (ISO, as received) on the days that hold them; the other days carry no hour. */
export type TransportDaySlice = { date: string; kind: TransportDayKind; startsAt: string | null; endsAt: string | null };

/**
 * One slice per local day where the itinerary projection places the transport. The cut is the projection's own (no duplicated logic);
 * only the extremes carry the real departure/arrival instants, the days in between inherit nothing.
 */
export const transportDaySlices = (itinerary: TripItineraryResponse, transportId: string, timeZone: string): TransportDaySlice[] => {
  const transport = itinerary.transports.find((item) => item.id === transportId);
  if (!transport) return [];
  const calendar = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const departureDate = calendar.format(new Date(transport.departureAt)), arrivalDate = calendar.format(new Date(transport.arrivalAt));
  const slices: TransportDaySlice[] = [];
  for (const day of projectItineraryView(itinerary, timeZone).days) {
    const present = day.segments.some((segment) => segment.items.some((item) => item.kind === "transport" && item.id === transportId));
    if (!present) continue;
    const departs = day.date === departureDate, arrives = day.date === arrivalDate;
    slices.push({ date: day.date, kind: departs && arrives ? "Salida y llegada" : departs ? "Salida" : arrives ? "Llegada" : "En tránsito",
      startsAt: departs ? transport.departureAt : null, endsAt: arrives ? transport.arrivalAt : null });
  }
  return slices;
};

export type TransportStep = { line: string; fromStop: string; toStop: string; iso: string | null; clock: string; note: string | null };
type RawStep = { line?: unknown; fromStop?: unknown; toStop?: unknown; estimatedAt?: unknown; estimatedTime?: unknown };
const clockOnly = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/** Steps of a local bus. A legacy clock is shown as stored, a missing time says so; no date is built from either. */
export const transportSteps = (transport: ItineraryTransportResponse, timeZone: string): TransportStep[] => {
  if (transport.type !== "bus_local") return [];
  const steps = (transport.details as { steps?: RawStep[] }).steps ?? [];
  return steps.map((step) => {
    const base = { line: String(step.line ?? ""), fromStop: String(step.fromStop ?? ""), toStop: String(step.toStop ?? "") };
    if (typeof step.estimatedAt === "string" && Number.isFinite(Date.parse(step.estimatedAt))) {
      return { ...base, iso: step.estimatedAt, clock: formatActivityClock(step.estimatedAt, timeZone), note: null };
    }
    if (typeof step.estimatedTime === "string" && clockOnly.test(step.estimatedTime)) {
      return { ...base, iso: null, clock: step.estimatedTime, note: "Sin fecha ni zona horaria" };
    }
    return { ...base, iso: null, clock: "Sin horario", note: null };
  });
};
