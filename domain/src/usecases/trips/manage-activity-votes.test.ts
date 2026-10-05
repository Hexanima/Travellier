import { beforeEach, describe, expect, it } from "vitest";
import * as domain from "../../index.js";
import type { ActivityVote, ActivityStatus, ObjectId, TripVotePort, TripVoteScope, TripRole } from "../../index.js";

const id = (n: number): ObjectId => {
  const result = domain.createObjectId(n.toString(16).padStart(24, "0"));
  if (!result.ok) throw result.error;
  return result.value;
};
const tripId = id(1), actor = id(2), other = id(3), activityId = id(4);
const context = { tripId, activityId, authenticatedUserId: actor };
const initialTime = new Date("2026-10-04T12:00:00.123Z");

describe("individual activity vote use cases", () => {
  let role: TripRole | undefined, tripExists: boolean, activityTripId: ObjectId | undefined;
  let votingEnabled: boolean, status: ActivityStatus, records: ActivityVote[], scope: TripVoteScope, votes: TripVotePort;
  let time: Date, nextId: number;
  beforeEach(() => {
    role = "participant"; tripExists = true; activityTripId = tripId; votingEnabled = true;
    status = "proposed"; records = []; time = initialTime; nextId = 10;
    scope = {
      findMemberRole: async (userId) => domain.ok(userId === actor || userId === other ? role : undefined),
      findTrip: async () => domain.ok(tripExists ? { id: tripId, votingEnabled } : undefined),
      findActivity: async (value) => domain.ok(value === activityId && activityTripId ? { id: activityId, tripId: activityTripId, status } : undefined),
      findVote: async (value, userId) => domain.ok(records.find((r) => r.tripId === tripId && r.activityId === value && r.userId === userId)),
      save: async (record) => {
        records = records.filter((r) => r.activityId !== record.activityId || r.userId !== record.userId);
        records.push(record); return domain.ok(record);
      },
      setActivityStatus: async (_, nextStatus) => { status = nextStatus; return domain.ok(undefined); },
    };
    votes = { withReadSnapshot: async (_, work) => work(scope), withTransaction: async (_, work) => {
      const before = structuredClone(records), beforeStatus = status;
      const result = await work(scope);
      if (!result.ok) { records = before; status = beforeStatus; }
      return result;
    } };
  });
  const dependencies = () => ({ votes, createId: () => id(nextId++), now: () => time });
  const set = (value: unknown, authenticatedUserId = actor) => {
    expect(domain.setTripActivityVote).toBeDefined();
    return domain.setTripActivityVote.execute(dependencies(), { ...context, authenticatedUserId, value });
  };
  const get = () => {
    expect(domain.getTripActivityVote).toBeDefined();
    return domain.getTripActivityVote.execute(dependencies(), context);
  };

  it.each(["admin", "participant"] as const)("lets %s register and replace supported values", async (roleValue) => {
    role = roleValue;
    for (const value of ["up", "down", "down", "up"]) {
      expect(await set(value)).toMatchObject({ ok: true, value: { vote: { tripId, activityId, userId: actor, value, createdAt: initialTime }, activityStatus: "voting" } });
      expect(records).toHaveLength(1);
    }
  });
  it.each(["up", "down"])("starts voting after a first %s vote", async (value) => {
    expect(await set(value)).toMatchObject({ ok: true, value: { activityStatus: "voting" } });
    expect(status).toBe("voting");
  });
  it("preserves identity and original creation time when replacing or repeating the vote", async () => {
    const first = await set("up");
    if (!first.ok) throw first.error;
    time = new Date(initialTime.getTime() + 1000);
    const changed = await set("down");
    expect(changed).toEqual(domain.ok({ ...first.value, vote: { ...first.value.vote, value: "down" } }));
    expect(await get()).toEqual(changed);
    expect(await set("down")).toEqual(changed);
    expect(records).toHaveLength(1);
  });
  it("keeps other members' votes independent and never confirms by vote count", async () => {
    await set("up", other);
    const before = structuredClone(records[0]);
    await set("up"); await set("down");
    expect(records).toHaveLength(2);
    expect(records.find((r) => r.userId === other)).toEqual(before);
    expect(status).toBe("voting");
  });
  it("reads absence without registering a vote or starting voting", async () => {
    expect(await get()).toEqual(domain.ok({ vote: null, activityStatus: "proposed" }));
    expect(records).toEqual([]); expect(status).toBe("proposed");
  });
  it("rejects both registration and replacement when voting is disabled but preserves readable history", async () => {
    await set("up");
    const before = structuredClone(records);
    votingEnabled = false;
    expect(await set("down")).toMatchObject({ ok: false, error: { tag: "ActivityVotingDisabledError" } });
    expect(records).toEqual(before);
    records = [];
    expect(await set("up")).toMatchObject({ ok: false, error: { tag: "ActivityVotingDisabledError" } });
    expect(await get()).toEqual(domain.ok({ vote: null, activityStatus: "voting" }));
  });
  it("rejects votes on confirmed activities and permits reads", async () => {
    status = "confirmed";
    expect(await set("up")).toMatchObject({ ok: false, error: { tag: "ActivityVotingClosedError" } });
    expect(records).toEqual([]);
    expect(await get()).toEqual(domain.ok({ vote: null, activityStatus: "confirmed" }));
  });
  it.each([undefined, null, "", "confirmed", 123])("rejects invalid value %s without writes or transitions", async (value) => {
    expect(await set(value)).toMatchObject({ ok: false, error: { tag: "ValidationError" } });
    expect(records).toEqual([]); expect(status).toBe("proposed");
  });
  it("rejects an invalid server timestamp without writes", async () => {
    time = new Date(NaN);
    expect(await set("up")).toMatchObject({ ok: false, error: { tag: "ValidationError" } });
    expect(records).toEqual([]); expect(status).toBe("proposed");
  });
  it.each(["nonmember", "missingTrip", "missingActivity", "foreignActivity"])("rejects %s for both reads and writes", async (condition) => {
    if (condition === "nonmember") role = undefined;
    if (condition === "missingTrip") tripExists = false;
    if (condition === "missingActivity") activityTripId = undefined;
    if (condition === "foreignActivity") activityTripId = id(99);
    const tag = condition === "nonmember" || condition === "missingTrip" ? "TripNotFoundError" : "ActivityNotFoundError";
    expect(await set("up")).toMatchObject({ ok: false, error: { tag } });
    expect(await get()).toMatchObject({ ok: false, error: { tag } });
    expect(records).toEqual([]); expect(status).toBe("proposed");
  });
  it.each(["findMemberRole", "findTrip", "findActivity", "findVote", "save", "setActivityStatus"] as const)("propagates %s persistence failures", async (method) => {
    const failure = domain.err(new domain.UnknownError("Unavailable"));
    scope[method] = async () => failure;
    expect(await set("up")).toEqual(failure);
    if (method !== "save" && method !== "setActivityStatus") expect(await get()).toEqual(failure);
    expect(records).toEqual([]); expect(status).toBe("proposed");
  });
});
