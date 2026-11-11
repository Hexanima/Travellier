const pending = "Fechas por definir";

const instant = (value: string | null | undefined): Date | null => {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Provisional text of the dates of a Trip, in the device time zone (or the one given). It is only for display:
 * the Active/Finished classification compares UTC instants and never uses it.
 */
export function formatTripRange(startAt: string | null | undefined, endAt: string | null | undefined, timeZone?: string): string {
  const start = instant(startAt);
  const end = instant(endAt);
  if (start === null || end === null) return pending;
  const zone = timeZone === undefined ? {} : { timeZone };
  const day = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", ...zone });
  const year = new Intl.DateTimeFormat("es-AR", { year: "numeric", ...zone });
  const startDay = day.format(start), endDay = day.format(end);
  const startYear = year.format(start), endYear = year.format(end);
  if (startYear !== endYear) return `${startDay} ${startYear} – ${endDay} ${endYear}`;
  return startDay === endDay ? `${startDay} ${startYear}` : `${startDay} – ${endDay} ${endYear}`;
}
