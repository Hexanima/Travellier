import { describe, expect, it, vi } from "vitest";

import { err, expelTripParticipant, ok, UnknownError } from "../../index.js";
import { createObjectId } from "../../value-objects/object-id.js";
import type { ObjectId } from "../../value-objects/object-id.js";
import type { TripMember } from "../../entities/trip-member.js";

const id = (value: string) => {
  const result = createObjectId(value);
  if (!result.ok) throw result.error;
  return result.value;
};

const tripId = id("507f191e810c19729de860ea");
const otherTripId = id("507f191e810c19729de860eb");
const adminUserId = id("507f1f77bcf86cd799439011");
const participantUserId = id("507f1f77bcf86cd799439012");
const joinedAt = new Date("2026-09-24T12:00:00.000Z");

const admin: TripMember = {
  id: id("507f1f77bcf86cd799439013"),
  tripId,
  userId: adminUserId,
  role: "admin",
  joinedAt,
};
const participant: TripMember = {
  id: id("507f1f77bcf86cd799439014"),
  tripId,
  userId: participantUserId,
  role: "participant",
  joinedAt,
};

describe("expelTripParticipant", () => {
  it("allows an admin to expel a participant of the same trip", async () => {
    const memberships = new Map<ObjectId, TripMember>([
      [adminUserId, admin],
      [participantUserId, participant],
    ]);
    const findByTripAndUser = vi.fn(async (requestedTripId: ObjectId, userId: ObjectId) =>
      ok(requestedTripId === tripId ? memberships.get(userId) : undefined));
    const removeParticipant = vi.fn(async () => ok(undefined));

    const result = await expelTripParticipant.execute(
      { members: { findByTripAndUser, removeParticipant } },
      { tripId, actorUserId: adminUserId, targetUserId: participantUserId },
    );

    expect(findByTripAndUser).toHaveBeenNthCalledWith(1, tripId, adminUserId);
    expect(findByTripAndUser).toHaveBeenNthCalledWith(2, tripId, participantUserId);
    expect(removeParticipant).toHaveBeenCalledWith(participant.id);
    expect(result).toEqual({ ok: true, value: undefined });
  });

  it.each([
    ["trip", { tripId: id(tripId.toUpperCase()) }],
    ["admin", { actorUserId: id(adminUserId.toUpperCase()) }],
    ["participant", { targetUserId: id(participantUserId.toUpperCase()) }],
  ])("accepts an uppercase %s ID for the same membership", async (_label, overrides) => {
    const findByTripAndUser = vi.fn()
      .mockResolvedValueOnce(ok(admin))
      .mockResolvedValueOnce(ok(participant));
    const removeParticipant = vi.fn(async () => ok(undefined));

    const result = await expelTripParticipant.execute(
      { members: { findByTripAndUser, removeParticipant } },
      { tripId, actorUserId: adminUserId, targetUserId: participantUserId, ...overrides },
    );

    expect(result).toEqual({ ok: true, value: undefined });
    expect(removeParticipant).toHaveBeenCalledWith(participant.id);
  });

  it("rejects a participant without reading or removing the target", async () => {
    const findByTripAndUser = vi.fn(async () => ok(participant));
    const removeParticipant = vi.fn(async () => ok(undefined));

    const result = await expelTripParticipant.execute(
      { members: { findByTripAndUser, removeParticipant } },
      { tripId, actorUserId: participantUserId, targetUserId: adminUserId },
    );

    expect(result).toMatchObject({ ok: false, error: { tag: "UnauthorizedError" } });
    expect(findByTripAndUser).toHaveBeenCalledTimes(1);
    expect(removeParticipant).not.toHaveBeenCalled();
  });

  it("rejects a user with no membership in the trip", async () => {
    const findByTripAndUser = vi.fn(async () => ok(undefined));
    const removeParticipant = vi.fn(async () => ok(undefined));

    const result = await expelTripParticipant.execute(
      { members: { findByTripAndUser, removeParticipant } },
      { tripId, actorUserId: adminUserId, targetUserId: participantUserId },
    );

    expect(result).toMatchObject({ ok: false, error: { tag: "UnauthorizedError" } });
    expect(findByTripAndUser).toHaveBeenCalledTimes(1);
    expect(removeParticipant).not.toHaveBeenCalled();
  });

  it("does not expel another admin", async () => {
    const findByTripAndUser = vi.fn(async () => ok(admin));
    const removeParticipant = vi.fn(async () => ok(undefined));

    const result = await expelTripParticipant.execute(
      { members: { findByTripAndUser, removeParticipant } },
      { tripId, actorUserId: adminUserId, targetUserId: participantUserId },
    );

    expect(result).toMatchObject({ ok: false, error: { tag: "UnauthorizedError" } });
    expect(removeParticipant).not.toHaveBeenCalled();
  });

  it("rejects an admin membership from another trip", async () => {
    const findByTripAndUser = vi.fn(async () => ok({ ...admin, tripId: otherTripId }));
    const removeParticipant = vi.fn(async () => ok(undefined));

    const result = await expelTripParticipant.execute(
      { members: { findByTripAndUser, removeParticipant } },
      { tripId, actorUserId: adminUserId, targetUserId: participantUserId },
    );

    expect(result).toMatchObject({ ok: false, error: { tag: "UnauthorizedError" } });
    expect(findByTripAndUser).toHaveBeenCalledTimes(1);
    expect(removeParticipant).not.toHaveBeenCalled();
  });

  it("rejects a membership belonging to a different actor", async () => {
    const findByTripAndUser = vi.fn(async () => ok({ ...admin, userId: participantUserId }));
    const removeParticipant = vi.fn(async () => ok(undefined));

    const result = await expelTripParticipant.execute(
      { members: { findByTripAndUser, removeParticipant } },
      { tripId, actorUserId: adminUserId, targetUserId: participantUserId },
    );

    expect(result).toMatchObject({ ok: false, error: { tag: "UnauthorizedError" } });
    expect(findByTripAndUser).toHaveBeenCalledTimes(1);
    expect(removeParticipant).not.toHaveBeenCalled();
  });

  it("does not expel a participant from another trip", async () => {
    const findByTripAndUser = vi.fn(async (_tripId: ObjectId, userId: ObjectId) =>
      ok(userId === adminUserId ? admin : { ...participant, tripId: otherTripId }));
    const removeParticipant = vi.fn(async () => ok(undefined));

    const result = await expelTripParticipant.execute(
      { members: { findByTripAndUser, removeParticipant } },
      { tripId, actorUserId: adminUserId, targetUserId: participantUserId },
    );

    expect(result).toMatchObject({ ok: false, error: { tag: "UnauthorizedError" } });
    expect(removeParticipant).not.toHaveBeenCalled();
  });

  it("does not expel a membership belonging to a different target user", async () => {
    const findByTripAndUser = vi.fn(async (_tripId: ObjectId, userId: ObjectId) =>
      ok(userId === adminUserId ? admin : { ...participant, userId: adminUserId }));
    const removeParticipant = vi.fn(async () => ok(undefined));

    const result = await expelTripParticipant.execute(
      { members: { findByTripAndUser, removeParticipant } },
      { tripId, actorUserId: adminUserId, targetUserId: participantUserId },
    );

    expect(result).toMatchObject({ ok: false, error: { tag: "UnauthorizedError" } });
    expect(removeParticipant).not.toHaveBeenCalled();
  });

  it("reports a missing target member without removing anything", async () => {
    const findByTripAndUser = vi.fn(async (_tripId: ObjectId, userId: ObjectId) =>
      ok(userId === adminUserId ? admin : undefined));
    const removeParticipant = vi.fn(async () => ok(undefined));

    const result = await expelTripParticipant.execute(
      { members: { findByTripAndUser, removeParticipant } },
      { tripId, actorUserId: adminUserId, targetUserId: participantUserId },
    );

    expect(result).toMatchObject({ ok: false, error: { tag: "TripMemberNotFoundError" } });
    expect(removeParticipant).not.toHaveBeenCalled();
  });

  it("propagates an actor lookup failure without removing anything", async () => {
    const databaseError = new UnknownError("database failure");
    const findByTripAndUser = vi.fn(async () => err(databaseError));
    const removeParticipant = vi.fn(async () => ok(undefined));

    const result = await expelTripParticipant.execute(
      { members: { findByTripAndUser, removeParticipant } },
      { tripId, actorUserId: adminUserId, targetUserId: participantUserId },
    );

    expect(result).toEqual(err(databaseError));
    expect(findByTripAndUser).toHaveBeenCalledTimes(1);
    expect(removeParticipant).not.toHaveBeenCalled();
  });

  it("propagates a target lookup failure without removing anything", async () => {
    const databaseError = new UnknownError("database failure");
    const findByTripAndUser = vi.fn()
      .mockResolvedValueOnce(ok(admin))
      .mockResolvedValueOnce(err(databaseError));
    const removeParticipant = vi.fn(async () => ok(undefined));

    const result = await expelTripParticipant.execute(
      { members: { findByTripAndUser, removeParticipant } },
      { tripId, actorUserId: adminUserId, targetUserId: participantUserId },
    );

    expect(result).toEqual(err(databaseError));
    expect(removeParticipant).not.toHaveBeenCalled();
  });

  it("propagates a removal failure", async () => {
    const databaseError = new UnknownError("database failure");
    const findByTripAndUser = vi.fn(async (_tripId: ObjectId, userId: ObjectId) =>
      ok(userId === adminUserId ? admin : participant));
    const removeParticipant = vi.fn(async () => err(databaseError));

    const result = await expelTripParticipant.execute(
      { members: { findByTripAndUser, removeParticipant } },
      { tripId, actorUserId: adminUserId, targetUserId: participantUserId },
    );

    expect(result).toEqual(err(databaseError));
    expect(removeParticipant).toHaveBeenCalledWith(participant.id);
  });
});
