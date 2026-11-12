import type { ObjectId } from "../value-objects/object-id.js";
import { noticeBodyLines, noticeHeadline } from "./notice-text.js";
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
export type PushDispatchOutcome = "delivered" | "no_devices" | "not_member" | "trip_deleted" | "expired" | "invalid_only" | "rejoined";

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
 * Title and body come from the single text contract of the notices (`notice-text`), shared with the in-app inbox (T135). The body only
 * holds lines that do not depend on a time zone (it may be empty); times are shown by the client from the inbox.
 */
const text = (event: PushableEvent) => ({ title: noticeHeadline(event), body: noticeBodyLines(event).join("\n") });

export const buildPushMessage = (event: PushableEvent): PushMessage => {
  const base = { notificationId: event.id, type: event.type, tripId: event.tripId };
  switch (event.type) {
    case "post.created":
      return { ...text(event),
        data: { ...base, postId: event.payload.postId, ...(event.payload.activityId === null ? {} : { activityId: event.payload.activityId }) } };
    case "activity.created":
      return { ...text(event), data: { ...base, activityId: event.payload.activityId } };
    case "activity.updated":
      return { ...text(event), data: { ...base, activityId: event.payload.activityId } };
    case "activity.participant_unlinked": {
      const { activityId, newInterval } = event.payload;
      return { ...text(event), data: { ...base, activityId, scheduledAt: newInterval.startsAt.toISOString(),
        ...(newInterval.durationMinutes === null ? {} : { durationMinutes: String(newInterval.durationMinutes) }) } };
    }
    case "member.joined":
      return { ...text(event), data: { ...base, memberId: event.payload.memberId } };
    case "member.expelled":
      return { ...text(event), data: base };
    case "comment.created":
      return { ...text(event), data: { ...base, commentId: event.payload.commentId, postId: event.payload.postId } };
    case "member.left":
      return { ...text(event), data: { ...base, memberId: event.payload.memberId } };
    case "member.role_changed":
    case "trip.ownership_transferred":
      return { ...text(event), data: base };
  }
};
