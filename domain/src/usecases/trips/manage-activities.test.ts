import { beforeEach, describe, expect, it } from "vitest";
import * as domain from "../../index.js";
import type { Activity, ActivityParticipation, ItineraryDay, ObjectId, TripActivityPort, TripActivityScope, TripRole } from "../../index.js";

const id = (n: number): ObjectId => {
  const parsed = domain.createObjectId(n.toString(16).padStart(24, "0"));
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};
const tripId = id(1), actor = id(2), other = id(3), dayId = id(4), activityId = id(5);
const day: ItineraryDay = { id: dayId, tripId, destinationId: id(6), date: new Date("2026-09-25T00:00:00Z"),
  type: "activity", order: 1, startsAt: new Date("2026-09-25T10:00:00.123Z"), endsAt: new Date("2026-09-25T18:00:00.789Z") };
const context = { tripId, authenticatedUserId: actor };
const fields = { dayId, title: "Paseo", scheduledAt: new Date("2026-09-25T12:00:00.456Z") };
const createdAt = new Date("2026-10-04T12:00:00.789Z");

describe("Trip activity use cases", () => {
  let role: TripRole | undefined, days: ItineraryDay[], records: Activity[], participations: ActivityParticipation[], nextId: number;
  let scope: TripActivityScope, activities: TripActivityPort;
  beforeEach(() => {
    role = "participant"; days = [day]; records = []; participations = []; nextId = 100;
    scope = {
      findMemberRole: async (userId) => domain.ok(userId === actor ? role : undefined),
      findTrip: async () => domain.ok({ id: tripId }),
      listDays: async () => domain.ok(days),
      list: async () => domain.ok(records),
      find: async (activityId) => domain.ok(records.find((r) => r.id === activityId)),
      listUserParticipations: async (userId) => domain.ok(participations.filter((p) => p.userId === userId)),
      saveParticipation: async (p) => { participations.push(p); return domain.ok(p); },
      listGoingParticipants: async () => domain.ok([]),
      listGoingParticipationsByUsers: async () => domain.ok([]),
      insert: async (activity) => { records.push(activity); return domain.ok(undefined); },
      replace: async (activity) => { records = records.map((r) => r.id === activity.id ? activity : r); return domain.ok(undefined); },
      remove: async (activityId) => { records = records.filter((r) => r.id !== activityId); return domain.ok(undefined); },
    };
    activities = { withTransaction: async (_, work) => work(scope), withReadSnapshot: async (_, work) => work(scope) };
  });
  const dependencies = () => ({ activities, createId: () => (nextId === 100 ? (nextId++, activityId) : id(nextId++)), now: () => createdAt });
  const create = async () => {
    expect(domain.createTripActivity).toBeDefined();
    return domain.createTripActivity.execute(dependencies(), { ...context, ...fields });
  };
  const seed = () => { records = [{ id: activityId, tripId, ...fields, durationMinutes: null, description: "Centro", mapsUrl: "https://maps.app.goo.gl/example",
    createdBy: other, createdAt }]; };

  it.each(["admin", "participant"] as const)("allows %s to create with server metadata and edit another member's activity", async (memberRole) => {
    role = memberRole;
    const activity = { id: activityId, tripId, ...fields, durationMinutes: null, description: null, mapsUrl: null, createdBy: actor, createdAt };
    expect(await create()).toMatchObject(domain.ok({ outcome: "created", activity }));
    seed();
    expect(await domain.updateTripActivity.execute(dependencies(), { ...context, activityId, title: "Museo" }))
      .toEqual(domain.ok({ activity: { ...records[0], title: "Museo" }, affected: [] }));
    expect(records[0]).toMatchObject({ createdBy: other, createdAt, scheduledAt: fields.scheduledAt });
  });

  it("edits an activity without adding an approval status", async () => {
    seed();
    const result = await domain.updateTripActivity.execute(dependencies(), { ...context, activityId, title: "Museo" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.activity).not.toHaveProperty("status");
  });

  it.each(["createTripActivity", "listTripActivities", "getTripActivity", "updateTripActivity", "deleteTripActivity"] as const)(
    "hides Trip data from a nonmember for %s", async (operation) => {
      role = undefined; seed();
      expect(domain[operation]).toBeDefined();
      const before = structuredClone(records);
      expect(await domain[operation].execute(dependencies(), { ...context, ...fields, activityId }))
        .toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
      expect(records).toEqual(before);
    });

  it.each(["getTripActivity", "updateTripActivity", "deleteTripActivity"] as const)("rejects a missing or foreign activity for %s", async (operation) => {
    seed();
    expect(domain[operation]).toBeDefined();
    expect(await domain[operation].execute(dependencies(), { ...context, activityId: id(99), title: "Otro" }))
      .toMatchObject({ ok: false, error: { tag: "ActivityNotFoundError" } });
    records[0]!.tripId = id(99);
    expect(await domain[operation].execute(dependencies(), { ...context, activityId, title: "Otro" }))
      .toMatchObject({ ok: false, error: { tag: "ActivityNotFoundError" } });
  });

  it("returns a chronological list with deterministic ID ties and an empty list", async () => {
    expect(domain.listTripActivities).toBeDefined();
    expect(await domain.listTripActivities.execute(dependencies(), context)).toEqual(domain.ok([]));
    seed();
    records.push({ ...records[0]!, id: id(8), scheduledAt: new Date("2026-09-25T11:00:00Z") },
      { ...records[0]!, id: id(7) });
    expect(await domain.listTripActivities.execute(dependencies(), context)).toMatchObject({ ok: true, value: [{ id: id(8) }, { id: activityId }, { id: id(7) }] });
    expect(await domain.getTripActivity.execute(dependencies(), { ...context, activityId })).toEqual(domain.ok(records[0]));
  });

  it("clears optional fields without changing identity or author", async () => {
    seed(); expect(domain.updateTripActivity).toBeDefined();
    expect(await domain.updateTripActivity.execute(dependencies(), { ...context, activityId, description: null, mapsUrl: null }))
      .toEqual(domain.ok({ activity: { ...records[0], description: null, mapsUrl: null }, affected: [] }));
  });

  it.each([
    { title: " " }, { scheduledAt: null }, { scheduledAt: undefined }, { scheduledAt: new Date(NaN) },
    { dayId: id(99) }, { scheduledAt: new Date(day.startsAt.getTime() - 1) },
  ])("rejects invalid creation without writing: %s", async (patch) => {
    expect(domain.createTripActivity).toBeDefined();
    expect(await domain.createTripActivity.execute(dependencies(), { ...context, ...fields, ...patch } as never))
      .toMatchObject({ ok: false, error: { tag: "ValidationError" } });
    expect(records).toEqual([]);
  });

  it.each([{ title: " " }, { scheduledAt: null }, { scheduledAt: new Date(NaN) }, { dayId: id(99) },
    { scheduledAt: new Date(day.endsAt!.getTime() + 1) }])("rejects invalid edits and preserves stored data: %s", async (patch) => {
    seed(); expect(domain.updateTripActivity).toBeDefined();
    const before = structuredClone(records);
    expect(await domain.updateTripActivity.execute(dependencies(), { ...context, activityId, ...patch } as never))
      .toMatchObject({ ok: false, error: { tag: "ValidationError" } });
    expect(records).toEqual(before);
  });

  it.each(["transit_out", "transit_return"] as const)("rejects a %s day", async (type) => {
    days = [{ ...day, type }];
    expect(await create()).toMatchObject({ ok: false, error: { tag: "ValidationError" } });
  });

  it("rejects a day belonging to another Trip", async () => {
    days = [{ ...day, tripId: id(99) }];
    expect(await create()).toMatchObject({ ok: false, error: { tag: "ValidationError" } });
  });

  it("moves an activity only when both the new day and instant are valid", async () => {
    seed(); expect(domain.updateTripActivity).toBeDefined();
    const next = { ...day, id: id(9), startsAt: new Date("2026-09-26T10:00:00Z"), endsAt: new Date("2026-09-26T18:00:00Z") };
    days.push(next);
    expect(await domain.updateTripActivity.execute(dependencies(), { ...context, activityId, dayId: next.id }))
      .toMatchObject({ ok: false, error: { tag: "ValidationError" } });
    expect(await domain.updateTripActivity.execute(dependencies(), { ...context, activityId, dayId: next.id, scheduledAt: next.startsAt }))
      .toMatchObject({ ok: true, value: { activity: { dayId: next.id, scheduledAt: next.startsAt } } });
  });

  it("creates with an optional duration and stores null when absent", async () => {
    expect(await domain.createTripActivity.execute(dependencies(), { ...context, ...fields, durationMinutes: 90 }))
      .toMatchObject({ ok: true, value: { outcome: "created", activity: { durationMinutes: 90, scheduledAt: fields.scheduledAt } } });
    expect(records[0]).toMatchObject({ durationMinutes: 90 });
    records = [];
    expect(await create()).toMatchObject({ ok: true, value: { activity: { durationMinutes: null } } });
  });

  it("edits only the duration and clears it with null", async () => {
    seed();
    expect(await domain.updateTripActivity.execute(dependencies(), { ...context, activityId, durationMinutes: 45 }))
      .toEqual(domain.ok({ activity: { ...records[0], durationMinutes: 45 }, affected: [] }));
    expect(records[0]).toMatchObject({ durationMinutes: 45 });
    expect(await domain.updateTripActivity.execute(dependencies(), { ...context, activityId, durationMinutes: null }))
      .toMatchObject({ ok: true, value: { activity: { durationMinutes: null } } });
    expect(records[0]).toMatchObject({ durationMinutes: null });
  });

  it("preserves start milliseconds and duration when editing only content", async () => {
    seed(); records[0] = { ...records[0]!, durationMinutes: 30 };
    expect(await domain.updateTripActivity.execute(dependencies(), { ...context, activityId, title: "Museo" }))
      .toMatchObject({ ok: true, value: { activity: { title: "Museo", durationMinutes: 30, scheduledAt: new Date("2026-09-25T12:00:00.456Z") } } });
    expect(records[0]!.scheduledAt.toISOString()).toBe("2026-09-25T12:00:00.456Z");
  });

  it.each([
    { durationMinutes: 400 }, { durationMinutes: 0 }, { durationMinutes: 2.5 },
    { scheduledAt: new Date("2026-09-25T17:45:00Z"), durationMinutes: 30 },
  ])("rejects an edit whose end exceeds the destination window without replacing: %s", async (patch) => {
    seed(); records[0] = { ...records[0]!, durationMinutes: 30 };
    let replaced = false;
    scope.replace = async () => { replaced = true; return domain.ok(undefined); };
    expect(await domain.updateTripActivity.execute(dependencies(), { ...context, activityId, ...patch }))
      .toMatchObject({ ok: false, error: { tag: "ValidationError", issues: [{ field: "durationMinutes" }] } });
    expect(replaced).toBe(false);
  });

  it("rejects moving the start so that the stored duration exceeds the window", async () => {
    seed(); records[0] = { ...records[0]!, durationMinutes: 60 };
    const before = structuredClone(records);
    expect(await domain.updateTripActivity.execute(dependencies(), { ...context, activityId,
      scheduledAt: new Date("2026-09-25T17:30:00Z") }))
      .toMatchObject({ ok: false, error: { tag: "ValidationError", issues: [{ field: "durationMinutes", code: "outside_window" }] } });
    expect(records).toEqual(before);
  });

  it.each(["admin", "participant"] as const)("allows %s to delete another member's activity", async (memberRole) => {
    role = memberRole; seed(); expect(domain.deleteTripActivity).toBeDefined();
    expect(await domain.deleteTripActivity.execute(dependencies(), { ...context, activityId })).toEqual(domain.ok(undefined));
    expect(records).toEqual([]);
  });

  it("propagates persistence errors without claiming success", async () => {
    expect(domain.createTripActivity).toBeDefined();
    const failure = domain.err(new domain.UnknownError("unavailable"));
    scope.insert = async () => failure;
    expect(await create()).toEqual(failure);
    scope.findMemberRole = async () => failure;
    expect(await domain.listTripActivities.execute(dependencies(), context)).toEqual(failure);
  });
});

describe("createTripActivity author participation (T52)", () => {
  const first = id(30), second = id(31), mine = new Date("2026-09-25T12:00:00.456Z");
  const wide = { ...day, endsAt: new Date("2026-09-25T20:00:00Z") };
  let recordsLocal: Activity[], parts: ActivityParticipation[], log: string[], failOn: string | undefined, ids: number;
  const act = (n: ObjectId, at: string, durationMinutes: number | null): Activity => ({ id: n, tripId, dayId, title: "Plan", description: null,
    scheduledAt: new Date(at), durationMinutes, mapsUrl: null, createdBy: other, createdAt });
  const part = (activityId: ObjectId, userId: ObjectId, status: ActivityParticipation["status"]): ActivityParticipation =>
    ({ id: id(60 + parts.length), tripId, activityId, userId, status, updatedAt: createdAt });
  const port = (): TripActivityPort => {
    const scope: TripActivityScope = {
      findMemberRole: async () => domain.ok("participant"), findTrip: async () => domain.ok({ id: tripId }),
      listDays: async () => domain.ok([wide]), list: async () => domain.ok(recordsLocal),
      find: async (a) => domain.ok(recordsLocal.find((r) => r.id === a)),
      listUserParticipations: async (u) => domain.ok(parts.filter((p) => p.userId === u)),
      saveParticipation: async (p) => {
        if (failOn === "save") return domain.err(new domain.UnknownError("save"));
        log.push(`save:${p.activityId}:${p.status}`);
        parts = [...parts.filter((r) => !(r.activityId === p.activityId && r.userId === p.userId)), p];
        return domain.ok(p);
      },
      listGoingParticipants: async () => domain.ok([]), listGoingParticipationsByUsers: async () => domain.ok([]),
      insert: async (a) => {
        if (failOn === "insert") return domain.err(new domain.UnknownError("insert"));
        log.push(`insert:${a.id}`); recordsLocal.push(a); return domain.ok(undefined);
      },
      replace: async () => domain.ok(undefined), remove: async () => domain.ok(undefined),
    };
    return { withReadSnapshot: async (_, w) => w(scope), withTransaction: async (_, w) => {
      const saved = { r: [...recordsLocal], p: [...parts] };
      const result = await w(scope);
      if (!result.ok) { recordsLocal = saved.r; parts = saved.p; }
      return result;
    } };
  };
  const run = (extra: Record<string, unknown> = {}, durationMinutes: number | null = 60) => domain.createTripActivity.execute(
    { activities: port(), createId: () => id(ids++), now: () => createdAt },
    { ...context, dayId, title: "Mio", scheduledAt: mine, durationMinutes, ...extra } as never);
  beforeEach(() => {
    recordsLocal = [act(first, "2026-09-25T11:30:00Z", 60), act(second, "2026-09-25T12:30:00Z", 30), act(id(32), "2026-09-25T16:00:00Z", 30)];
    parts = []; log = []; failOn = undefined; ids = 200;
    parts = [part(first, actor, "going"), part(second, actor, "going"), part(id(32), actor, "going"), part(first, other, "going")];
  });
  const snapshot = () => [first, second].map((a) => { const r = recordsLocal.find((x) => x.id === a)!;
    return { activityId: a, scheduledAt: r.scheduledAt.toISOString(), durationMinutes: r.durationMinutes }; });
  const chosen = { scheduledAt: mine.toISOString(), durationMinutes: 60 };

  it("inserts the activity and the author's going without records for other members", async () => {
    parts = []; recordsLocal = [];
    const result = await run();
    expect(result).toMatchObject({ ok: true, value: { outcome: "created", participation: { activityId: id(200), userId: actor, status: "going" } } });
    expect(log).toEqual([`insert:${id(200)}`, `save:${id(200)}:going`]);
    expect(parts.filter((p) => p.userId !== actor)).toEqual([]);
  });

  it("asks for confirmation listing every incompatible plan without writing", async () => {
    const result = await run();
    expect(result).toMatchObject({ ok: true, value: { outcome: "confirmation_required",
      conflicts: [{ activityId: first }, { activityId: second }], activity: { scheduledAt: mine, durationMinutes: 60 } } });
    expect(log).toEqual([]); expect(recordsLocal).toHaveLength(3);
  });

  it("applies a matching confirmation: not_going in the previous plans and going in the new one", async () => {
    const result = await run({ confirmedConflicts: snapshot(), confirmedActivity: chosen });
    expect(result).toMatchObject({ ok: true, value: { outcome: "created" } });
    expect(log).toEqual([`insert:${id(200)}`, `save:${first}:not_going`, `save:${second}:not_going`, `save:${id(200)}:going`]);
    expect(parts.find((p) => p.activityId === id(32))?.status).toBe("going");
    expect(parts.find((p) => p.activityId === first && p.userId === other)?.status).toBe("going");
  });

  it("asks again, without writing, when the conflict set changed or the chosen schedule differs", async () => {
    const stale = snapshot().slice(0, 1);
    expect(await run({ confirmedConflicts: stale, confirmedActivity: chosen })).toMatchObject({ ok: true, value: { outcome: "confirmation_required" } });
    expect(await run({ confirmedConflicts: snapshot(), confirmedActivity: { ...chosen, durationMinutes: 45 } }))
      .toMatchObject({ ok: true, value: { outcome: "confirmation_required" } });
    expect(await run({ confirmedConflicts: snapshot() })).toMatchObject({ ok: true, value: { outcome: "confirmation_required" } });
    expect(log).toEqual([]);
  });

  it("rejects malformed confirmations", async () => {
    expect(await run({ confirmedConflicts: "x", confirmedActivity: chosen })).toMatchObject({ ok: false, error: { tag: "ValidationError" } });
    expect(await run({ confirmedConflicts: snapshot(), confirmedActivity: "x" })).toMatchObject({ ok: false, error: { tag: "ValidationError" } });
    expect(log).toEqual([]);
  });

  it.each(["insert", "save"])("aborts everything when %s fails", async (step) => {
    failOn = step;
    const before = structuredClone(parts);
    expect(await run({ confirmedConflicts: snapshot(), confirmedActivity: chosen })).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
    expect(recordsLocal).toHaveLength(3); expect(parts).toEqual(before);
  });

  it("does not ask for confirmation nor write when the activity itself is invalid", async () => {
    expect(await run({}, 600)).toMatchObject({ ok: false, error: { tag: "ValidationError", issues: [{ field: "durationMinutes" }] } });
    expect(log).toEqual([]);
  });

  it("ignores not_going and pending plans", async () => {
    parts = [part(first, actor, "not_going"), part(second, actor, "pending")];
    expect(await run()).toMatchObject({ ok: true, value: { outcome: "created" } });
  });
});

describe("updateTripActivity decisionRequired (T53)", () => {
  const edited = id(40), planA = id(41), planB = id(42), u1 = id(50), u2 = id(51), u3 = id(52);
  const wide = { ...day, startsAt: new Date("2026-09-25T08:00:00Z"), endsAt: new Date("2026-09-25T20:00:00Z") };
  const now = new Date("2026-11-08T15:00:00.321Z");
  let partSeq = 0;
  let acts: Activity[], parts: ActivityParticipation[], members: Set<ObjectId>, writes: string[], reads: string[], failAt: number | undefined, replaced: Activity[];
  const act = (n: ObjectId, at: string, durationMinutes: number | null): Activity => ({ id: n, tripId, dayId, title: "Plan", description: null,
    scheduledAt: new Date(at), durationMinutes, mapsUrl: null, createdBy: other, createdAt });
  const part = (activityId: ObjectId, userId: ObjectId, status: ActivityParticipation["status"], decisionRequired?: ActivityParticipation["decisionRequired"]): ActivityParticipation =>
    ({ id: id(300 + partSeq++), tripId, activityId, userId, status, updatedAt: createdAt, ...(decisionRequired ? { decisionRequired } : {}) });
  const port = (): TripActivityPort => {
    const scope: TripActivityScope = {
      findMemberRole: async () => domain.ok("participant"), findTrip: async () => domain.ok({ id: tripId }),
      listDays: async () => domain.ok([wide]), list: async () => domain.ok(acts),
      find: async (a) => domain.ok(acts.find((r) => r.id === a)),
      listUserParticipations: async (u) => { reads.push("user"); return domain.ok(parts.filter((p) => p.userId === u)); },
      listGoingParticipants: async (a) => { reads.push("going"); return domain.ok(parts.filter((p) => p.activityId === a && p.status === "going" && members.has(p.userId))); },
      listGoingParticipationsByUsers: async (users) => { reads.push("batch"); return domain.ok(parts.filter((p) => p.status === "going" && users.includes(p.userId))); },
      saveParticipation: async (p) => {
        if (failAt !== undefined && writes.length >= failAt) return domain.err(new domain.UnknownError("save"));
        writes.push(`${p.activityId}:${p.userId}`);
        parts = [...parts.filter((r) => !(r.activityId === p.activityId && r.userId === p.userId)), p];
        return domain.ok(p);
      },
      insert: async () => domain.ok(undefined),
      replace: async (a) => { replaced.push(a); acts = acts.map((r) => r.id === a.id ? a : r); return domain.ok(undefined); },
      remove: async () => domain.ok(undefined),
    };
    return { withReadSnapshot: async (_, w) => w(scope), withTransaction: async (_, w) => {
      const saved = { a: [...acts], p: [...parts] };
      const result = await w(scope);
      if (!result.ok) { acts = saved.a; parts = saved.p; }
      return result;
    } };
  };
  const edit = (patch: Record<string, unknown>) => domain.updateTripActivity.execute({ activities: port(), now: () => now },
    { ...context, activityId: edited, ...patch } as never);
  const at = (hhmm: string) => new Date(`2026-09-25T${hhmm}:00Z`);
  beforeEach(() => {
    // edited: 10:00-11:00. planA 12:00-13:00 (user's other plan), planB 14:00 without duration.
    acts = [act(edited, "2026-09-25T10:00:00Z", 60), act(planA, "2026-09-25T12:00:00Z", 60), act(planB, "2026-09-25T14:00:00Z", null)];
    members = new Set([actor, u1, u2, u3]); writes = []; reads = []; failAt = undefined; replaced = [];
    parts = [part(edited, u1, "going"), part(planA, u1, "going"), part(edited, u2, "going")];
  });
  const stored = (a: ObjectId, u: ObjectId) => parts.find((p) => p.activityId === a && p.userId === u);

  it("moves a conflicted going to pending with scheduledAt marker and one UTC instant", async () => {
    const result = await edit({ scheduledAt: at("12:30") });
    expect(stored(edited, u1)).toMatchObject({ status: "pending", decisionRequired: { reason: "schedule_conflict", changedFields: ["scheduledAt"], changedAt: now } });
    expect(result).toMatchObject({ ok: true, value: { affected: [{ userId: u1, status: "pending" }] } });
  });
  it("marks only durationMinutes when only the duration changes", async () => {
    await edit({ durationMinutes: 150 });
    expect(stored(edited, u1)!.decisionRequired).toMatchObject({ changedFields: ["durationMinutes"] });
  });
  it("marks both fields in canonical order", async () => {
    await edit({ durationMinutes: 150, scheduledAt: at("11:00") });
    expect(stored(edited, u1)!.decisionRequired).toMatchObject({ changedFields: ["scheduledAt", "durationMinutes"] });
  });
  it("does not write compatible going participants", async () => {
    const result = await edit({ scheduledAt: at("09:00") });
    expect(writes).toEqual([]);
    expect(stored(edited, u1)).toMatchObject({ status: "going", updatedAt: createdAt });
    expect(result).toMatchObject({ ok: true, value: { affected: [] } });
  });
  it("marks the editor/creator when going with a conflict, without confirmation", async () => {
    parts.push(part(edited, actor, "going"), part(planA, actor, "going"));
    const result = await edit({ scheduledAt: at("12:30") });
    expect(result).toMatchObject({ ok: true, value: { activity: { id: edited } } });
    expect(stored(edited, actor)).toMatchObject({ status: "pending", decisionRequired: { changedFields: ["scheduledAt"] } });
  });
  it("writes only the (edited, user) pair and never other plans", async () => {
    const before = structuredClone(stored(planA, u1));
    await edit({ scheduledAt: at("12:30") });
    expect(writes).toEqual([`${edited}:${u1}`]);
    expect(stored(planA, u1)).toEqual(before);
  });
  it("leaves previous markers, not_going and users without a record untouched", async () => {
    const prev = { reason: "schedule_conflict" as const, changedFields: ["durationMinutes" as const], changedAt: new Date("2026-11-01T00:00:00Z") };
    parts = [part(edited, u1, "pending", prev), part(planA, u1, "going"), part(edited, u2, "not_going"), part(planA, u2, "going"), part(planA, u3, "going")];
    await edit({ scheduledAt: at("12:30") });
    expect(writes).toEqual([]);
    expect(stored(edited, u1)!.decisionRequired).toEqual(prev);
    expect(stored(edited, u2)!.status).toBe("not_going");
    expect(stored(edited, u3)).toBeUndefined();
  });
  it.each([{ title: "Nuevo" }, { description: "x" }, { mapsUrl: "https://maps.app.goo.gl/x" }, { dayId },
    { scheduledAt: at("10:00") }, { durationMinutes: 60 }, { durationMinutes: 60, scheduledAt: at("10:00") }])(
    "does not read or write participations for %j", async (patch) => {
      const result = await edit(patch);
      expect(result).toMatchObject({ ok: true, value: { affected: [] } });
      expect(reads).toEqual([]); expect(writes).toEqual([]);
    });
  it("treats an undefined stored duration as null for comparison", async () => {
    acts[0] = { ...acts[0]!, durationMinutes: undefined as never };
    await edit({ durationMinutes: null });
    expect(reads).toEqual([]);
  });
  it("does not evaluate or mark former members with going", async () => {
    members.delete(u1);
    await edit({ scheduledAt: at("12:30") });
    expect(stored(edited, u1)).toMatchObject({ status: "going" });
    expect(writes).toEqual([]);
  });
  it("treats contiguous activities as compatible", async () => {
    await edit({ scheduledAt: at("11:00") });
    expect(writes).toEqual([]);
  });
  it("without duration only an identical start conflicts", async () => {
    acts[0] = { ...acts[0]!, durationMinutes: null }; acts[1] = { ...acts[1]!, durationMinutes: null };
    await edit({ scheduledAt: at("12:01") });
    expect(writes).toEqual([]);
    await edit({ scheduledAt: at("12:00") });
    expect(stored(edited, u1)).toMatchObject({ status: "pending", decisionRequired: { changedFields: ["scheduledAt"] } });
  });
  it("fails on a later write without reporting affected and rolls back", async () => {
    parts = [part(edited, u1, "going"), part(planA, u1, "going"), part(edited, u3, "going"), part(planA, u3, "going")];
    const before = structuredClone(parts);
    failAt = 1;
    const result = await edit({ scheduledAt: at("12:30") });
    expect(result).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
    expect(result).not.toHaveProperty("value");
    expect(parts).toEqual(before);
    expect(acts[0]!.scheduledAt).toEqual(at("10:00"));
  });
  it("does not write anything when validation fails", async () => {
    const result = await edit({ durationMinutes: 800 });
    expect(result).toMatchObject({ ok: false, error: { tag: "ValidationError" } });
    expect(replaced).toEqual([]); expect(writes).toEqual([]); expect(reads).toEqual([]);
  });
  it("lists exactly the marked records in affected", async () => {
    parts = [part(edited, u1, "going"), part(planA, u1, "going"), part(edited, u2, "going"), part(edited, u3, "going"), part(planB, u3, "going")];
    const result = await edit({ scheduledAt: at("12:30") });
    if (!result.ok) throw result.error;
    expect(result.value.affected.map((p) => p.userId)).toEqual([u1]);
    expect(result.value.affected[0]).toEqual(stored(edited, u1));
  });
});
