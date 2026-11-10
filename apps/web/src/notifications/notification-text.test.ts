import { describe, expect, it } from "vitest";
import { itineraryId } from "../trips/itinerary-test-fixture.js";
import type { TripNotification } from "./trip-notification-api.js";
import { describeNotification, formatDuration, formatNoticeTime } from "./notification-text.js";

const trip = itineraryId(1);
const at = "2026-11-10T10:00:00.000Z";
const item = (type: string, payload: Record<string, unknown>) => ({ id: itineraryId(900), type, tripId: trip, actorId: itineraryId(5), createdAt: at, payload }) as unknown as TripNotification;
const UTC = "UTC", BA = "America/Argentina/Buenos_Aires";

describe("notice time", () => {
  it("uses the injected zone, so the same instant reads differently and never depends on the machine", () => {
    expect(formatNoticeTime(at, UTC)).toContain("10:00");
    expect(formatNoticeTime(at, BA)).toContain("07:00");
    expect(formatNoticeTime("2026-11-10T02:30:00.000Z", BA)).toMatch(/9/);
    expect(formatNoticeTime(at, UTC)).toContain("2026");
  });
  it("formats the duration in hours and minutes", () => {
    expect([30, 60, 90, 120, 125, 1].map(formatDuration)).toEqual(["30 min", "1 h", "1 h 30 min", "2 h", "2 h 5 min", "1 min"]);
  });
});

describe("notice texts (generic, built in the client)", () => {
  it("has a headline per simple type and no names or titles", () => {
    expect(describeNotification(item("post.created", { postId: itineraryId(10), actorId: itineraryId(5), activityId: null }), UTC).headline).toBe("Hay un recuerdo nuevo");
    expect(describeNotification(item("comment.created", { commentId: itineraryId(6), postId: itineraryId(10), actorId: itineraryId(5) }), UTC).headline).toBe("Nuevo comentario en un recuerdo");
    expect(describeNotification(item("member.joined", { memberId: itineraryId(7), userId: itineraryId(8) }), UTC).headline).toBe("Se sumó un integrante nuevo");
    const expelled = describeNotification(item("member.expelled", { tripId: trip }), UTC);
    expect(expelled.headline).toBe("Ya no sos parte de este viaje");
    expect(expelled.lines).toEqual([]);
    expect(expelled.incompatible).toEqual([]);
    expect(expelled.decision).toBeUndefined();
  });

  it("a created activity tells the date and time and, only when set, the duration", () => {
    const withDuration = describeNotification(item("activity.created", { activityId: itineraryId(11), actorId: itineraryId(5), scheduledAt: at, durationMinutes: 90 }), BA);
    expect(withDuration.headline).toBe("Se creó una actividad");
    expect(withDuration.lines.join(" | ")).toContain("07:00");
    expect(withDuration.lines.join(" | ")).toContain("Duración: 1 h 30 min");
    const open = describeNotification(item("activity.created", { activityId: itineraryId(11), actorId: itineraryId(5), scheduledAt: at, durationMinutes: null }), UTC);
    expect(open.lines.join(" | ")).not.toContain("Duración");
  });

  it("an updated activity names only generic fields, once each", () => {
    const text = (changedFields: string[]) => describeNotification(item("activity.updated", { activityId: itineraryId(11), actorId: itineraryId(5), changedFields }), UTC);
    expect(text(["scheduledAt"]).headline).toBe("Una actividad cambió");
    expect(text(["scheduledAt"]).lines).toEqual(["Cambió el horario."]);
    expect(text(["durationMinutes"]).lines).toEqual(["Cambió la duración."]);
    expect(text(["title", "description"]).lines).toEqual(["Cambió el contenido."]);
    expect(text(["mapsUrl"]).lines).toEqual(["Cambió la ubicación."]);
    expect(text(["title", "scheduledAt", "durationMinutes", "mapsUrl"]).lines).toEqual(["Cambió el horario, la duración, el contenido y la ubicación."]);
  });

  const unlinked = (overrides: Record<string, unknown> = {}) => item("activity.participant_unlinked", {
    activityId: itineraryId(11), reason: "schedule_conflict", changedFields: ["scheduledAt"], changedAt: at,
    newInterval: { startsAt: at, durationMinutes: 60, endsAt: "2026-11-10T11:00:00.000Z" },
    incompatibleActivities: [
      { activityId: itineraryId(12), reason: "overlap", scheduledAt: "2026-11-10T10:30:00.000Z", durationMinutes: 30 },
      { activityId: itineraryId(13), reason: "same_start", scheduledAt: at, durationMinutes: null },
    ], ...overrides,
  });

  it("an unlinked participation uses the PRD phrase, the new schedule, the reason and every incompatible plan with its id", () => {
    const view = describeNotification(unlinked(), BA);
    expect(view.headline).toBe("Cambió el horario y se superpone con otro plan. Se retiró tu participación; revisá la actividad y elegí de nuevo.");
    const lines = view.lines.join(" | ");
    expect(lines).toContain("Nuevo horario");
    expect(lines).toContain("07:00");
    expect(lines).toContain("08:00");
    expect(lines).toContain("Duración: 1 h");
    expect(lines).not.toContain("Cambió la duración");
    expect(view.incompatible.map((plan) => plan.activityId)).toEqual([itineraryId(12), itineraryId(13)]);
    expect(view.incompatible[0]!.text).toMatch(/^Se superpone/);
    expect(view.incompatible[0]!.text).toContain("07:30");
    expect(view.incompatible[0]!.text).toContain("30 min");
    expect(view.incompatible[1]!.text).toMatch(/^Mismo horario/);
    expect(view.incompatible[1]!.text).not.toContain("min");
    expect(view.decision).toEqual({ action: "Revisar y decidir", note: "El aviso no cambia tu respuesta." });
  });

  it("says that the duration changed when it did, and omits the end when there is none", () => {
    const view = describeNotification(unlinked({ changedFields: ["scheduledAt", "durationMinutes"], newInterval: { startsAt: at, durationMinutes: null, endsAt: null } }), UTC);
    expect(view.lines).toContain("Cambió la duración.");
    expect(view.lines.join(" | ")).not.toContain("Duración:");
    expect(view.lines.find((line) => line.startsWith("Nuevo horario"))).not.toContain("–");
  });

  it("a notice without incompatible plans lists none", () => {
    expect(describeNotification(unlinked({ incompatibleActivities: [] }), UTC).incompatible).toEqual([]);
  });

  it("never carries a title, description, name or text of the notice's origin", () => {
    const all = JSON.stringify(describeNotification(unlinked(), UTC));
    expect(all).not.toMatch(/@|Secreto|undefined|null/);
  });
});
