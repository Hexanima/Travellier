import { describe, expect, it } from "vitest";

import { createObjectId, type ObjectId } from "../value-objects/object-id.js";
import { noticeBodyLines, noticeHeadline, type NoticeEvent } from "./notice-text.js";
import type { TripNotificationType } from "./trip-notification.js";

const id = (value: string): ObjectId => {
  const result = createObjectId(value);
  if (!result.ok) throw new Error("bad id");
  return result.value;
};
const a = id("507f1f77bcf86cd799439011"), b = id("507f1f77bcf86cd799439012"), c = id("507f1f77bcf86cd799439013");
const t = new Date("2026-12-01T15:00:00.000Z");

const events: Record<TripNotificationType, NoticeEvent> = {
  "post.created": { type: "post.created", payload: { postId: a, actorId: b, activityId: null } },
  "activity.created": { type: "activity.created", payload: { activityId: a, actorId: b, scheduledAt: t, durationMinutes: 90 } },
  "activity.updated": { type: "activity.updated", payload: { activityId: a, actorId: b, changedFields: ["scheduledAt", "mapsUrl"] } },
  "activity.participant_unlinked": { type: "activity.participant_unlinked", payload: { activityId: a, reason: "schedule_conflict", changedFields: ["durationMinutes"],
    changedAt: t, newInterval: { startsAt: t, durationMinutes: 60, endsAt: t }, incompatibleActivities: [] } },
  "member.joined": { type: "member.joined", payload: { memberId: a, userId: b } },
  "member.expelled": { type: "member.expelled", payload: { tripId: a } },
  "comment.created": { type: "comment.created", payload: { commentId: a, postId: b, actorId: c } },
  "member.left": { type: "member.left", payload: { memberId: a, userId: b } },
  "member.role_changed": { type: "member.role_changed", payload: { userId: a, role: "admin" } },
  "trip.ownership_transferred": { type: "trip.ownership_transferred", payload: { previousOwnerId: a } },
};

describe("noticeHeadline", () => {
  it("gives the literal headlines the inbox already used for the existing types", () => {
    expect(noticeHeadline(events["post.created"])).toBe("Hay un recuerdo nuevo");
    expect(noticeHeadline(events["comment.created"])).toBe("Nuevo comentario en un recuerdo");
    expect(noticeHeadline(events["member.joined"])).toBe("Se sumó un integrante nuevo");
    expect(noticeHeadline(events["member.expelled"])).toBe("Ya no sos parte de este viaje");
    expect(noticeHeadline(events["activity.created"])).toBe("Se creó una actividad");
    expect(noticeHeadline(events["activity.updated"])).toBe("Una actividad cambió");
    expect(noticeHeadline(events["activity.participant_unlinked"])).toBe("Cambió el horario y se superpone con otro plan. Se retiró tu participación; revisá la actividad y elegí de nuevo.");
  });

  it("gives one headline for each new type, depending on the new role", () => {
    expect(noticeHeadline(events["member.left"])).toBe("Un integrante salió del viaje");
    expect(noticeHeadline(events["member.role_changed"])).toBe("Ahora sos admin de este viaje");
    expect(noticeHeadline({ type: "member.role_changed", payload: { userId: a, role: "participant" } })).toBe("Ya no sos admin de este viaje");
    expect(noticeHeadline(events["trip.ownership_transferred"])).toBe("Ahora sos el titular de este viaje");
  });

  it("never includes ids, names or user content", () => {
    for (const event of Object.values(events)) {
      const text = [noticeHeadline(event), ...noticeBodyLines(event)].join(" ");
      for (const value of [a, b, c]) expect(text).not.toContain(value);
    }
  });
});

describe("noticeBodyLines", () => {
  it("has no line with a time of day and is empty for types without extra data", () => {
    for (const event of Object.values(events)) expect(noticeBodyLines(event).join(" ")).not.toMatch(/\d{1,2}:\d{2}|Empieza|Nuevo horario/);
    for (const type of ["post.created", "comment.created", "member.joined", "member.expelled", "member.left", "member.role_changed", "trip.ownership_transferred"] as const) {
      expect(noticeBodyLines(events[type])).toEqual([]);
    }
  });

  it("keeps the duration and change lines of the inbox", () => {
    expect(noticeBodyLines(events["activity.created"])).toEqual(["Duración: 1 h 30 min"]);
    expect(noticeBodyLines(events["activity.updated"])).toEqual(["Cambió el horario y la ubicación."]);
    expect(noticeBodyLines(events["activity.participant_unlinked"])).toEqual(["Duración: 1 h", "Cambió la duración."]);
    expect(noticeBodyLines({ type: "activity.created", payload: { activityId: a, actorId: b, scheduledAt: t, durationMinutes: null } })).toEqual([]);
  });
});
