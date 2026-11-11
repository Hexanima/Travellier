import { describe, expect, it, vi } from "vitest";

import { err, leaveTrip, ok, UnknownError } from "../../index.js";
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
const stranger = id("507f1f77bcf86cd799439015");
const membershipIds = new Map<ObjectId, ObjectId>([
  [owner, id("507f1f77bcf86cd799439021")], [admin, id("507f1f77bcf86cd799439022")], [participant, id("507f1f77bcf86cd799439023")],
]);
const at = new Date("2026-10-04T12:00:00.789Z");

const createFake = (options: { ownerId?: ObjectId | null; removed?: boolean; ownerIsMember?: boolean; ownerRole?: TripRole } = {}) => {
  const roles = new Map<ObjectId, TripRole>([[owner, options.ownerRole ?? "admin"], [admin, "admin"], [participant, "participant"]]);
  if (options.ownerIsMember === false) roles.delete(owner);
  const events: string[] = [];
  const removeMember = vi.fn(async (...args: [membershipId: ObjectId, userId: ObjectId, notifications: unknown, at: Date]): Promise<Result<boolean>> => {
    events.push("removeMember");
    return ok(options.removed === false ? false : roles.delete(args[1]));
  });
  const scope: TripMemberAdministrationScope = {
    findMember: async (userId) => {
      const role = roles.get(userId);
      const membershipId = membershipIds.get(userId);
      return ok(role === undefined || membershipId === undefined ? undefined : { id: membershipId, role });
    },
    findOwnerId: async () => ok(options.ownerId === null ? undefined : options.ownerId ?? owner),
    setRole: vi.fn(), transferOwnership: vi.fn(), removeMember,
  };
  const port: TripMemberAdministrationPort = { withTransaction: (_tripId, work) => { events.push("begin"); return work(scope); } };
  const now = vi.fn(() => { events.push("now"); return at; });
  return { port, roles, removeMember, events, now };
};

const leave = (fake: ReturnType<typeof createFake>, actorUserId: ObjectId) =>
  leaveTrip.execute({ administration: fake.port, now: fake.now }, { tripId, actorUserId });

describe("leaveTrip", () => {
  it("lets a participant leave with no notices and the instant read inside the transaction", async () => {
    const fake = createFake();
    expect(await leave(fake, participant)).toEqual({ ok: true, value: undefined });
    expect(fake.removeMember).toHaveBeenCalledWith(membershipIds.get(participant), participant, [], at);
    expect(fake.roles.has(participant)).toBe(false);
    expect(fake.events).toEqual(["begin", "now", "removeMember"]);
  });

  it("lets a non-owner admin leave", async () => {
    const fake = createFake();
    expect(await leave(fake, admin)).toEqual({ ok: true, value: undefined });
    expect(fake.removeMember).toHaveBeenCalledWith(membershipIds.get(admin), admin, [], at);
  });

  it("rejects the owner without writing anything", async () => {
    const fake = createFake();
    expect(await leave(fake, owner)).toMatchObject({ ok: false, error: { tag: "TripOwnerProtectedError" } });
    expect(fake.removeMember).not.toHaveBeenCalled();
    expect(fake.now).not.toHaveBeenCalled();
    expect(fake.roles.has(owner)).toBe(true);
  });

  it("reports a non-member as Trip not found", async () => {
    const fake = createFake();
    expect(await leave(fake, stranger)).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    expect(fake.removeMember).not.toHaveBeenCalled();
  });

  it("reports a membership removed concurrently as missing", async () => {
    const fake = createFake({ removed: false });
    expect(await leave(fake, participant)).toMatchObject({ ok: false, error: { tag: "TripMemberNotFoundError" } });
  });

  it.each([["without owner", { ownerId: null }], ["with an owner that is not a member", { ownerIsMember: false }]])(
    "in a Trip %s rejects an admin (it would be left without admin) and lets a participant leave", async (_label, options) => {
      const adminCase = createFake(options);
      expect(await leave(adminCase, admin)).toMatchObject({ ok: false, error: { tag: "TripOwnerProtectedError" } });
      expect(adminCase.removeMember).not.toHaveBeenCalled();
      const participantCase = createFake(options);
      expect(await leave(participantCase, participant)).toEqual({ ok: true, value: undefined });
      expect(participantCase.removeMember).toHaveBeenCalledTimes(1);
    });

  it("rejects an admin when the owner is a member with the participant role (inconsistent data), without writing", async () => {
    const fake = createFake({ ownerRole: "participant" });
    expect(await leave(fake, admin)).toMatchObject({ ok: false, error: { tag: "TripOwnerProtectedError" } });
    expect(fake.removeMember).not.toHaveBeenCalled();
    expect(fake.now).not.toHaveBeenCalled();
    expect(fake.roles.has(admin)).toBe(true);
  });

  it("lets an admin leave when the owner is an admin member", async () => {
    const fake = createFake({ ownerRole: "admin" });
    expect(await leave(fake, admin)).toEqual({ ok: true, value: undefined });
    expect(fake.removeMember).toHaveBeenCalledTimes(1);
  });

  it("lets a participant leave when the owner has the participant role", async () => {
    const fake = createFake({ ownerRole: "participant" });
    expect(await leave(fake, participant)).toEqual({ ok: true, value: undefined });
    expect(fake.removeMember).toHaveBeenCalledTimes(1);
  });

  it("propagates port and removal failures", async () => {
    const failure = new UnknownError("database failure");
    expect(await leaveTrip.execute({ administration: { withTransaction: async () => err(failure) }, now: () => at }, { tripId, actorUserId: participant })).toEqual(err(failure));
    const fake = createFake();
    fake.removeMember.mockResolvedValueOnce(err(failure));
    expect(await leave(fake, participant)).toEqual(err(failure));
  });
});
