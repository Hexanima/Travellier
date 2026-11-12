import type { TripNotificationPayloads, TripNotificationType } from "./trip-notification.js";

/**
 * Single text contract of the notices (T135): the push and the in-app inbox share these headlines. The backend does not know the
 * device time zone, so lines with a time are formatted only by the client; the push carries just the headline and the lines below.
 * No text carries ids, names or user content. Only the unlink phrase comes from the PRD; the rest are generic.
 */
export type NoticeEvent = { [T in TripNotificationType]: { type: T; payload: TripNotificationPayloads[T] } }[TripNotificationType];

export const UNLINKED_HEADLINE = "Cambió el horario y se superpone con otro plan. Se retiró tu participación; revisá la actividad y elegí de nuevo.";

export const noticeHeadline = (event: NoticeEvent): string => {
  switch (event.type) {
    case "post.created": return "Hay un recuerdo nuevo";
    case "comment.created": return "Nuevo comentario en un recuerdo";
    case "member.joined": return "Se sumó un integrante nuevo";
    case "member.expelled": return "Ya no sos parte de este viaje";
    case "activity.created": return "Se creó una actividad";
    case "activity.updated": return "Una actividad cambió";
    case "activity.participant_unlinked": return UNLINKED_HEADLINE;
    case "member.left": return "Un integrante salió del viaje";
    case "member.role_changed": return event.payload.role === "admin" ? "Ahora sos admin de este viaje" : "Ya no sos admin de este viaje";
    case "trip.ownership_transferred": return "Ahora sos el titular de este viaje";
  }
};

export const formatNoticeDuration = (minutes: number): string => {
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return [hours > 0 ? `${hours} h` : "", rest > 0 ? `${rest} min` : ""].filter(Boolean).join(" ");
};

const list = (items: string[]) => items.length > 1 ? `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}` : items[0] ?? "";

/** Sentence about what an edit changed, in the canonical order of the client. */
export const changedFieldsText = (fields: readonly TripNotificationPayloads["activity.updated"]["changedFields"][number][]): string => {
  const parts = [fields.includes("scheduledAt") ? "el horario" : "", fields.includes("durationMinutes") ? "la duración" : "",
    fields.includes("title") || fields.includes("description") ? "el contenido" : "", fields.includes("mapsUrl") ? "la ubicación" : ""].filter(Boolean);
  return `Cambió ${list(parts)}.`;
};

/** Lines that do not depend on a time zone: the rest (dates and times) is built by the client. May be empty. */
export const noticeBodyLines = (event: NoticeEvent): string[] => {
  switch (event.type) {
    case "activity.created":
      return event.payload.durationMinutes !== null ? [`Duración: ${formatNoticeDuration(event.payload.durationMinutes)}`] : [];
    case "activity.updated": return [changedFieldsText(event.payload.changedFields)];
    case "activity.participant_unlinked": {
      const { newInterval, changedFields } = event.payload;
      return [...(newInterval.durationMinutes !== null ? [`Duración: ${formatNoticeDuration(newInterval.durationMinutes)}`] : []),
        ...(changedFields.includes("durationMinutes") ? ["Cambió la duración."] : [])];
    }
    default: return [];
  }
};
