import type { TripListItem } from "./trip-management-api.js";

export type TripFilter = "active" | "finished";

const parse = (endAt: string | null | undefined): number | null => {
  if (typeof endAt !== "string") return null;
  const ms = Date.parse(endAt);
  return Number.isNaN(ms) ? null : ms;
};

/** Finished = endAt strictly before the current instant. A missing endAt is active. Only UTC instants are compared: the time zone plays no part. */
export const isFinished = (endAt: string | null | undefined, nowMs: number): boolean => {
  const end = parse(endAt);
  return end !== null && end < nowMs;
};

/** Splits the list preserving its order and keeping the first occurrence of each id. */
export const classifyTrips = (items: readonly TripListItem[], nowMs: number): { active: TripListItem[]; finished: TripListItem[] } => {
  const seen = new Set<string>();
  const active: TripListItem[] = [];
  const finished: TripListItem[] = [];
  for (const trip of items) {
    if (seen.has(trip.id)) continue;
    seen.add(trip.id);
    (isFinished(trip.endAt, nowMs) ? finished : active).push(trip);
  }
  return { active, finished };
};

/** The earliest endAt that is not yet finished (equal to now counts: it is still active), or null if nothing will change. */
export const nextBoundaryMs = (items: readonly TripListItem[], nowMs: number): number | null => {
  let next: number | null = null;
  for (const trip of items) {
    const end = parse(trip.endAt);
    if (end !== null && end >= nowMs && (next === null || end < next)) next = end;
  }
  return next;
};

export const parseFilter = (raw: string | null | undefined): TripFilter => (raw === "finished" ? "finished" : "active");
