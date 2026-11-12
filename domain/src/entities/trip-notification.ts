import type { ObjectId } from "../value-objects/object-id.js";
import type { ActivityConflict } from "./activity-conflict.js";
import { activityEndsAt } from "./activity-schedule.js";
import type { Activity } from "./activity.js";

/**
 * Events persisted with the operation that originates them (T91). There is no event for likes, votes, post or comment edits,
 * going/not going or activity deletion. T135 adds leaving (to the members who stay), role change (to the affected member) and
 * ownership transfer (to the new owner); the expulsion keeps its single recipient.
 */
export type TripNotificationType = "post.created" | "activity.created" | "activity.updated" | "activity.participant_unlinked"
  | "member.joined" | "member.expelled" | "comment.created" | "member.left" | "member.role_changed" | "trip.ownership_transferred";

/** Notices stay in the inbox this long (TTL index on `outboxEvents`; a still pending dispatch is never deleted). */
export const NOTIFICATION_RETENTION_DAYS = 90;

export type ActivityUpdatedField = "title" | "description" | "mapsUrl" | "scheduledAt" | "durationMinutes";

/** Only ids and UTC instants: no text of the post, comment or activity travels in an event. */
export interface TripNotificationPayloads {
  "post.created": { postId: ObjectId; actorId: ObjectId; activityId: ObjectId | null };
  "activity.created": { activityId: ObjectId; actorId: ObjectId; scheduledAt: Date; durationMinutes: number | null };
  "activity.updated": { activityId: ObjectId; actorId: ObjectId; changedFields: ActivityUpdatedField[] };
  "activity.participant_unlinked": ParticipantUnlinkedPayload;
  "member.joined": { memberId: ObjectId; userId: ObjectId };
  "member.expelled": { tripId: ObjectId };
  "comment.created": { commentId: ObjectId; postId: ObjectId; actorId: ObjectId };
  /** `userId` is whoever left. */
  "member.left": { memberId: ObjectId; userId: ObjectId };
  /** `role` is the new role of the recipient. */
  "member.role_changed": { userId: ObjectId; role: "admin" | "participant" };
  "trip.ownership_transferred": { previousOwnerId: ObjectId };
}

export interface ParticipantUnlinkedPayload {
  activityId: ObjectId;
  reason: "schedule_conflict";
  changedFields: ("scheduledAt" | "durationMinutes")[];
  changedAt: Date;
  newInterval: { startsAt: Date; durationMinutes: number | null; endsAt: Date | null };
  /** Every incompatible plan of the recipient, not only the first. */
  incompatibleActivities: { activityId: ObjectId; reason: ActivityConflict["reason"]; scheduledAt: Date; durationMinutes: number | null }[];
}

/** One event for one recipient: `eventKey` makes its write idempotent (unique index of `outboxEvents`). */
export interface TripNotificationDraft<T extends TripNotificationType = TripNotificationType> {
  eventKey: string;
  type: T;
  tripId: ObjectId;
  /** Recipient. */
  userId: ObjectId;
  /** Author of the operation; null when the event has none (expulsion). */
  actorId: ObjectId | null;
  /** The operation, shared by every recipient of it. */
  operationKey: string;
  payload: TripNotificationPayloads[T];
  createdAt: Date;
}

export const notificationEventKey = (type: TripNotificationType, operationRef: ObjectId, userId: ObjectId): string =>
  `${type}:${operationRef}:${userId}`;

/** Members without the excluded users, each one once, keeping the order. */
export const notificationRecipients = (memberIds: readonly ObjectId[], excluded: readonly ObjectId[]): ObjectId[] => {
  const skip = new Set<ObjectId>(excluded);
  return [...new Set(memberIds)].filter((memberId) => !skip.has(memberId));
};

export interface BuildTripNotificationsInput<T extends TripNotificationType> {
  type: T;
  tripId: ObjectId;
  /** Id of the thing the event is about (post, activity, comment, membership) or of the edit operation. */
  operationRef: ObjectId;
  actorId: ObjectId | null;
  recipients: readonly ObjectId[];
  payload: TripNotificationPayloads[T];
  createdAt: Date;
}

export const buildTripNotifications = <T extends TripNotificationType>(input: BuildTripNotificationsInput<T>): TripNotificationDraft<T>[] =>
  notificationRecipients(input.recipients, []).map((userId) => ({
    eventKey: notificationEventKey(input.type, input.operationRef, userId), type: input.type, tripId: input.tripId, userId,
    actorId: input.actorId, operationKey: `${input.type}:${input.operationRef}`, payload: input.payload, createdAt: input.createdAt,
  }));

type EditableSnapshot = Pick<Activity, "title" | "description" | "mapsUrl" | "scheduledAt" | "durationMinutes">;

/** Fields of an edit that really changed, in canonical order; empty when the edit changed nothing. */
export const activityUpdatedFields = (before: EditableSnapshot, after: EditableSnapshot): ActivityUpdatedField[] => {
  const changed: ActivityUpdatedField[] = [];
  if (before.title !== after.title) changed.push("title");
  if ((before.description ?? null) !== (after.description ?? null)) changed.push("description");
  if ((before.mapsUrl ?? null) !== (after.mapsUrl ?? null)) changed.push("mapsUrl");
  if (before.scheduledAt.getTime() !== after.scheduledAt.getTime()) changed.push("scheduledAt");
  if ((before.durationMinutes ?? null) !== (after.durationMinutes ?? null)) changed.push("durationMinutes");
  return changed;
};

export const participantUnlinkedPayload = (input: { activity: Pick<Activity, "id" | "scheduledAt" | "durationMinutes">;
  changedFields: ParticipantUnlinkedPayload["changedFields"]; changedAt: Date; conflicts: readonly ActivityConflict[] }): ParticipantUnlinkedPayload => ({
  activityId: input.activity.id, reason: "schedule_conflict", changedFields: [...input.changedFields], changedAt: new Date(input.changedAt.getTime()),
  newInterval: { startsAt: input.activity.scheduledAt, durationMinutes: input.activity.durationMinutes ?? null, endsAt: activityEndsAt(input.activity) },
  incompatibleActivities: input.conflicts.map(({ activityId, reason, scheduledAt, durationMinutes }) => ({ activityId, reason, scheduledAt, durationMinutes })),
});
