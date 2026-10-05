import { beforeEach, describe, expect, it } from "vitest";
import * as domain from "../../index.js";
import type { ActivityParticipation, ObjectId, TripParticipationPort, TripParticipationScope, TripRole } from "../../index.js";

const id = (n: number): ObjectId => {
  const result = domain.createObjectId(n.toString(16).padStart(24, "0"));
  if (!result.ok) throw result.error;
  return result.value;
};
const tripId = id(1), actor = id(2), other = id(3), activityId = id(4);
const context = { tripId, activityId, authenticatedUserId: actor };
const initialTime = new Date("2026-10-04T12:00:00.123Z");

describe("individual activity participation use cases", () => {
  let role: TripRole | undefined, tripExists: boolean, activityTripId: ObjectId | undefined;
  let records: ActivityParticipation[], scope: TripParticipationScope, participations: TripParticipationPort;
  let time: Date, nextId: number;
  beforeEach(() => {
    role = "participant"; tripExists = true; activityTripId = tripId; records = []; time = initialTime; nextId = 10;
    scope = {
      findMemberRole: async (userId) => domain.ok(userId === actor || userId === other ? role : undefined),
      findTrip: async () => domain.ok(tripExists ? { id: tripId } : undefined),
      findActivity: async (value) => domain.ok(value === activityId && activityTripId ? { id: activityId, tripId: activityTripId } : undefined),
      findParticipation: async (value, userId) => domain.ok(records.find((r) => r.tripId === tripId && r.activityId === value && r.userId === userId)),
      save: async (record) => {
        records = records.filter((r) => r.activityId !== record.activityId || r.userId !== record.userId);
        records.push(record); return domain.ok(record);
      },
    };
    participations = { withTransaction: async (_, work) => work(scope), withReadSnapshot: async (_, work) => work(scope) };
  });
  const dependencies = () => ({ participations, createId: () => id(nextId++), now: () => time });
  const set = (status: unknown, authenticatedUserId = actor) => {
    expect(domain.setTripActivityParticipation).toBeDefined();
    return domain.setTripActivityParticipation.execute(dependencies(), { ...context, authenticatedUserId, status });
  };
  const get = () => {
    expect(domain.getTripActivityParticipation).toBeDefined();
    return domain.getTripActivityParticipation.execute(dependencies(), context);
  };

  it.each(["admin", "participant"] as const)("lets %s register every supported status", async (value) => {
    role = value;
    for (const status of ["going", "not_going", "pending"]) {
      expect(await set(status)).toMatchObject({ ok: true, value: { tripId, activityId, userId: actor, status, updatedAt: time } });
      expect(records).toHaveLength(1);
    }
  });
  it("preserves identity while replacing the own status and timestamp", async () => {
    const first = await set("going");
    if (!first.ok) throw first.error;
    time = new Date(initialTime.getTime() + 1000);
    const changed = await set("not_going");
    expect(changed).toEqual(domain.ok({ ...first.value, status: "not_going", updatedAt: time }));
    expect(await get()).toEqual(changed);
    expect(await set("not_going")).toEqual(changed);
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
  it.each([undefined, null, "", "confirmed", 123])("rejects invalid status %s without writes", async (status) => {
    await set("going");
    const before = structuredClone(records);
    expect(await set(status)).toMatchObject({ ok: false, error: { tag: "ValidationError" } });
    expect(records).toEqual(before);
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
  it.each(["findMemberRole", "findTrip", "findActivity", "findParticipation", "save"] as const)("propagates %s persistence failures", async (method) => {
    const failure = domain.err(new domain.UnknownError("Unavailable"));
    scope[method] = async () => failure;
    expect(await set("going")).toEqual(failure);
    if (method !== "save") expect(await get()).toEqual(failure);
    expect(records).toEqual([]);
  });
});
