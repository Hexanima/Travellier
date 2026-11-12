import { noticeBodyLines, noticeHeadline, type NoticeEvent } from "app-domain";
import type { TripNotification } from "./trip-notification-api.js";

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

/** The zone is injectable; by default it is the device's. */
export const formatNoticeTime = (iso: string, timeZone?: string): string =>
  new Intl.DateTimeFormat("es-AR", { ...(timeZone ? { timeZone } : {}), day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
const clock = (iso: string, timeZone?: string): string =>
  new Intl.DateTimeFormat("es-AR", { ...(timeZone ? { timeZone } : {}), hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

export const formatDuration = (minutes: number): string => {
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return [hours > 0 ? `${hours} h` : "", rest > 0 ? `${rest} min` : ""].filter(Boolean).join(" ");
};

/** Headline and lines without a time come from the single text contract of `app-domain` (shared with the push); lines with a time are built here. */
const shared = (notification: TripNotification) => {
  const event = { type: notification.type, payload: notification.payload } as unknown as NoticeEvent;
  return { headline: noticeHeadline(event), lines: noticeBodyLines(event) };
};

export const describeNotification = (notification: TripNotification, timeZone?: string): NoticeText => {
  const { headline, lines } = shared(notification);
  switch (notification.type) {
    case "activity.created":
      return { headline, incompatible: [], lines: [`Empieza el ${formatNoticeTime(notification.payload.scheduledAt, timeZone)}.`, ...lines] };
    case "activity.participant_unlinked": {
      const { newInterval, incompatibleActivities } = notification.payload;
      return {
        headline,
        lines: [`Nuevo horario: ${formatNoticeTime(newInterval.startsAt, timeZone)}${newInterval.endsAt !== null ? ` – ${clock(newInterval.endsAt, timeZone)}` : ""}.`, ...lines],
        incompatible: incompatibleActivities.map((plan) => ({ activityId: plan.activityId,
          text: `${plan.reason === "overlap" ? "Se superpone" : "Mismo horario"}: ${formatNoticeTime(plan.scheduledAt, timeZone)}${plan.durationMinutes !== null ? ` (${formatDuration(plan.durationMinutes)})` : ""}` })),
        decision: { action: "Revisar y decidir", note: "El aviso no cambia tu respuesta." },
      };
    }
    default:
      return { headline, lines, incompatible: [] };
  }
};
