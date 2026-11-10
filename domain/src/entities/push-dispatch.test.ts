import { describe, expect, it } from "vitest";

import { createObjectId, type ObjectId } from "../value-objects/object-id.js";
import {
  PUSH_DISPATCH_BATCH_SIZE,
  PUSH_DISPATCH_LEASE_SECONDS,
  PUSH_DISPATCH_MAX_ATTEMPTS,
  PUSH_DISPATCH_MAX_DEVICES_PER_USER,
  PUSH_DISPATCH_MAX_MESSAGE_BYTES,
  PUSH_DISPATCH_VALIDITY_MS,
  buildPushMessage,
  computePushRetryDelay,
  type PushableEvent,
} from "./push-dispatch.js";
import type { TripNotificationType } from "./trip-notification.js";

const id = (value: string): ObjectId => {
  const result = createObjectId(value);
  if (!result.ok) throw new Error("bad id");
  return result.value;
};
const notificationId = id("607f1f77bcf86cd799439001"), tripId = id("507f1f77bcf86cd799439011"), activityId = id("507f1f77bcf86cd799439012");
const postId = id("507f1f77bcf86cd799439013"), commentId = id("507f1f77bcf86cd799439014"), actorId = id("507f1f77bcf86cd799439015");
const memberId = id("507f1f77bcf86cd799439016"), userId = id("507f1f77bcf86cd799439017"), otherActivity = id("507f1f77bcf86cd799439018");
const startsAt = new Date("2026-12-01T15:00:00.000Z");

const events: Record<TripNotificationType, PushableEvent> = {
  "post.created": { id: notificationId, type: "post.created", tripId, payload: { postId, actorId, activityId } },
  "activity.created": { id: notificationId, type: "activity.created", tripId, payload: { activityId, actorId, scheduledAt: startsAt, durationMinutes: 90 } },
  "activity.updated": { id: notificationId, type: "activity.updated", tripId, payload: { activityId, actorId, changedFields: ["title", "mapsUrl", "scheduledAt", "durationMinutes"] } },
  "activity.participant_unlinked": { id: notificationId, type: "activity.participant_unlinked", tripId, payload: {
    activityId, reason: "schedule_conflict", changedFields: ["scheduledAt"], changedAt: new Date("2026-11-10T12:00:00.000Z"),
    newInterval: { startsAt, durationMinutes: 90, endsAt: new Date("2026-12-01T16:30:00.000Z") },
    incompatibleActivities: [{ activityId: otherActivity, reason: "overlap", scheduledAt: startsAt, durationMinutes: 60 }] } },
  "member.joined": { id: notificationId, type: "member.joined", tripId, payload: { memberId, userId } },
  "member.expelled": { id: notificationId, type: "member.expelled", tripId, payload: { tripId } },
  "comment.created": { id: notificationId, type: "comment.created", tripId, payload: { commentId, postId, actorId } },
};

const allStrings = (data: Record<string, unknown>) => Object.values(data).every((value) => typeof value === "string");

describe("push dispatch policy", () => {
  it("fixes the provisional dispatch policy", () => {
    expect(PUSH_DISPATCH_LEASE_SECONDS).toBe(120);
    expect(PUSH_DISPATCH_MAX_ATTEMPTS).toBe(5);
    expect(PUSH_DISPATCH_VALIDITY_MS).toBe(24 * 60 * 60 * 1000);
    expect(PUSH_DISPATCH_BATCH_SIZE).toBe(20);
    expect(PUSH_DISPATCH_MAX_DEVICES_PER_USER).toBeGreaterThan(0);
  });

  it("grows the retry delay from one minute up to a six hour cap", () => {
    expect(computePushRetryDelay(1)).toBe(60_000);
    expect(computePushRetryDelay(2)).toBe(120_000);
    expect(computePushRetryDelay(3)).toBeGreaterThan(computePushRetryDelay(2));
    expect(computePushRetryDelay(40)).toBe(6 * 60 * 60 * 1000);
  });
});

describe("buildPushMessage", () => {
  it("carries the exact ids of every type as strings, with the outbox id as notificationId", () => {
    const data = (type: TripNotificationType) => buildPushMessage(events[type]).data;
    expect(data("post.created")).toEqual({ notificationId, type: "post.created", tripId, postId, activityId });
    expect(data("activity.created")).toEqual({ notificationId, type: "activity.created", tripId, activityId });
    expect(data("activity.updated")).toEqual({ notificationId, type: "activity.updated", tripId, activityId });
    expect(data("member.joined")).toEqual({ notificationId, type: "member.joined", tripId, memberId });
    expect(data("comment.created")).toEqual({ notificationId, type: "comment.created", tripId, commentId, postId });
    expect(data("member.expelled")).toEqual({ notificationId, type: "member.expelled", tripId });
    expect(data("activity.participant_unlinked")).toEqual({
      notificationId, type: "activity.participant_unlinked", tripId, activityId, scheduledAt: "2026-12-01T15:00:00.000Z", durationMinutes: "90" });
  });

  it("omits the activity of an independent post and the duration of an activity without one", () => {
    const post = buildPushMessage({ ...events["post.created"], payload: { postId, actorId, activityId: null } } as PushableEvent);
    expect(post.data).toEqual({ notificationId, type: "post.created", tripId, postId });
    const unlinked = events["activity.participant_unlinked"];
    if (unlinked.type !== "activity.participant_unlinked") throw new Error("type");
    const message = buildPushMessage({ ...unlinked, payload: { ...unlinked.payload, newInterval: { startsAt, durationMinutes: null, endsAt: null } } });
    expect(message.data).not.toHaveProperty("durationMinutes");
    expect(message.data.scheduledAt).toBe("2026-12-01T15:00:00.000Z");
  });

  it("uses only strings in data and a title and body for every type", () => {
    for (const event of Object.values(events)) {
      const message = buildPushMessage(event);
      expect(allStrings(message.data)).toBe(true);
      expect(message.title.length).toBeGreaterThan(0);
      expect(message.body.length).toBeGreaterThan(0);
    }
  });

  it("uses the literal text of the PRD for the unlinked participant and does not list incompatible activities", () => {
    const message = buildPushMessage(events["activity.participant_unlinked"]);
    expect(message.body).toBe("Cambió el horario y se superpone con otro plan. Se retiró tu participación; revisá la actividad y elegí de nuevo.");
    expect(JSON.stringify(message)).not.toContain(otherActivity);
  });

  it("never carries user text, actors, reasons or votes, and keeps changed content out of the message", () => {
    for (const event of Object.values(events)) {
      const serialized = JSON.stringify(buildPushMessage(event));
      expect(serialized).not.toContain(actorId);
      expect(serialized).not.toMatch(/voto|votar|vot(e|ing)|aprob|approv|schedule_conflict|mapsUrl|changedFields/i);
    }
  });

  it("stays well below the provider payload limit", () => {
    for (const event of Object.values(events)) {
      expect(new TextEncoder().encode(JSON.stringify(buildPushMessage(event))).length).toBeLessThanOrEqual(PUSH_DISPATCH_MAX_MESSAGE_BYTES);
    }
    expect(PUSH_DISPATCH_MAX_MESSAGE_BYTES).toBeLessThanOrEqual(3584);
  });
});
