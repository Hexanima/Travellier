import type { ActivityUpdatedField, TripNotification } from "./trip-notification-api.js";

/**
 * Texts of the notices, built in the client: the backend sends ids and dates only, so no title, name or comment text can appear here.
 * Only the unlink phrase comes from the PRD; the others are generic on purpose (see docs/REVISION_PENDIENTE.md).
 */
export type NoticeText = {
  headline: string;
  lines: string[];
  /** Every incompatible plan of an unlinked participation, each one openable by its id (the screen builds the link). */
  incompatible: { activityId: string; text: string }[];
  /** Only for an unlinked participation: the action goes to the itinerary and the note makes clear that reading changes nothing. */
  decision?: { action: "Revisar y decidir"; note: "El aviso no cambia tu respuesta." };
};

const unlinkedPhrase = "Cambió el horario y se superpone con otro plan. Se retiró tu participación; revisá la actividad y elegí de nuevo.";

/** The zone is injectable; by default it is the device's. */
export const formatNoticeTime = (iso: string, timeZone?: string): string =>
  new Intl.DateTimeFormat("es-AR", { ...(timeZone ? { timeZone } : {}), day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
const clock = (iso: string, timeZone?: string): string =>
  new Intl.DateTimeFormat("es-AR", { ...(timeZone ? { timeZone } : {}), hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

export const formatDuration = (minutes: number): string => {
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return [hours > 0 ? `${hours} h` : "", rest > 0 ? `${rest} min` : ""].filter(Boolean).join(" ");
};

const list = (items: string[]) => items.length > 1 ? `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}` : items[0] ?? "";
const changedText = (fields: ActivityUpdatedField[]) => {
  const parts = [fields.includes("scheduledAt") ? "el horario" : "", fields.includes("durationMinutes") ? "la duración" : "",
    fields.includes("title") || fields.includes("description") ? "el contenido" : "", fields.includes("mapsUrl") ? "la ubicación" : ""].filter(Boolean);
  return `Cambió ${list(parts)}.`;
};

export const describeNotification = (notification: TripNotification, timeZone?: string): NoticeText => {
  switch (notification.type) {
    case "post.created": return { headline: "Hay un recuerdo nuevo", lines: [], incompatible: [] };
    case "comment.created": return { headline: "Nuevo comentario en un recuerdo", lines: [], incompatible: [] };
    case "member.joined": return { headline: "Se sumó un integrante nuevo", lines: [], incompatible: [] };
    case "member.expelled": return { headline: "Ya no sos parte de este viaje", lines: [], incompatible: [] };
    case "activity.created": {
      const { scheduledAt, durationMinutes } = notification.payload;
      return { headline: "Se creó una actividad", incompatible: [],
        lines: [`Empieza el ${formatNoticeTime(scheduledAt, timeZone)}.`, ...(durationMinutes !== null ? [`Duración: ${formatDuration(durationMinutes)}`] : [])] };
    }
    case "activity.updated":
      return { headline: "Una actividad cambió", lines: [changedText(notification.payload.changedFields)], incompatible: [] };
    case "activity.participant_unlinked": {
      const { newInterval, changedFields, incompatibleActivities } = notification.payload;
      return {
        headline: unlinkedPhrase,
        lines: [
          `Nuevo horario: ${formatNoticeTime(newInterval.startsAt, timeZone)}${newInterval.endsAt !== null ? ` – ${clock(newInterval.endsAt, timeZone)}` : ""}.`,
          ...(newInterval.durationMinutes !== null ? [`Duración: ${formatDuration(newInterval.durationMinutes)}`] : []),
          ...(changedFields.includes("durationMinutes") ? ["Cambió la duración."] : []),
        ],
        incompatible: incompatibleActivities.map((plan) => ({ activityId: plan.activityId,
          text: `${plan.reason === "overlap" ? "Se superpone" : "Mismo horario"}: ${formatNoticeTime(plan.scheduledAt, timeZone)}${plan.durationMinutes !== null ? ` (${formatDuration(plan.durationMinutes)})` : ""}` })),
        decision: { action: "Revisar y decidir", note: "El aviso no cambia tu respuesta." },
      };
    }
  }
};
