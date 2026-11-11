import { describe, expect, it, vi } from "vitest";

import { err, expelTripParticipant, ok, UnknownError } from "../../index.js";
import type { Result, TripMemberAdministrationPort, TripMemberAdministrationScope, TripRole } from "../../index.js";
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
const otherParticipant = id("507f1f77bcf86cd799439014");
const stranger = id("507f1f77bcf86cd799439015");
const membershipIds = new Map<ObjectId, ObjectId>([
  [owner, id("507f1f77bcf86cd799439021")], [admin, id("507f1f77bcf86cd799439022")],
  [participant, id("507f1f77bcf86cd799439023")], [otherParticipant, id("507f1f77bcf86cd799439024")],
]);
const now = () => new Date("2026-10-04T12:00:00.789Z");

/** The only notice of an expulsion: for the expelled user alone, with no actor and no data of the Trip. */
const expulsionNotice = (userId: ObjectId) => {
  const membershipId = membershipIds.get(userId);
  return [{ eventKey: `member.expelled:${membershipId}:${userId}`, type: "member.expelled", tripId, userId, actorId: null,
    operationKey: `member.expelled:${membershipId}`, payload: { tripId }, createdAt: now() }];
};

const createFake = (options: { ownerId?: ObjectId | null; removed?: boolean; ownerRole?: TripRole } = {}) => {
  const roles = new Map<ObjectId, TripRole>([[owner, options.ownerRole ?? "admin"], [admin, "admin"], [participant, "participant"], [otherParticipant, "participant"]]);
  const calls = { findOwnerId: 0 };
  const removeMember = vi.fn(async (...args: [membershipId: ObjectId, userId: ObjectId, notifications: unknown, at: Date]): Promise<Result<boolean>> =>
    ok(options.removed === false ? false : roles.delete(args[1])));
  const scope: TripMemberAdministrationScope = {
    findMember: async (userId) => {
      const role = roles.get(userId);
      const membershipId = membershipIds.get(userId);
      return ok(role === undefined || membershipId === undefined ? undefined : { id: membershipId, role });
    },
    findOwnerId: async () => { calls.findOwnerId += 1; return ok(options.ownerId === null ? undefined : options.ownerId ?? owner); },
    setRole: vi.fn(), transferOwnership: vi.fn(), removeMember,
  };
  const port: TripMemberAdministrationPort = { withTransaction: (_tripId, work) => work(scope) };
  return { port, roles, calls, removeMember };
};

const expel = (port: TripMemberAdministrationPort, actorUserId: ObjectId, targetUserId: ObjectId) =>
  expelTripParticipant.execute({ administration: port, now }, { tripId, actorUserId, targetUserId });

describe("expelTripParticipant", () => {
  it.each([["an admin", admin], ["the owner", owner]])("lets %s expel a participant with a notice for the expelled user only", async (_label, actor) => {
    const { port, removeMember, calls, roles } = createFake();
    expect(await expel(port, actor, participant)).toEqual({ ok: true, value: undefined });
    expect(removeMember).toHaveBeenCalledWith(membershipIds.get(participant), participant, expulsionNotice(participant), now());
    expect(JSON.stringify(removeMember.mock.calls[0]?.[2])).not.toContain(actor);
    expect(roles.has(participant)).toBe(false);
    expect(calls.findOwnerId).toBe(1);
  });

  it("lets the owner expel an admin with the same notice", async () => {
    const { port, removeMember, roles } = createFake();
    expect(await expel(port, owner, admin)).toEqual({ ok: true, value: undefined });
    expect(removeMember).toHaveBeenCalledWith(membershipIds.get(admin), admin, expulsionNotice(admin), now());
    expect(roles.has(admin)).toBe(false);
  });

  it("does not let a non-owner admin expel another admin", async () => {
    const { port, removeMember, roles } = createFake();
    roles.set(participant, "admin");
    expect(await expel(port, admin, participant)).toMatchObject({ ok: false, error: { tag: "UnauthorizedError" } });
    expect(removeMember).not.toHaveBeenCalled();
    expect(roles.size).toBe(4);
  });

  it("nobody expels the owner, not even the owner", async () => {
    const { port, removeMember } = createFake();
    expect(await expel(port, admin, owner)).toMatchObject({ ok: false, error: { tag: "UnauthorizedError" } });
    expect(await expel(port, participant, owner)).toMatchObject({ ok: false, error: { tag: "UnauthorizedError" } });
    expect(await expel(port, owner, owner)).toMatchObject({ ok: false, error: { tag: "UnauthorizedError" } });
    expect(removeMember).not.toHaveBeenCalled();
  });

  it("does not let an admin expel itself", async () => {
    const { port, removeMember } = createFake();
    expect(await expel(port, admin, admin)).toMatchObject({ ok: false, error: { tag: "UnauthorizedError" } });
    expect(removeMember).not.toHaveBeenCalled();
  });

  it("rejects a Trip without owner for admin targets without writing", async () => {
    const { port, removeMember } = createFake({ ownerId: null });
    expect(await expel(port, owner, admin)).toMatchObject({ ok: false, error: { tag: "UnauthorizedError" } });
    expect(removeMember).not.toHaveBeenCalled();
  });

  it.each([["a participant", participant], ["a non-member", stranger]])("rejects %s as actor without removing the target", async (_label, actor) => {
    const { port, removeMember } = createFake();
    expect(await expel(port, actor, otherParticipant)).toMatchObject({ ok: false, error: { tag: "UnauthorizedError" } });
    expect(removeMember).not.toHaveBeenCalled();
  });

  it("reports a missing target without removing anything", async () => {
    const { port, removeMember } = createFake();
    expect(await expel(port, admin, stranger)).toMatchObject({ ok: false, error: { tag: "TripMemberNotFoundError" } });
    expect(removeMember).not.toHaveBeenCalled();
  });

  it("reports a membership removed concurrently as missing", async () => {
    const { port } = createFake({ removed: false });
    expect(await expel(port, admin, participant)).toMatchObject({ ok: false, error: { tag: "TripMemberNotFoundError" } });
  });

  it("always reads the owner inside the transaction", async () => {
    const participantCase = createFake();
    await expel(participantCase.port, admin, participant);
    expect(participantCase.calls.findOwnerId).toBe(1);
    const adminCase = createFake();
    await expel(adminCase.port, owner, admin);
    expect(adminCase.calls.findOwnerId).toBe(1);
  });

  it("never expels the owner even with inconsistent data (owner with participant role)", async () => {
    const { port, removeMember, roles } = createFake({ ownerRole: "participant" });
    expect(await expel(port, admin, owner)).toMatchObject({ ok: false, error: { tag: "UnauthorizedError" } });
    expect(removeMember).not.toHaveBeenCalled();
    expect(roles.has(owner)).toBe(true);
  });

  it("lets an admin expel a participant in a Trip without owner", async () => {
    const { port, removeMember } = createFake({ ownerId: null });
    expect(await expel(port, admin, participant)).toEqual({ ok: true, value: undefined });
    expect(removeMember).toHaveBeenCalledTimes(1);
  });

  it("propagates port and removal failures", async () => {
    const failure = new UnknownError("database failure");
    expect(await expel({ withTransaction: async () => err(failure) }, admin, participant)).toEqual(err(failure));
    const { port, removeMember } = createFake();
    removeMember.mockResolvedValueOnce(err(failure));
    expect(await expel(port, admin, participant)).toEqual(err(failure));
  });
});
