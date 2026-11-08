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
      .toEqual(domain.ok({ ...records[0], title: "Museo" }));
    expect(records[0]).toMatchObject({ createdBy: other, createdAt, scheduledAt: fields.scheduledAt });
  });

  it("edits an activity without adding an approval status", async () => {
    seed();
    const result = await domain.updateTripActivity.execute(dependencies(), { ...context, activityId, title: "Museo" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).not.toHaveProperty("status");
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
      .toEqual(domain.ok({ ...records[0], description: null, mapsUrl: null }));
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

  it.each(["transit_out", "arrival", "transit_return"] as const)("rejects a %s day", async (type) => {
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
      .toMatchObject({ ok: true, value: { dayId: next.id, scheduledAt: next.startsAt } });
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
      .toEqual(domain.ok({ ...records[0], durationMinutes: 45 }));
    expect(records[0]).toMatchObject({ durationMinutes: 45 });
    expect(await domain.updateTripActivity.execute(dependencies(), { ...context, activityId, durationMinutes: null }))
      .toMatchObject({ ok: true, value: { durationMinutes: null } });
    expect(records[0]).toMatchObject({ durationMinutes: null });
  });

  it("preserves start milliseconds and duration when editing only content", async () => {
    seed(); records[0] = { ...records[0]!, durationMinutes: 30 };
    expect(await domain.updateTripActivity.execute(dependencies(), { ...context, activityId, title: "Museo" }))
      .toMatchObject({ ok: true, value: { title: "Museo", durationMinutes: 30, scheduledAt: new Date("2026-09-25T12:00:00.456Z") } });
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
