import { beforeEach, describe, expect, it } from "vitest";
import * as domain from "../../index.js";
import type { ActivityParticipation, ObjectId, TripParticipationPort, TripParticipationScope, TripRole } from "../../index.js";

const id = (n: number): ObjectId => {
  const result = domain.createObjectId(n.toString(16).padStart(24, "0"));
  if (!result.ok) throw result.error;
  return result.value;
};
const tripId = id(1), actor = id(2), other = id(3), activityId = id(4), earlier = id(5), later = id(6), foreign = id(7);
const context = { tripId, activityId, authenticatedUserId: actor };
const initialTime = new Date("2026-10-04T12:00:00.123Z");
const at = (hour: number, minute = 0) => new Date(Date.UTC(2026, 10, 10, hour, minute));
interface Planned { id: ObjectId; scheduledAt: Date; durationMinutes: number | null }

describe("individual activity participation use cases", () => {
  let role: TripRole | undefined, tripExists: boolean, activityTripId: ObjectId | undefined;
  let records: ActivityParticipation[], scope: TripParticipationScope, participations: TripParticipationPort;
  let plan: Planned[];
  let time: Date, nextId: number, saves: number;
  beforeEach(() => {
    role = "participant"; tripExists = true; activityTripId = tripId; records = []; time = initialTime; nextId = 10; saves = 0;
    plan = [{ id: activityId, scheduledAt: at(10), durationMinutes: 60 }];
    scope = {
      findMemberRole: async (userId) => domain.ok(userId === actor || userId === other ? role : undefined),
      findTrip: async () => domain.ok(tripExists ? { id: tripId } : undefined),
      findActivity: async (value) => {
        const found = plan.find((p) => p.id === value);
        return domain.ok(found && activityTripId ? { id: found.id, tripId: value === activityId ? activityTripId : tripId,
          scheduledAt: found.scheduledAt, durationMinutes: found.durationMinutes } : undefined);
      },
      listActivities: async () => domain.ok(plan.map((p) => ({ id: p.id, tripId, scheduledAt: p.scheduledAt, durationMinutes: p.durationMinutes }))),
      listUserParticipations: async (userId) => domain.ok(records.filter((r) => r.tripId === tripId && r.userId === userId)),
      findParticipation: async (value, userId) => domain.ok(records.find((r) => r.tripId === tripId && r.activityId === value && r.userId === userId)),
      save: async (record) => {
        saves += 1;
        records = records.filter((r) => r.activityId !== record.activityId || r.userId !== record.userId);
        const stored = record.status === "pending" ? record : { ...record, decisionRequired: null };
        records.push(stored); return domain.ok(stored);
      },
    };
    // Real adapters roll back on any failure; emulate it by restoring the previous records.
    participations = {
      withTransaction: async (_, work) => {
        const backup = structuredClone(records), result = await work(scope);
        if (!result.ok) records = backup;
        return result;
      },
      withReadSnapshot: async (_, work) => work(scope),
    };
  });
  const dependencies = () => ({ participations, createId: () => id(nextId++), now: () => time });
  const request = (status: unknown, extra: Record<string, unknown> = {}, authenticatedUserId = actor) => {
    expect(domain.setTripActivityParticipation).toBeDefined();
    return domain.setTripActivityParticipation.execute(dependencies(), { ...context, authenticatedUserId, status, ...extra });
  };
  const set = async (status: unknown, authenticatedUserId = actor): Promise<domain.Result<ActivityParticipation, domain.TaggedError>> => {
    const result = await request(status, {}, authenticatedUserId);
    if (!result.ok) return result;
    return result.value.outcome === "saved" ? domain.ok(result.value.participation) : domain.err(new domain.UnknownError("confirmation_required"));
  };
  const get = () => {
    expect(domain.getTripActivityParticipation).toBeDefined();
    return domain.getTripActivityParticipation.execute(dependencies(), context);
  };
  const seed = (activity: ObjectId, status: ActivityParticipation["status"], userId = actor, decisionRequired?: unknown) => {
    records.push({ id: id(nextId++), tripId, activityId: activity, userId, status, updatedAt: initialTime,
      ...(decisionRequired === undefined ? {} : { decisionRequired }) } as ActivityParticipation);
  };
  const overlapping = () => { plan.push({ id: earlier, scheduledAt: at(9, 30), durationMinutes: 60 },
    { id: later, scheduledAt: at(10, 30), durationMinutes: 30 }); seed(earlier, "going"); seed(later, "going"); };
  const snapshotOf = (c: { activityId: ObjectId; scheduledAt: Date; durationMinutes: number | null }[]) =>
    c.map((x) => ({ activityId: x.activityId, scheduledAt: x.scheduledAt.getTime(), durationMinutes: x.durationMinutes }));
  const confirmation = (value: { conflicts: { activityId: ObjectId; scheduledAt: Date; durationMinutes: number | null }[];
    activity: { scheduledAt: Date; durationMinutes: number | null } }) => ({ confirmedConflicts: snapshotOf(value.conflicts),
    confirmedActivity: { scheduledAt: value.activity.scheduledAt.getTime(), durationMinutes: value.activity.durationMinutes } });
  const asked = async () => {
    const result = await request("going");
    if (!result.ok || result.value.outcome !== "confirmation_required") throw new Error("expected confirmation_required");
    return result.value;
  };

  it.each(["admin", "participant"] as const)("lets %s register going and not_going", async (value) => {
    role = value;
    for (const status of ["going", "not_going"]) {
      expect(await set(status)).toMatchObject({ ok: true, value: { tripId, activityId, userId: actor, status, updatedAt: time } });
      expect(records).toHaveLength(1);
    }
  });
  it("preserves identity while replacing the own status and timestamp", async () => {
    const first = await set("going");
    if (!first.ok) throw first.error;
    time = new Date(initialTime.getTime() + 1000);
    const changed = await set("not_going");
    expect(changed).toMatchObject({ ok: true, value: { id: first.value.id, status: "not_going", updatedAt: time } });
    expect(await get()).toEqual(changed);
    expect(await set("not_going")).toMatchObject({ ok: true, value: { status: "not_going" } });
    expect(records).toHaveLength(1);
  });
  it("does not modify another member's participation", async () => {
    await set("going", other);
    const before = structuredClone(records[0]);
    await set("going"); await set("not_going"); await set("pending");
    expect(records).toHaveLength(2);
    expect(records.find((r) => r.userId === other)).toEqual(before);
  });
  it("returns null before a response without registering pending implicitly", async () => {
    expect(await get()).toEqual(domain.ok(null));
    expect(records).toEqual([]);
  });
  it.each(["pending", undefined, null, "", "confirmed", "GOING", 123])("rejects manual or invalid status %s without writes", async (status) => {
    seed(activityId, "going"); seed(activityId, "pending", other, { reason: "schedule_conflict" });
    const before = structuredClone(records);
    expect(await set(status)).toMatchObject({ ok: false, error: { tag: "ValidationError", issues: [{ field: "status" }] } });
    expect(records).toEqual(before); expect(saves).toBe(0);
  });
  it("keeps a pending participation and its decisionRequired mark when pending is rejected", async () => {
    const mark = { reason: "schedule_conflict", changedFields: ["scheduledAt"], changedAt: initialTime };
    seed(activityId, "pending", actor, mark);
    const before = structuredClone(records);
    expect(await set("pending")).toMatchObject({ ok: false, error: { tag: "ValidationError" } });
    expect(records).toEqual(before); expect(saves).toBe(0);
    expect(await get()).toMatchObject({ ok: true, value: { status: "pending", decisionRequired: mark } });
  });
  it.each(["going", "not_going"])("clears decisionRequired when %s is saved explicitly", async (status) => {
    seed(activityId, "pending", actor, { reason: "schedule_conflict", changedFields: ["durationMinutes"], changedAt: initialTime });
    expect(await set(status)).toMatchObject({ ok: true, value: { status, decisionRequired: null } });
    expect(records[0]).toMatchObject({ status, decisionRequired: null });
  });
  it("rejects an invalid server timestamp without writes", async () => {
    time = new Date(NaN);
    expect(await set("going")).toMatchObject({ ok: false, error: { tag: "ValidationError" } });
    expect(records).toEqual([]);
  });
  it.each(["nonmember", "missingTrip", "missingActivity", "foreignActivity"])("rejects %s for both reads and writes", async (condition) => {
    if (condition === "nonmember") role = undefined;
    if (condition === "missingTrip") tripExists = false;
    if (condition === "missingActivity") activityTripId = undefined;
    if (condition === "foreignActivity") activityTripId = id(99);
    const tag = condition === "nonmember" || condition === "missingTrip" ? "TripNotFoundError" : "ActivityNotFoundError";
    expect(await set("going")).toMatchObject({ ok: false, error: { tag } });
    expect(await get()).toMatchObject({ ok: false, error: { tag } });
    expect(records).toEqual([]);
  });
  it.each(["findMemberRole", "findTrip", "findActivity", "findParticipation", "listActivities", "listUserParticipations", "save"] as const)(
    "propagates %s persistence failures", async (method) => {
      const failure = domain.err(new domain.UnknownError("Unavailable"));
      scope[method] = async () => failure;
      expect(await set("going")).toEqual(failure);
      if (method !== "save" && method !== "listActivities" && method !== "listUserParticipations") expect(await get()).toEqual(failure);
      expect(records).toEqual([]);
    });

  describe("schedule conflicts", () => {
    it("saves going without confirmation when the agenda has no conflict", async () => {
      plan.push({ id: earlier, scheduledAt: at(9), durationMinutes: 60 }); seed(earlier, "going");
      expect(await request("going")).toMatchObject({ ok: true, value: { outcome: "saved", participation: { status: "going" } } });
      expect(records.find((r) => r.activityId === earlier)?.status).toBe("going");
    });
    it("returns every incompatible activity with its schedule and writes nothing", async () => {
      overlapping();
      const before = structuredClone(records);
      const value = await asked();
      expect(value.conflicts.map((c) => c.activityId)).toEqual([earlier, later]);
      expect(value.conflicts[0]).toMatchObject({ reason: "overlap", scheduledAt: at(9, 30), durationMinutes: 60 });
      expect(value.activity).toEqual({ scheduledAt: at(10), durationMinutes: 60 });
      expect(records).toEqual(before); expect(saves).toBe(0);
    });
    it("on confirmation saves not_going on previous incompatibles and going on the chosen one together", async () => {
      overlapping(); plan.push({ id: foreign, scheduledAt: at(15), durationMinutes: 60 }); seed(foreign, "going");
      seed(earlier, "going", other); seed(activityId, "going", other);
      const value = await asked();
      const others = structuredClone(records.filter((r) => r.userId === other || r.activityId === foreign));
      const result = await request("going", { ...confirmation(value), confirmedConflicts: snapshotOf(value.conflicts).reverse() });
      expect(result).toMatchObject({ ok: true, value: { outcome: "saved", participation: { activityId, status: "going" } } });
      const mine = (activity: ObjectId) => records.find((r) => r.userId === actor && r.activityId === activity)?.status;
      expect(mine(earlier)).toBe("not_going"); expect(mine(later)).toBe("not_going"); expect(mine(activityId)).toBe("going");
      expect(mine(foreign)).toBe("going");
      expect(records.filter((r) => r.userId === other || r.activityId === foreign)).toEqual(others);
    });
    it.each(["duration changed", "start changed", "conflict added", "conflict removed"])("asks again without writes if the snapshot changed (%s)", async (change) => {
      overlapping();
      const confirmed = confirmation(await asked());
      if (change === "duration changed") plan.find((p) => p.id === earlier)!.durationMinutes = 45;
      if (change === "start changed") plan.find((p) => p.id === activityId)!.scheduledAt = at(10, 15);
      if (change === "conflict added") { plan.push({ id: foreign, scheduledAt: at(10, 10), durationMinutes: 5 }); seed(foreign, "going"); }
      if (change === "conflict removed") records = records.filter((r) => r.activityId !== later);
      const before = structuredClone(records);
      const result = await request("going", confirmed);
      expect(result).toMatchObject({ ok: true, value: { outcome: "confirmation_required" } });
      expect(records).toEqual(before); expect(saves).toBe(0);
    });
    it("asks again when the chosen activity changed even if the conflicts match", async () => {
      plan.push({ id: earlier, scheduledAt: at(10, 30), durationMinutes: 60 }); seed(earlier, "going");
      const confirmed = confirmation(await asked());
      plan.find((p) => p.id === activityId)!.durationMinutes = 90;
      const result = await request("going", confirmed);
      expect(result).toMatchObject({ ok: true, value: { outcome: "confirmation_required", activity: { durationMinutes: 90 } } });
      expect(saves).toBe(0);
    });
    it("persists nothing if the second write fails after the first", async () => {
      overlapping();
      const confirmed = confirmation(await asked());
      const before = structuredClone(records), original = scope.save;
      let calls = 0;
      scope.save = async (record) => ++calls > 1 ? domain.err(new domain.UnknownError("Unavailable")) : original(record);
      expect(await request("going", confirmed)).toMatchObject({ ok: false });
      expect(records).toEqual(before);
    });
    it("treats contiguous activities as compatible and an unknown duration as same-start only", async () => {
      plan.push({ id: earlier, scheduledAt: at(9), durationMinutes: 60 }, { id: later, scheduledAt: at(11), durationMinutes: 60 });
      seed(earlier, "going"); seed(later, "going");
      expect(await request("going")).toMatchObject({ ok: true, value: { outcome: "saved" } });
      records = []; plan = [{ id: activityId, scheduledAt: at(10), durationMinutes: null },
        { id: earlier, scheduledAt: at(9, 30), durationMinutes: 120 }, { id: later, scheduledAt: at(10), durationMinutes: null }];
      seed(earlier, "going");
      expect(await request("going")).toMatchObject({ ok: true, value: { outcome: "saved" } });
      seed(later, "going");
      expect(await request("going")).toMatchObject({ ok: true, value: { outcome: "confirmation_required",
        conflicts: [{ activityId: later, reason: "same_start" }] } });
    });
    it.each([-1, 0, 1])("allows responses before, during and after the activity (offset %s days)", async (days) => {
      plan[0]!.scheduledAt = new Date(initialTime.getTime() + days * 86_400_000);
      expect(await request("going")).toMatchObject({ ok: true, value: { outcome: "saved" } });
      expect(await request("not_going")).toMatchObject({ ok: true, value: { outcome: "saved" } });
    });
    it("is idempotent for going on an activity already going without other conflicts", async () => {
      seed(activityId, "going");
      expect(await request("going")).toMatchObject({ ok: true, value: { outcome: "saved", participation: { id: records[0]!.id } } });
      expect(records).toHaveLength(1);
    });
    it("never lets one member change another member's attendance", async () => {
      overlapping(); seed(activityId, "going", other); seed(earlier, "going", other);
      const before = structuredClone(records.filter((r) => r.userId === other));
      expect(await request("going", {}, other)).toMatchObject({ ok: true, value: { outcome: "confirmation_required" } });
      expect(await request("not_going", { userId: actor }, other)).toMatchObject({ ok: true });
      expect(records.filter((r) => r.userId === actor).map((r) => r.status)).toEqual(["going", "going"]);
      expect(records.find((r) => r.userId === other && r.activityId === activityId)?.status).toBe("not_going");
      expect(records.find((r) => r.userId === other && r.activityId === earlier)).toEqual(before.find((r) => r.activityId === earlier));
    });
    it.each([{}, { confirmedConflicts: "x" }, { confirmedConflicts: [{ activityId: "z" }] }, { confirmedConflicts: [null] }])(
      "treats malformed confirmation %j as unconfirmed or invalid without writes", async (extra) => {
        overlapping();
        const result = await request("going", extra);
        const rejected = !result.ok && result.error.tag === "ValidationError";
        expect(rejected || (result.ok && result.value.outcome === "confirmation_required")).toBe(true);
        expect(saves).toBe(0);
      });
  });
});
