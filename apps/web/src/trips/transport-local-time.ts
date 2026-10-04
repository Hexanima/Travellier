export const currentTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

const dayMs = 86_400_000;
const formatter = (timeZone: string) => new Intl.DateTimeFormat("en-CA", {
  timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

/** UTC fields represent the wall clock only, not an instant in this intermediate value. */
const wallTimeAt = (instant: Date, format: Intl.DateTimeFormat): Date => {
  const parts = Object.fromEntries(format.formatToParts(instant).map(({ type, value }) => [type, Number(value)]));
  const wall = new Date(0);
  wall.setUTCFullYear(parts.year!, parts.month! - 1, parts.day!);
  wall.setUTCHours(parts.hour!, parts.minute!, parts.second!, 0);
  return wall;
};

export const toLocalDateTime = (iso: string, timeZone: string): string =>
  wallTimeAt(new Date(iso), formatter(timeZone)).toISOString().slice(0, 16);

const possibleInstants = (wall: Date, format: Intl.DateTimeFormat): Date[] => {
  const timestamp = wall.getTime();
  // Probe both sides of a transition; a repeated clock can resolve to two instants.
  const offsets = new Set([timestamp - dayMs, timestamp, timestamp + dayMs]
    .map((sample) => wallTimeAt(new Date(sample), format).getTime() - sample));
  return [...offsets].map((offset) => new Date(timestamp - offset))
    .filter((instant) => wallTimeAt(instant, format).getTime() === timestamp)
    .sort((a, b) => a.getTime() - b.getTime());
};

export const parseLocalDateTimeCandidates = (value: string, timeZone: string): Date[] => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return [];
  const wall = new Date(`${value}:00.000Z`);
  if (!Number.isFinite(wall.getTime()) || wall.toISOString().slice(0, 16) !== value) return [];
  // No candidate means the local clock is in a DST gap; repeated clocks retain both occurrences.
  return possibleInstants(wall, formatter(timeZone));
};

// Transport bounds retain their existing first-occurrence policy.
export const parseLocalDateTime = (value: string, timeZone: string): Date | undefined =>
  parseLocalDateTimeCandidates(value, timeZone)[0];

export const localStepInstant = (previousAt: Date, hours: number, minutes: number, timeZone: string): Date => {
  const format = formatter(timeZone);
  const previousWall = wallTimeAt(previousAt, format);
  const wall = new Date(previousWall);
  wall.setUTCHours(hours, minutes, 0, 0);
  const candidates = possibleInstants(wall, format);
  const candidate = candidates.find((instant) => instant >= previousAt);
  if (candidate) return candidate;
  if (candidates.length === 0 && hours * 60 + minutes >= previousWall.getUTCHours() * 60 + previousWall.getUTCMinutes()) {
    return new Date(Number.NaN);
  }
  // Advance the calendar date, not the UTC instant: DST days need not last 24 hours.
  wall.setUTCDate(wall.getUTCDate() + 1);
  return possibleInstants(wall, format).find((instant) => instant >= previousAt) ?? new Date(Number.NaN);
};
