import { resolveActivityDayId, validateActivitySchedule, type ObjectId } from "app-domain";
import { formatDuration, parseDurationInput } from "./activity-duration.js";
import { canonicalDays } from "./activity-form-state.js";
import type { NewActivityDraft, ResolvedNewActivity } from "./post-draft.js";
import { parseLocalDateTimeCandidates, toLocalDateTime } from "./transport-local-time.js";
import type { ItineraryDayResponse } from "./trip-itinerary-api.js";

export type NewActivityResolved = ResolvedNewActivity;
export type NewActivityResult = { ok: true; value: NewActivityResolved } | { ok: false; errors: Record<string, string> };
export type NewActivityContext = { days: ItineraryDayResponse[]; timeZone: string; tripId: string };

/** The current moment in the device zone: adjustable, and not corrected silently when it falls outside the activity window. */
export const initialNewActivity = (timeZone: string, now: Date = new Date()): NewActivityDraft => {
  const local = toLocalDateTime(now.toISOString(), timeZone);
  return { title: "", date: local.slice(0, 10), time: local.slice(11), durationHours: "", durationMinutes: "" };
};

type LocalParts = { ok: true; candidates: Date[]; durationMinutes: number | null } | { ok: false; errors: Record<string, string> };
/** Shape only: title, duration and a local clock that exists. Nothing about the itinerary. */
const localParts = (draft: NewActivityDraft, timeZone: string): LocalParts => {
  const errors: Record<string, string> = {};
  if (!draft.title.trim()) errors.title = "Ingresá un título para la actividad.";
  if (!draft.date) errors.date = "Ingresá la fecha.";
  if (!draft.time) errors.time = "Ingresá la hora.";
  const duration = parseDurationInput({ hours: draft.durationHours, minutes: draft.durationMinutes });
  if (!duration.ok) Object.assign(errors, duration.errors);
  if (Object.keys(errors).length) return { ok: false, errors };
  const candidates = parseLocalDateTimeCandidates(`${draft.date}T${draft.time}`, timeZone);
  if (candidates.length === 0) return { ok: false, errors: { scheduledAt: "Ingresá una fecha y hora válidas en tu zona local." } };
  return { ok: true, candidates, durationMinutes: duration.ok ? duration.value : null };
};

/** Without the itinerary loaded: the shape is checked and the first instant is used; the server decides the window. */
export const parseNewActivity = (draft: NewActivityDraft, timeZone: string): NewActivityResult => {
  const parts = localParts(draft, timeZone);
  return parts.ok ? { ok: true, value: { scheduledAt: parts.candidates[0]!.toISOString(), durationMinutes: parts.durationMinutes } } : parts;
};

/** Validates locally what the server will validate again: title, local instant, duration shape, start slice and end inside the destination window. */
export const resolveNewActivity = (draft: NewActivityDraft, context: NewActivityContext): NewActivityResult => {
  const parts = localParts(draft, context.timeZone);
  if (!parts.ok) return parts;
  const { candidates, durationMinutes } = parts;
  const days = canonicalDays(context.days);
  if (!days.some((day) => day.type === "activity")) {
    return { ok: false, errors: { scheduledAt: "Todavía no hay franjas de actividad: cargá los transportes primero." } };
  }
  const tripId = context.tripId as ObjectId;
  let endsTooLate = false;
  // An ambiguous clock keeps both instants: the first one that fits wins, as in the activity form.
  for (const scheduledAt of candidates) {
    const owner = resolveActivityDayId(days, tripId, scheduledAt);
    if (!owner.ok) continue;
    if (validateActivitySchedule({ tripId, dayId: owner.value, scheduledAt, durationMinutes }, days).ok) {
      return { ok: true, value: { scheduledAt: scheduledAt.toISOString(), durationMinutes } };
    }
    endsTooLate = true;
  }
  return { ok: false, errors: endsTooLate
    ? { durationMinutes: "La actividad terminaría después de la salida del destino. Acortá la duración o elegí otro horario." }
    : { scheduledAt: "Elegí un horario dentro de la franja de actividad del destino." } };
};

/** «25/09/2026 12:00»: the wall clock the user typed, with no zone conversion. */
export const newActivityWhen = (draft: NewActivityDraft): string => `${draft.date.split("-").reverse().join("/")} ${draft.time}`;
/** «Título · fecha hora [· duración]»; an invalid duration is left out (the submit validates it again). */
export const newActivityLabel = (draft: NewActivityDraft): string => {
  const duration = parseDurationInput({ hours: draft.durationHours, minutes: draft.durationMinutes });
  return [draft.title.trim(), newActivityWhen(draft), ...(duration.ok && duration.value !== null ? [formatDuration(duration.value)] : [])].join(" · ");
};
