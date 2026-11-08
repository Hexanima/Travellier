import { describe, expect, it } from "vitest";
import * as domain from "../index.js";
import type { ActivityParticipation } from "./activity-participation.js";

const id = (number: number) => {
  const result = domain.createObjectId(number.toString(16).padStart(24, "0"));
  if (!result.ok) throw result.error;
  return result.value;
};
const tripId = id(1), otherTrip = id(2), me = id(10), other = id(11);
const at = (time: string) => new Date(`2026-09-25T${time}:00.000Z`);
const act = (n: number, start: Date, durationMinutes?: number | null, trip = tripId) =>
  ({ id: id(100 + n), tripId: trip, scheduledAt: start, durationMinutes });
const part = (activity: { id: ReturnType<typeof id>; tripId: ReturnType<typeof id> }, status: ActivityParticipation["status"] = "going",
  userId = me, trip = activity.tripId): ActivityParticipation =>
  ({ id: id(900 + Number(activity.id.slice(-3))), tripId: trip, activityId: activity.id, userId, status, updatedAt: at("00:00") });
const find = (candidate: ReturnType<typeof act>, activities: ReturnType<typeof act>[], participations: ActivityParticipation[]) =>
  domain.findAgendaConflicts({ candidate, userId: me, tripId, activities, participations });

describe("activitiesConflict", () => {
  it("detects partial intersection and containment", () => {
    expect(domain.activitiesConflict(act(1, at("10:00"), 120), act(2, at("11:00"), 120))).toBe("overlap");
    expect(domain.activitiesConflict(act(1, at("10:00"), 240), act(2, at("11:00"), 30))).toBe("overlap");
  });
  it("treats contiguous intervals as compatible in both orders", () => {
    expect(domain.activitiesConflict(act(1, at("10:00"), 120), act(2, at("12:00"), 60))).toBeNull();
    expect(domain.activitiesConflict(act(2, at("12:00"), 60), act(1, at("10:00"), 120))).toBeNull();
  });
  it("keeps millisecond precision", () => {
    const a = act(1, at("10:00"), 1);
    expect(domain.activitiesConflict(a, act(2, new Date(at("10:01").getTime() + 1), 1))).toBeNull();
    expect(domain.activitiesConflict(a, act(2, new Date(at("10:01").getTime() - 1), 1))).toBe("overlap");
  });
  it("uses same_start without duration and invents no interval", () => {
    expect(domain.activitiesConflict(act(1, at("10:00")), act(2, at("10:00"), null))).toBe("same_start");
    expect(domain.activitiesConflict(act(1, at("10:00")), act(2, at("10:00"), 60))).toBe("same_start");
    expect(domain.activitiesConflict(act(1, at("10:00")), act(2, at("10:01")))).toBeNull();
    expect(domain.activitiesConflict(act(1, at("10:00"), 180), act(2, at("11:00")))).toBeNull();
    expect(domain.activitiesConflict(act(1, at("10:00")), act(2, new Date(at("10:00").getTime() + 1)))).toBeNull();
  });
});

describe("findAgendaConflicts", () => {
  it("returns every conflict ordered by start then id", () => {
    const candidate = act(0, at("10:00"), 300);
    const c = act(3, at("12:00"), 60), a = act(1, at("11:00"), 60), b = act(2, at("11:00"), 60), far = act(4, at("16:00"), 60);
    const all = [c, b, far, a];
    const result = find(candidate, all, all.map((x) => part(x)));
    expect(result.map((x) => x.activityId)).toEqual([a.id, b.id, c.id]);
    expect(result[0]).toEqual({ activityId: a.id, reason: "overlap", scheduledAt: a.scheduledAt, durationMinutes: 60 });
  });
  it("reports same_start with null duration", () => {
    const a = act(1, at("10:00"));
    expect(find(act(0, at("10:00")), [a], [part(a)])).toEqual([
      { activityId: a.id, reason: "same_start", scheduledAt: a.scheduledAt, durationMinutes: null }]);
  });
  it("ignores not_going, pending and other users", () => {
    const a = act(1, at("10:00"), 60), b = act(2, at("10:00"), 60), c = act(3, at("10:00"), 60);
    expect(find(act(0, at("10:00"), 60), [a, b, c],
      [part(a, "not_going"), part(b, "pending"), part(c, "going", other)])).toEqual([]);
  });
  it("ignores activities without participation", () => {
    expect(find(act(0, at("10:00"), 60), [act(1, at("10:00"), 60)], [])).toEqual([]);
  });
  it("ignores other Trips by activity or participation", () => {
    const a = act(1, at("10:00"), 60, otherTrip), b = act(2, at("10:00"), 60);
    expect(find(act(0, at("10:00"), 60), [a, b], [part(a), part(b, "going", me, otherTrip)])).toEqual([]);
  });
  it("excludes the candidate itself", () => {
    const candidate = act(0, at("10:00"), 60);
    expect(find(candidate, [candidate], [part(candidate)])).toEqual([]);
  });
  it("deduplicates repeated participations", () => {
    const a = act(1, at("10:00"), 60);
    expect(find(act(0, at("10:30"), 60), [a], [part(a), part(a)])).toHaveLength(1);
  });
  it("returns [] without activities and does not mutate inputs", () => {
    expect(find(act(0, at("10:00"), 60), [], [])).toEqual([]);
    const a = act(1, at("10:00"), 60), b = act(2, at("10:30"), 60);
    const activities = [b, a], participations = [part(b), part(a)];
    const snapshot = JSON.stringify([activities, participations]);
    find(act(0, at("10:00"), 60), activities, participations);
    expect(JSON.stringify([activities, participations])).toBe(snapshot);
    expect(activities[0]).toBe(b);
  });
});
