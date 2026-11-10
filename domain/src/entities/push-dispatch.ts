import type { ObjectId } from "../value-objects/object-id.js";
import { MAX_PUSH_DEVICES_PER_USER } from "./push-device.js";
import { computeRetryDelay } from "./storage-deletion-job.js";
import type { TripNotificationPayloads, TripNotificationType } from "./trip-notification.js";

/**
 * Provisional policy of the push dispatcher (T92). Dispatching never creates nor deletes app notifications: the in-app inbox
 * reads the same `outboxEvents` documents and ignores their dispatch state.
 */
export const PUSH_DISPATCH_LEASE_SECONDS = 120;
export const PUSH_DISPATCH_MAX_ATTEMPTS = 5;
/** An event older than this is not pushed anymore (it stays in the inbox). */
export const PUSH_DISPATCH_VALIDITY_MS = 24 * 60 * 60 * 1000;
/** Events handled per worker tick. */
export const PUSH_DISPATCH_BATCH_SIZE = 20;
export const PUSH_DISPATCH_MAX_DEVICES_PER_USER = MAX_PUSH_DEVICES_PER_USER;
/** Providers accept about 4 KB; the message stays below this on purpose. */
export const PUSH_DISPATCH_MAX_MESSAGE_BYTES = 3500;

/** Dispatch state of an `outboxEvents` document (additive; documents of T91 start as `pending` with no attempts). */
export type PushDispatchStatus = "pending" | "sent" | "skipped" | "failed";
export type PushDispatchOutcome = "delivered" | "no_devices" | "not_member" | "trip_deleted" | "expired" | "invalid_only";

/** Delay before the next attempt after `attempts` failed attempts: 1 minute doubling, capped at 6 hours. */
export const computePushRetryDelay = (attempts: number): number => computeRetryDelay(attempts);

export type PushableEvent = { [T in TripNotificationType]: { id: ObjectId; type: T; tripId: ObjectId; payload: TripNotificationPayloads[T] } }[TripNotificationType];

/** `data` only holds strings (a provider requirement) and ids: the client resolves the detail from `GET /notifications`. */
export interface PushMessage {
  title: string;
  body: string;
  data: Record<string, string>;
}

/**
 * Literal text of the PRD for the unlinked participant (section "Edición de actividades"). The PRD defines no other push text, so the
 * rest are generic, without names, titles or any user text.
 */
const UNLINKED_BODY = "Cambió el horario y se superpone con otro plan. Se retiró tu participación; revisá la actividad y elegí de nuevo.";

export const buildPushMessage = (event: PushableEvent): PushMessage => {
  const base = { notificationId: event.id, type: event.type, tripId: event.tripId };
  switch (event.type) {
    case "post.created":
      return { title: "Nuevo recuerdo", body: "Se compartió un recuerdo en tu viaje.",
        data: { ...base, postId: event.payload.postId, ...(event.payload.activityId === null ? {} : { activityId: event.payload.activityId }) } };
    case "activity.created":
      return { title: "Nueva actividad", body: "Se sumó una actividad al viaje.", data: { ...base, activityId: event.payload.activityId } };
    case "activity.updated":
      return { title: "Actividad modificada", body: "Se modificó una actividad del viaje.", data: { ...base, activityId: event.payload.activityId } };
    case "activity.participant_unlinked": {
      const { activityId, newInterval } = event.payload;
      return { title: "Actividad modificada", body: UNLINKED_BODY, data: { ...base, activityId, scheduledAt: newInterval.startsAt.toISOString(),
        ...(newInterval.durationMinutes === null ? {} : { durationMinutes: String(newInterval.durationMinutes) }) } };
    }
    case "member.joined":
      return { title: "Nuevo integrante", body: "Alguien se sumó al viaje.", data: { ...base, memberId: event.payload.memberId } };
    case "member.expelled":
      return { title: "Ya no sos parte del viaje", body: "Ya no tenés acceso a un viaje.", data: base };
    case "comment.created":
      return { title: "Nuevo comentario", body: "Hay un comentario nuevo en un recuerdo del viaje.",
        data: { ...base, commentId: event.payload.commentId, postId: event.payload.postId } };
  }
};
