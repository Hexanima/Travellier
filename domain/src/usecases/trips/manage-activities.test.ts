import { beforeEach, describe, expect, it } from "vitest";
import * as domain from "../../index.js";
import type { Activity, ItineraryDay, ObjectId, TripActivityPort, TripActivityScope, TripRole } from "../../index.js";

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
  let role: TripRole | undefined, days: ItineraryDay[], records: Activity[];
  let scope: TripActivityScope, activities: TripActivityPort;
  beforeEach(() => {
    role = "participant"; days = [day]; records = [];
    scope = {
      findMemberRole: async (userId) => domain.ok(userId === actor ? role : undefined),
      findTrip: async () => domain.ok({ id: tripId }),
      listDays: async () => domain.ok(days),
      list: async () => domain.ok(records),
      find: async (activityId) => domain.ok(records.find((r) => r.id === activityId)),
      insert: async (activity) => { records.push(activity); return domain.ok(undefined); },
      replace: async (activity) => { records = records.map((r) => r.id === activity.id ? activity : r); return domain.ok(undefined); },
      remove: async (activityId) => { records = records.filter((r) => r.id !== activityId); return domain.ok(undefined); },
    };
    activities = { withTransaction: async (_, work) => work(scope), withReadSnapshot: async (_, work) => work(scope) };
  });
  const dependencies = () => ({ activities, createId: () => activityId, now: () => createdAt });
  const create = async () => {
    expect(domain.createTripActivity).toBeDefined();
    return domain.createTripActivity.execute(dependencies(), { ...context, ...fields });
  };
  const seed = () => { records = [{ id: activityId, tripId, ...fields, durationMinutes: null, description: "Centro", mapsUrl: "https://maps.app.goo.gl/example",
    createdBy: other, createdAt }]; };

  it.each(["admin", "participant"] as const)("allows %s to create with server metadata and edit another member's activity", async (memberRole) => {
    role = memberRole;
    expect(await create()).toEqual(domain.ok({ id: activityId, tripId, ...fields, durationMinutes: null, description: null, mapsUrl: null,
      createdBy: actor, createdAt }));
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
      .toMatchObject({ ok: true, value: { durationMinutes: 90, scheduledAt: fields.scheduledAt } });
    expect(records[0]).toMatchObject({ durationMinutes: 90 });
    records = [];
    expect(await create()).toMatchObject({ ok: true, value: { durationMinutes: null } });
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
