import { describe, expect, it } from "vitest";

import { createTripWithAdmin, type CreateTripWithAdminInput } from "../index.js";
import { createObjectId } from "../value-objects/object-id.js";

const id = (value: string) => {
  const result = createObjectId(value);
  if (!result.ok) throw result.error;
  return result.value;
};

const tripId = id("507f191e810c19729de860ea");
const creatorId = id("507f1f77bcf86cd799439011");
const membershipId = id("507f1f77bcf86cd799439012");
const createdAt = new Date("2026-09-24T12:00:00.000Z");

describe("createTripWithAdmin", () => {
  it("creates a private trip and makes its creator an admin", () => {
    const result = createTripWithAdmin({
      tripId,
      creatorMembershipId: membershipId,
      creatorId,
      name: "Patagonia",
      inviteCode: "VIAJE-X7K2",
      createdAt,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        trip: {
          id: tripId,
          name: "Patagonia",
          description: null,
          visibility: "private",
          inviteCode: "VIAJE-X7K2",
          votingEnabled: false,
          expenseMode: "register",
          createdBy: creatorId,
          createdAt,
        },
        creatorMembership: {
          id: membershipId,
          tripId,
          userId: creatorId,
          role: "admin",
          joinedAt: createdAt,
        },
      },
    });
  });

  it("keeps the selected visibility, voting, expense mode and description", () => {
    const result = createTripWithAdmin({
      tripId,
      creatorMembershipId: membershipId,
      creatorId,
      name: "Patagonia",
      description: "Ruta de los lagos",
      inviteCode: "VIAJE-X7K2",
      createdAt,
      visibility: "public",
      votingEnabled: true,
      expenseMode: "balance",
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        trip: {
          description: "Ruta de los lagos",
          visibility: "public",
          votingEnabled: true,
          expenseMode: "balance",
        },
      },
    });
  });

  it("rejects an empty trip name", () => {
    const result = createTripWithAdmin({
      tripId,
      creatorMembershipId: membershipId,
      creatorId,
      name: "  ",
      inviteCode: "VIAJE-X7K2",
      createdAt,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { tag: "ValidationError", issues: [{ field: "name", code: "required" }] },
    });
  });

  it("rejects an empty invitation code", () => {
    const result = createTripWithAdmin({
      tripId,
      creatorMembershipId: membershipId,
      creatorId,
      name: "Patagonia",
      inviteCode: "  ",
      createdAt,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { tag: "ValidationError", issues: [{ field: "inviteCode", code: "required" }] },
    });
  });

  it.each([
    ["visibility", "friends"],
    ["expenseMode", "split"],
    ["votingEnabled", "yes"],
  ])("rejects an invalid %s", (field, value) => {
    const input = {
      tripId,
      creatorMembershipId: membershipId,
      creatorId,
      name: "Patagonia",
      inviteCode: "VIAJE-X7K2",
      createdAt,
      [field]: value,
    } as unknown as CreateTripWithAdminInput;

    const result = createTripWithAdmin(input);

    expect(result).toMatchObject({
      ok: false,
      error: { tag: "ValidationError", issues: [{ field, code: "invalid" }] },
    });
  });
});
