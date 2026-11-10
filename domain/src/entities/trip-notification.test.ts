import { describe, expect, it } from "vitest";

import { createObjectId, type ObjectId } from "../value-objects/object-id.js";
import {
  activityUpdatedFields,
  buildTripNotifications,
  notificationEventKey,
  notificationRecipients,
  participantUnlinkedPayload,
} from "./trip-notification.js";

const id = (n: number): ObjectId => {
  const parsed = createObjectId(n.toString(16).padStart(24, "0"));
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};
const tripId = id(1), actor = id(2), other = id(3), third = id(4), postId = id(5);
const createdAt = new Date("2026-10-04T12:00:00.789Z");

describe("notificationEventKey", () => {
  it("is deterministic per type, operation and recipient", () => {
    expect(notificationEventKey("post.created", postId, other)).toBe(`post.created:${postId}:${other}`);
    expect(notificationEventKey("post.created", postId, other)).toBe(notificationEventKey("post.created", postId, other));
    expect(notificationEventKey("post.created", postId, other)).not.toBe(notificationEventKey("post.created", postId, third));
    expect(notificationEventKey("post.created", postId, other)).not.toBe(notificationEventKey("comment.created", postId, other));
  });
});

describe("notificationRecipients", () => {
  it("lists the members once and without the excluded users", () => {
    expect(notificationRecipients([actor, other, other, third], [actor])).toEqual([other, third]);
    expect(notificationRecipients([actor], [actor])).toEqual([]);
    expect(notificationRecipients([actor, other, third], [actor, third])).toEqual([other]);
  });
});

describe("buildTripNotifications", () => {
  it("creates one draft per recipient with keys, actor and the operation time", () => {
    const drafts = buildTripNotifications({ type: "post.created", tripId, operationRef: postId, actorId: actor, recipients: [other, third],
      payload: { postId, actorId: actor, activityId: null }, createdAt });
    expect(drafts).toEqual([other, third].map((userId) => ({ eventKey: `post.created:${postId}:${userId}`, type: "post.created", tripId, userId,
      actorId: actor, operationKey: `post.created:${postId}`, payload: { postId, actorId: actor, activityId: null }, createdAt })));
  });

  it("creates nothing without recipients and does not repeat a recipient", () => {
    expect(buildTripNotifications({ type: "comment.created", tripId, operationRef: id(9), actorId: actor, recipients: [],
      payload: { commentId: id(9), postId, actorId: actor }, createdAt })).toEqual([]);
    expect(buildTripNotifications({ type: "comment.created", tripId, operationRef: id(9), actorId: actor, recipients: [other, other],
      payload: { commentId: id(9), postId, actorId: actor }, createdAt })).toHaveLength(1);
  });

  it("the expulsion has no actor", () => {
    const [draft] = buildTripNotifications({ type: "member.expelled", tripId, operationRef: id(7), actorId: null, recipients: [other],
      payload: { tripId }, createdAt });
    expect(draft).toMatchObject({ actorId: null, userId: other, payload: { tripId } });
  });
});

describe("activityUpdatedFields", () => {
  const before = { title: "Paseo", description: null, mapsUrl: null, scheduledAt: new Date("2026-09-25T12:00:00.000Z"), durationMinutes: null };
  it("lists the changed fields in canonical order and none when nothing changed", () => {
    expect(activityUpdatedFields(before, { ...before })).toEqual([]);
    expect(activityUpdatedFields(before, { ...before, scheduledAt: new Date(before.scheduledAt.getTime()), description: null })).toEqual([]);
    expect(activityUpdatedFields(before, { ...before, durationMinutes: 60, title: "Museo", mapsUrl: "https://maps.app.goo.gl/x",
      description: "Centro", scheduledAt: new Date("2026-09-25T13:00:00.000Z") }))
      .toEqual(["title", "description", "mapsUrl", "scheduledAt", "durationMinutes"]);
  });
});

describe("participantUnlinkedPayload", () => {
  const activity = { id: id(20), scheduledAt: new Date("2026-09-25T12:00:00.000Z"), durationMinutes: 90 };
  const changedAt = new Date("2026-10-05T10:00:00.000Z");
  const conflicts = [
    { activityId: id(21), reason: "overlap" as const, scheduledAt: new Date("2026-09-25T11:00:00.000Z"), durationMinutes: 120 },
    { activityId: id(22), reason: "same_start" as const, scheduledAt: new Date("2026-09-25T12:00:00.000Z"), durationMinutes: null },
  ];
  it("keeps the reason, the new interval with the derived end and every incompatible activity", () => {
    expect(participantUnlinkedPayload({ activity, changedFields: ["scheduledAt"], changedAt, conflicts })).toEqual({
      activityId: id(20), reason: "schedule_conflict", changedFields: ["scheduledAt"], changedAt,
      newInterval: { startsAt: activity.scheduledAt, durationMinutes: 90, endsAt: new Date("2026-09-25T13:30:00.000Z") },
      incompatibleActivities: conflicts,
    });
  });
  it("has a null end when the activity has no duration", () => {
    expect(participantUnlinkedPayload({ activity: { ...activity, durationMinutes: null }, changedFields: ["durationMinutes"], changedAt, conflicts }).newInterval)
      .toEqual({ startsAt: activity.scheduledAt, durationMinutes: null, endsAt: null });
  });
});
