import { describe, expect, it, vi } from "vitest";

import { createObjectId, ok } from "../../index.js";
import { listTripMembers } from "./list-trip-members.js";

const id = (value: string) => {
  const result = createObjectId(value);
  if (!result.ok) throw result.error;
  return result.value;
};

const tripId = id("507f191e810c19729de860ea");
const userId = id("507f1f77bcf86cd799439011");
const membership = {
  id: id("507f1f77bcf86cd799439013"),
  tripId,
  userId,
  role: "participant" as const,
  joinedAt: new Date("2026-09-24T12:00:00.000Z"),
};
const members = [{ id: membership.id, userId, name: "Nico", role: "participant", joinedAt: membership.joinedAt }];

describe("listTripMembers", () => {
  it("returns only the requested trip's members to one of its members", async () => {
    const findByTripAndUser = vi.fn().mockResolvedValue(ok(membership));
    const listByTrip = vi.fn().mockResolvedValue(ok(members));

    const result = await listTripMembers.execute(
      { members: { findByTripAndUser, listByTrip } },
      { tripId, authenticatedUserId: userId },
    );

    expect(result).toEqual(ok(members));
    expect(findByTripAndUser).toHaveBeenCalledWith(tripId, userId);
    expect(listByTrip).toHaveBeenCalledWith(tripId);
  });

  it("does not query or expose members to a user outside the trip", async () => {
    const findByTripAndUser = vi.fn().mockResolvedValue(ok(undefined));
    const listByTrip = vi.fn();

    const result = await listTripMembers.execute(
      { members: { findByTripAndUser, listByTrip } },
      { tripId, authenticatedUserId: userId },
    );

    expect(result).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    expect(listByTrip).not.toHaveBeenCalled();
  });

  it("rejects a membership returned for another trip", async () => {
    const findByTripAndUser = vi.fn().mockResolvedValue(ok({ ...membership, tripId: id("507f191e810c19729de860eb") }));
    const listByTrip = vi.fn();

    const result = await listTripMembers.execute(
      { members: { findByTripAndUser, listByTrip } },
      { tripId, authenticatedUserId: userId },
    );

    expect(result).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    expect(listByTrip).not.toHaveBeenCalled();
  });
});
