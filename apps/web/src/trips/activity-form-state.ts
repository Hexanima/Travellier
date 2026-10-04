import { validateActivitySchedule, type ItineraryDay, type ObjectId } from "app-domain";
import type { ActivityInput, ActivityResponse } from "./trip-activity-api.js";
import type { ItineraryDayResponse } from "./trip-itinerary-api.js";
import type { ItinerarySegment } from "./trip-itinerary-view.js";
import { parseLocalDateTimeCandidates, toLocalDateTime } from "./transport-local-time.js";

export type ActivityMode = "planned" | "spontaneous";
export type ActivityFormValues = { mode: ActivityMode; title: string; description: string; mapsUrl: string; date: string; time: string; originalScheduledAt?: string };
export type ActivityFormContext = { tripId: string; days: ItineraryDayResponse[]; timeZone: string;
  selection: Pick<ItinerarySegment, "destinationId" | "sourceDayIds" | "startsAt" | "endsAt"> & { date: string } };
export type ActivityFormResult = { ok: true; value: ActivityInput } | { ok: false; errors: Record<string, string> };

export const initialActivityValues = (context: ActivityFormContext, mode: ActivityMode, now: Date, existing?: ActivityResponse): ActivityFormValues => {
  const originalScheduledAt = existing?.scheduledAt ?? (mode === "spontaneous" ? now.toISOString() : undefined);
  const local = originalScheduledAt ? toLocalDateTime(originalScheduledAt, context.timeZone) : undefined;
  return { mode, title: existing?.title ?? "", description: existing?.description ?? "", mapsUrl: existing?.mapsUrl ?? "",
    date: local?.slice(0, 10) ?? context.selection.date, time: local?.slice(11) ?? "", originalScheduledAt };
};

/** Hydration stays in the client adapter; window ownership is decided by the domain. */
const canonicalDays = (days: ItineraryDayResponse[]): ItineraryDay[] => days.map((day) => ({
  ...day, id: day.id as ObjectId, tripId: day.tripId as ObjectId, destinationId: day.destinationId as ObjectId,
  date: new Date(day.date), startsAt: new Date(day.startsAt), endsAt: day.endsAt === null ? null : new Date(day.endsAt),
}));

export const prepareActivityInput = (values: ActivityFormValues, context: ActivityFormContext, operation: "create" | "edit" = "create"): ActivityFormResult => {
  const errors: Record<string, string> = {};
  if (!values.title.trim()) errors.title = "Ingresá un título.";
  if (!values.date) errors.date = "Ingresá la fecha.";
  if (!values.time) errors.time = "Ingresá la hora.";
  if (Object.keys(errors).length) return { ok: false, errors };
  const local = `${values.date}T${values.time}`;
  const candidates = values.originalScheduledAt && toLocalDateTime(values.originalScheduledAt, context.timeZone) === local
    ? [new Date(values.originalScheduledAt)] : parseLocalDateTimeCandidates(local, context.timeZone);
  if (candidates.length === 0) return { ok: false, errors: { scheduledAt: "Ingresá una fecha y hora válidas en tu zona local." } };
  const { selection } = context;
  const days = canonicalDays(context.days);
  for (const scheduledAt of candidates) {
    if (operation === "create" && (values.date !== selection.date || scheduledAt.getTime() < Date.parse(selection.startsAt) ||
        selection.endsAt === null || scheduledAt.getTime() > Date.parse(selection.endsAt))) continue;
    const selected = days.find((day) => (operation === "edit" || selection.sourceDayIds.includes(day.id)) && day.destinationId === selection.destinationId &&
      validateActivitySchedule({ tripId: context.tripId as ObjectId, dayId: day.id, scheduledAt }, days).ok);
    if (selected) return { ok: true, value: { dayId: selected.id, title: values.title.trim(), scheduledAt: scheduledAt.toISOString(),
      description: values.description.trim() || null, mapsUrl: values.mapsUrl.trim() || null } };
  }
  return { ok: false, errors: { scheduledAt: operation === "edit"
    ? "Elegí un horario dentro de las franjas de actividad de este destino."
    : "Elegí un horario dentro de la franja de actividad de este día y destino." } };
};
