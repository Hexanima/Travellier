import { describe, expect, it } from "vitest";

import { changeTripMemberRole, err, ok, transferTripOwnership, UnknownError } from "../../index.js";
import type { TripMemberAdministrationPort, TripMemberAdministrationScope, TripRole } from "../../index.js";
import { createObjectId } from "../../value-objects/object-id.js";
import type { ObjectId } from "../../value-objects/object-id.js";

const id = (value: string) => {
  const result = createObjectId(value);
  if (!result.ok) throw result.error;
  return result.value;
};

const tripId = id("507f191e810c19729de860ea");
const owner = id("507f1f77bcf86cd799439011");
const admin = id("507f1f77bcf86cd799439012");
const participant = id("507f1f77bcf86cd799439013");
const stranger = id("507f1f77bcf86cd799439014");

/** In-memory port: counts writes and emulates the abort (rollback) when the work returns an error. */
const createFake = (ownerId: ObjectId | null = owner) => {
  const state = {
    ownerId: ownerId ?? undefined,
    members: new Map<ObjectId, TripRole>([[owner, "admin"], [admin, "admin"], [participant, "participant"]]),
    writes: 0,
  };
  const port: TripMemberAdministrationPort = {
    withTransaction: async (_tripId, work) => {
      const snapshot = { ownerId: state.ownerId, members: new Map(state.members) };
      const scope: TripMemberAdministrationScope = {
        findMember: async (userId) => {
          const role = state.members.get(userId);
          return ok(role === undefined ? undefined : { id: userId, role });
        },
        findOwnerId: async () => ok(state.ownerId),
        setRole: async (userId, role) => { state.writes += 1; state.members.set(userId, role); return ok(undefined); },
        transferOwnership: async (_from, to) => {
          state.writes += 1;
          state.ownerId = to;
          state.members.set(to, "admin");
          return ok(undefined);
        },
        removeMember: async (membershipId) => { state.writes += 1; return ok(state.members.delete(membershipId)); },
      };
      const result = await work(scope);
      if (!result.ok) { state.ownerId = snapshot.ownerId; state.members = snapshot.members; }
      return result;
    },
  };
  return { state, port };
};

describe("changeTripMemberRole", () => {
  it("lets the owner promote a participant and demote an admin", async () => {
    const { state, port } = createFake();
    expect(await changeTripMemberRole.execute({ administration: port }, { tripId, actorUserId: owner, targetUserId: participant, role: "admin" }))
      .toEqual(ok(undefined));
    expect(state.members.get(participant)).toBe("admin");
    expect(await changeTripMemberRole.execute({ administration: port }, { tripId, actorUserId: owner, targetUserId: admin, role: "participant" }))
      .toEqual(ok(undefined));
    expect(state.members.get(admin)).toBe("participant");
    expect(state.writes).toBe(2);
  });

  it.each([
    ["a non-owner admin", admin, "UnauthorizedError"],
    ["a participant", participant, "UnauthorizedError"],
    ["a non-member", stranger, "TripNotFoundError"],
  ])("rejects %s without writing", async (_label, actor, tag) => {
    const { state, port } = createFake();
    const result = await changeTripMemberRole.execute({ administration: port }, { tripId, actorUserId: actor, targetUserId: participant, role: "admin" });
    expect(result).toMatchObject({ ok: false, error: { tag } });
    expect(state.writes).toBe(0);
    expect(state.members.get(participant)).toBe("participant");
  });

  it("never leaves the owner as participant", async () => {
    const { state, port } = createFake();
    const result = await changeTripMemberRole.execute({ administration: port }, { tripId, actorUserId: owner, targetUserId: owner, role: "participant" });
    expect(result).toMatchObject({ ok: false, error: { tag: "TripOwnerProtectedError" } });
    expect(state.writes).toBe(0);
    expect(state.members.get(owner)).toBe("admin");
  });

  it("is idempotent when the role is already applied", async () => {
    const { state, port } = createFake();
    expect(await changeTripMemberRole.execute({ administration: port }, { tripId, actorUserId: owner, targetUserId: admin, role: "admin" })).toEqual(ok(undefined));
    expect(await changeTripMemberRole.execute({ administration: port }, { tripId, actorUserId: owner, targetUserId: participant, role: "participant" })).toEqual(ok(undefined));
    expect(await changeTripMemberRole.execute({ administration: port }, { tripId, actorUserId: owner, targetUserId: owner, role: "admin" })).toEqual(ok(undefined));
    expect(state.writes).toBe(0);
  });

  it("reports a missing target without writing", async () => {
    const { state, port } = createFake();
    const result = await changeTripMemberRole.execute({ administration: port }, { tripId, actorUserId: owner, targetUserId: stranger, role: "admin" });
    expect(result).toMatchObject({ ok: false, error: { tag: "TripMemberNotFoundError" } });
    expect(state.writes).toBe(0);
  });

  it("rejects everything when the trip has no owner", async () => {
    const { state, port } = createFake(null);
    const result = await changeTripMemberRole.execute({ administration: port }, { tripId, actorUserId: owner, targetUserId: participant, role: "admin" });
    expect(result).toMatchObject({ ok: false, error: { tag: "UnauthorizedError" } });
    expect(state.writes).toBe(0);
  });

  it("propagates port errors", async () => {
    const failure = new UnknownError("db");
    const result = await changeTripMemberRole.execute({ administration: { withTransaction: async () => err(failure) } },
      { tripId, actorUserId: owner, targetUserId: participant, role: "admin" });
    expect(result).toEqual(err(failure));
  });
});

describe("transferTripOwnership", () => {
  it.each([["admin", admin], ["participant", participant]])("transfers to a %s keeping the previous owner as admin", async (_label, target) => {
    const { state, port } = createFake();
    expect(await transferTripOwnership.execute({ administration: port }, { tripId, actorUserId: owner, targetUserId: target })).toEqual(ok(undefined));
    expect(state.ownerId).toBe(target);
    expect(state.members.get(target)).toBe("admin");
    expect(state.members.get(owner)).toBe("admin");
    expect(state.writes).toBe(1);
  });

  it("rejects transferring to oneself with a validation error", async () => {
    const { state, port } = createFake();
    const result = await transferTripOwnership.execute({ administration: port }, { tripId, actorUserId: owner, targetUserId: owner });
    expect(result).toMatchObject({ ok: false, error: { tag: "ValidationError", issues: [{ field: "userId", code: "same_owner" }] } });
    expect(state.writes).toBe(0);
  });

  it("rejects a non-member target with 404 semantics", async () => {
    const { state, port } = createFake();
    const result = await transferTripOwnership.execute({ administration: port }, { tripId, actorUserId: owner, targetUserId: stranger });
    expect(result).toMatchObject({ ok: false, error: { tag: "TripMemberNotFoundError" } });
    expect(state.writes).toBe(0);
  });

  it.each([
    ["a non-owner admin", admin, "UnauthorizedError"],
    ["a participant", participant, "UnauthorizedError"],
    ["a non-member", stranger, "TripNotFoundError"],
  ])("rejects %s without writing", async (_label, actor, tag) => {
    const { state, port } = createFake();
    const result = await transferTripOwnership.execute({ administration: port }, { tripId, actorUserId: actor, targetUserId: participant });
    expect(result).toMatchObject({ ok: false, error: { tag } });
    expect(state.writes).toBe(0);
    expect(state.ownerId).toBe(owner);
  });

  it("rejects everything when the trip has no owner", async () => {
    const { state, port } = createFake(null);
    const result = await transferTripOwnership.execute({ administration: port }, { tripId, actorUserId: owner, targetUserId: participant });
    expect(result).toMatchObject({ ok: false, error: { tag: "UnauthorizedError" } });
    expect(state.writes).toBe(0);
  });

  it("propagates port errors", async () => {
    const failure = new UnknownError("db");
    const result = await transferTripOwnership.execute({ administration: { withTransaction: async () => err(failure) } },
      { tripId, actorUserId: owner, targetUserId: participant });
    expect(result).toEqual(err(failure));
  });
});
