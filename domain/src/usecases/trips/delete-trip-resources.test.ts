import { describe, expect, it } from "vitest";

import { createObjectId, ok, type ObjectId, type TripDeletionPort, type TripRole } from "../../index.js";
import { deleteTrip } from "./delete-trip-resources.js";

const id = (value: string) => {
  const result = createObjectId(value);
  if (!result.ok) throw result.error;
  return result.value;
};

const tripId = id("507f191e810c19729de860ea");
const owner = id("507f1f77bcf86cd799439011");
const otherAdmin = id("507f1f77bcf86cd799439012");
const participant = id("507f1f77bcf86cd799439013");
const stranger = id("507f1f77bcf86cd799439014");

const setup = (ownerId: ObjectId | undefined) => {
  const roles = new Map<ObjectId, TripRole>([[owner, "admin"], [otherAdmin, "admin"], [participant, "participant"]]);
  const calls: string[] = [];
  const deletion: TripDeletionPort = {
    findDestinationIdsWithRecords: async () => ok([]),
    withTransaction: async (_tripId, work) => work({
      findMemberRole: async (userId) => ok(roles.get(userId)),
      findOwnerId: async () => ok(ownerId),
      listDestinations: async () => ok([]),
      hasDestinationRecords: async () => ok(false),
      removeDestination: async () => ok(undefined),
      removeTrip: async () => { calls.push("removeTrip"); return ok(undefined); },
    }),
  };
  return { deletion, calls };
};

describe("deleteTrip", () => {
  it("lets the owner remove the trip", async () => {
    const { deletion, calls } = setup(owner);
    expect(await deleteTrip.execute({ deletion }, { authenticatedUserId: owner, tripId })).toEqual(ok(undefined));
    expect(calls).toEqual(["removeTrip"]);
  });

  it.each([
    ["an admin who is not the owner", otherAdmin],
    ["a participant", participant],
  ])("rejects %s with Unauthorized and without removing anything", async (_label, actor) => {
    const { deletion, calls } = setup(owner);
    expect(await deleteTrip.execute({ deletion }, { authenticatedUserId: actor, tripId }))
      .toMatchObject({ ok: false, error: { tag: "UnauthorizedError" } });
    expect(calls).toEqual([]);
  });

  it("hides the trip from a non-member", async () => {
    const { deletion, calls } = setup(owner);
    expect(await deleteTrip.execute({ deletion }, { authenticatedUserId: stranger, tripId }))
      .toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    expect(calls).toEqual([]);
  });

  it("rejects every deletion while the trip has no owner", async () => {
    const { deletion, calls } = setup(undefined);
    expect(await deleteTrip.execute({ deletion }, { authenticatedUserId: owner, tripId }))
      .toMatchObject({ ok: false, error: { tag: "UnauthorizedError" } });
    expect(calls).toEqual([]);
  });
});
