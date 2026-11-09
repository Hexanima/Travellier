export type DurationInput = { hours: string; minutes: string };
export type DurationParse = { ok: true; value: number | null } | { ok: false; errors: { durationHours?: string; durationMinutes?: string } };

export const splitDuration = (minutes: number | null | undefined): DurationInput => {
  if (minutes == null) return { hours: "", minutes: "" };
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return { hours: hours > 0 ? String(hours) : "", minutes: rest > 0 ? String(rest) : "" };
};

/** Local shape check only; the window against the destination is decided by the backend. */
export const parseDurationInput = ({ hours, minutes }: DurationInput): DurationParse => {
  const h = hours.trim(), m = minutes.trim();
  if (h === "" && m === "") return { ok: true, value: null };
  const errors: { durationHours?: string; durationMinutes?: string } = {};
  if (h !== "" && !/^\d+$/.test(h)) errors.durationHours = "Ingresá horas enteras, desde 0.";
  if (m !== "" && (!/^\d+$/.test(m) || Number(m) > 59)) errors.durationMinutes = "Ingresá minutos enteros entre 0 y 59.";
  if (Object.keys(errors).length) return { ok: false, errors };
  const total = Number(h || 0) * 60 + Number(m || 0);
  if (!Number.isSafeInteger(total)) return { ok: false, errors: { durationHours: "Ingresá una cantidad de horas válida." } };
  if (total <= 0) return { ok: false, errors: { durationMinutes: "La duración debe ser mayor a cero." } };
  return { ok: true, value: total };
};

export const formatDuration = (minutes: number): string => {
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return [hours > 0 ? `${hours} h` : "", rest > 0 ? `${rest} min` : ""].filter(Boolean).join(" ");
};
