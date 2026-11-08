import { activityEndsAt } from "app-domain";

export type ActivityRangeParts = { start: string; end: string | null; endDateLabel: string | null; startIso: string; endIso: string | null };
type Timed = { scheduledAt: string; durationMinutes?: number | null };

const clockFormat = (timeZone: string) => new Intl.DateTimeFormat("es-AR", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dayKey = (timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
const yearOf = (timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric" });

export const formatActivityClock = (iso: string, timeZone: string): string => clockFormat(timeZone).format(new Date(iso));

/** Shared by agenda and detail. The end is derived by the domain formula; without duration no end is invented. */
export const formatActivityRange = (activity: Timed, timeZone: string): ActivityRangeParts => {
  const startsAt = new Date(activity.scheduledAt);
  const endsAt = activityEndsAt({ scheduledAt: startsAt, durationMinutes: activity.durationMinutes });
  const start = clockFormat(timeZone).format(startsAt);
  if (endsAt === null) return { start, end: null, endDateLabel: null, startIso: activity.scheduledAt, endIso: null };
  let endDateLabel: string | null = null;
  if (dayKey(timeZone).format(startsAt) !== dayKey(timeZone).format(endsAt)) {
    const sameYear = yearOf(timeZone).format(startsAt) === yearOf(timeZone).format(endsAt);
    endDateLabel = new Intl.DateTimeFormat("es-AR", { timeZone, day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) }).format(endsAt);
  }
  return { start, end: clockFormat(timeZone).format(endsAt), endDateLabel, startIso: activity.scheduledAt, endIso: endsAt.toISOString() };
};
