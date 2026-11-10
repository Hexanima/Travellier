import type { HttpClient } from "../api/index.js";
import { interactionFailure, isId, isRecord, isTimestamp, serverFailure } from "../trips/api-failure.js";
import type { TripResult } from "../trips/trip-management-api.js";

export type ActivityUpdatedField = "title" | "description" | "mapsUrl" | "scheduledAt" | "durationMinutes";
export type ScheduleField = "scheduledAt" | "durationMinutes";
export type IncompatibleActivity = { activityId: string; reason: "overlap" | "same_start"; scheduledAt: string; durationMinutes: number | null };

/** Only ids and UTC instants: the backend never sends titles, names or comment text, and the parser rebuilds each shape field by field. */
type Common = { id: string; tripId: string; actorId: string | null; createdAt: string };
export type TripNotification = Common & (
  | { type: "post.created"; payload: { postId: string; actorId: string; activityId: string | null } }
  | { type: "activity.created"; payload: { activityId: string; actorId: string; scheduledAt: string; durationMinutes: number | null } }
  | { type: "activity.updated"; payload: { activityId: string; actorId: string; changedFields: ActivityUpdatedField[] } }
  | { type: "activity.participant_unlinked"; payload: { activityId: string; reason: "schedule_conflict"; changedFields: ScheduleField[]; changedAt: string;
    newInterval: { startsAt: string; durationMinutes: number | null; endsAt: string | null }; incompatibleActivities: IncompatibleActivity[] } }
  | { type: "member.joined"; payload: { memberId: string; userId: string } }
  | { type: "member.expelled"; payload: { tripId: string } }
  | { type: "comment.created"; payload: { commentId: string; postId: string; actorId: string } }
);
export type TripNotificationType = TripNotification["type"];
export type NotificationPage = { notifications: TripNotification[]; nextCursor: string | null };
export type NotificationQuery = { limit?: number; cursor?: string };
export type TripNotificationApi = {
  /** One page of the personal inbox, newest first; the order is the server's and the client never re-sorts or re-paginates. */
  list: (query: NotificationQuery) => Promise<TripResult<NotificationPage>>;
};

const maxPage = 60;
const maxIncompatible = 100;
const updatedFields: readonly string[] = ["title", "description", "mapsUrl", "scheduledAt", "durationMinutes"];
const scheduleFields: readonly string[] = ["scheduledAt", "durationMinutes"];
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const minutes = (value: unknown): value is number | null => value === null || (typeof value === "number" && Number.isInteger(value) && value > 0);
const idOrNull = (value: unknown): value is string | null => value === null || isId(value);
const fieldList = <T extends string>(value: unknown, allowed: readonly string[]): T[] | undefined =>
  Array.isArray(value) && value.length > 0 && value.length <= allowed.length && value.every((field) => typeof field === "string" && allowed.includes(field)) && new Set(value).size === value.length
    ? [...value] as T[] : undefined;

const parseIncompatible = (value: unknown): IncompatibleActivity | undefined => {
  if (!isRecord(value) || !exact(value, ["activityId", "reason", "scheduledAt", "durationMinutes"]) || !isId(value.activityId) || !isTimestamp(value.scheduledAt) || !minutes(value.durationMinutes) ||
    (value.reason !== "overlap" && value.reason !== "same_start")) return undefined;
  return { activityId: value.activityId, reason: value.reason, scheduledAt: value.scheduledAt, durationMinutes: value.durationMinutes };
};

type Payload = TripNotification["payload"];
const parsePayload = (type: string, tripId: string, payload: unknown): Payload | undefined => {
  if (!isRecord(payload)) return undefined;
  switch (type) {
    case "post.created":
      return exact(payload, ["postId", "actorId", "activityId"]) && isId(payload.postId) && isId(payload.actorId) && idOrNull(payload.activityId)
        ? { postId: payload.postId, actorId: payload.actorId, activityId: payload.activityId } : undefined;
    case "activity.created":
      return exact(payload, ["activityId", "actorId", "scheduledAt", "durationMinutes"]) && isId(payload.activityId) && isId(payload.actorId) && isTimestamp(payload.scheduledAt) && minutes(payload.durationMinutes)
        ? { activityId: payload.activityId, actorId: payload.actorId, scheduledAt: payload.scheduledAt, durationMinutes: payload.durationMinutes } : undefined;
    case "activity.updated": {
      const changedFields = exact(payload, ["activityId", "actorId", "changedFields"]) ? fieldList<ActivityUpdatedField>(payload.changedFields, updatedFields) : undefined;
      return changedFields && isId(payload.activityId) && isId(payload.actorId) ? { activityId: payload.activityId, actorId: payload.actorId, changedFields } : undefined;
    }
    case "activity.participant_unlinked": {
      if (!exact(payload, ["activityId", "reason", "changedFields", "changedAt", "newInterval", "incompatibleActivities"])) return undefined;
      const changedFields = fieldList<ScheduleField>(payload.changedFields, scheduleFields);
      const interval = payload.newInterval;
      const list = payload.incompatibleActivities;
      if (!changedFields || !isId(payload.activityId) || payload.reason !== "schedule_conflict" || !isTimestamp(payload.changedAt) || !isRecord(interval) ||
        !exact(interval, ["startsAt", "durationMinutes", "endsAt"]) || !isTimestamp(interval.startsAt) || !minutes(interval.durationMinutes) ||
        (interval.endsAt !== null && !isTimestamp(interval.endsAt)) || !Array.isArray(list) || list.length > maxIncompatible) return undefined;
      const incompatibleActivities = list.map(parseIncompatible);
      if (!incompatibleActivities.every((item) => item !== undefined)) return undefined;
      return { activityId: payload.activityId, reason: "schedule_conflict", changedFields, changedAt: payload.changedAt,
        newInterval: { startsAt: interval.startsAt, durationMinutes: interval.durationMinutes, endsAt: interval.endsAt }, incompatibleActivities };
    }
    case "member.joined":
      return exact(payload, ["memberId", "userId"]) && isId(payload.memberId) && isId(payload.userId) ? { memberId: payload.memberId, userId: payload.userId } : undefined;
    case "member.expelled":
      return exact(payload, ["tripId"]) && payload.tripId === tripId ? { tripId } : undefined;
    case "comment.created":
      return exact(payload, ["commentId", "postId", "actorId"]) && isId(payload.commentId) && isId(payload.postId) && isId(payload.actorId)
        ? { commentId: payload.commentId, postId: payload.postId, actorId: payload.actorId } : undefined;
    default:
      return undefined;
  }
};

/** Strict and rebuilt field by field: anything off is a server failure and nothing of the payload is echoed. */
const parseNotification = (value: unknown): TripNotification | undefined => {
  if (!isRecord(value) || !exact(value, ["id", "type", "tripId", "actorId", "payload", "createdAt"]) || !isId(value.id) || typeof value.type !== "string" ||
    !isId(value.tripId) || !idOrNull(value.actorId) || !isTimestamp(value.createdAt)) return undefined;
  if (value.type === "member.expelled" && value.actorId !== null) return undefined;
  const payload = parsePayload(value.type, value.tripId, value.payload);
  if (!payload) return undefined;
  return { id: value.id, type: value.type, tripId: value.tripId, actorId: value.actorId, createdAt: value.createdAt, payload } as TripNotification;
};

export const createTripNotificationApi = (client: Pick<HttpClient, "get">): TripNotificationApi => ({
  list: async ({ limit, cursor }) => {
    const query = new URLSearchParams();
    if (limit !== undefined) query.set("limit", String(limit));
    if (cursor !== undefined) query.set("cursor", cursor);
    const suffix = query.toString();
    const result = await client.get<unknown>(`/notifications${suffix ? `?${suffix}` : ""}`);
    if (!result.ok) return interactionFailure(result.error);
    const body = result.value;
    if (!isRecord(body) || !Array.isArray(body.notifications) || body.notifications.length > maxPage) return serverFailure;
    if (body.nextCursor !== null && (typeof body.nextCursor !== "string" || body.nextCursor === "")) return serverFailure;
    const notifications = body.notifications.map(parseNotification);
    if (!notifications.every((item) => item !== undefined) || new Set(notifications.map((item) => item.id)).size !== notifications.length) return serverFailure;
    return { ok: true, value: { notifications, nextCursor: body.nextCursor } };
  },
});
