import { describe, expect, it } from "vitest";

import { createObjectId, err, InviteCodeConflictError, ok, type Trip } from "../../index.js";
import { createTrip, getTrip, listUserTrips, updateTripConfiguration } from "./index.js";

const id = (value: string) => {
  const result = createObjectId(value);
  if (!result.ok) throw result.error;
  return result.value;
};

const userId = id("507f1f77bcf86cd799439011");
const tripId = id("507f191e810c19729de860ea");
const membershipId = id("507f1f77bcf86cd799439012");
const destinationId = id("507f1f77bcf86cd799439013");
const createdAt = new Date("2026-09-24T12:00:00.000Z");

const trip: Trip = {
  id: tripId,
  name: "Patagonia",
  description: null,
  visibility: "private",
  inviteCode: "VIAJE-X7K2",
  votingEnabled: false,
  expenseMode: "register",
  createdBy: userId,
  createdAt,
};
const destination = { id: destinationId, tripId, name: "Bariloche", order: 1, createdAt };
const view = { ...trip, primaryDestination: destination };

describe("Trip use cases", () => {
  it("creates a private trip, its initial destination and admin membership", async () => {
    let saved: unknown;
    const result = await createTrip.execute({
      trips: { createWithAdminAndDestination: async (record: unknown) => { saved = record; return ok(undefined); } },
      createId: (() => { const ids = [tripId, membershipId, destinationId]; return () => ids.shift(); })(),
      createInviteCode: () => "VIAJE-X7K2",
      now: () => createdAt,
    } as never, { authenticatedUserId: userId, name: "Patagonia", primaryDestination: "Bariloche" });

    expect(saved).toEqual({
      trip,
      creatorMembership: { id: membershipId, tripId, userId, role: "admin", joinedAt: createdAt },
      primaryDestination: destination,
    });
    expect(result).toEqual(ok(view));
  });

  it("retries a duplicate invitation code with a fresh code", async () => {
    const codes: string[] = [];
    const result = await createTrip.execute({
      trips: { createWithAdminAndDestination: async (record: { trip: Trip }) => {
        codes.push(record.trip.inviteCode);
        return codes.length === 1 ? err(new InviteCodeConflictError()) : ok(undefined);
      } },
      createId: (() => { const ids = [tripId, membershipId, destinationId]; return () => ids.shift(); })(),
      createInviteCode: (() => { const values = ["VIAJE-X7K2", "VIAJE-Y8L3"]; return () => values.shift(); })(),
      now: () => createdAt,
    } as never, { authenticatedUserId: userId, name: "Patagonia", primaryDestination: "Bariloche" });

    expect(codes).toEqual(["VIAJE-X7K2", "VIAJE-Y8L3"]);
    expect(result).toMatchObject({ ok: true, value: { inviteCode: "VIAJE-Y8L3" } });
  });

  it("rejects a missing initial destination before persistence", async () => {
    let called = false;
    const result = await createTrip.execute({
      trips: { createWithAdminAndDestination: async () => { called = true; return ok(undefined); } },
      createId: () => tripId,
      createInviteCode: () => "VIAJE-X7K2",
      now: () => createdAt,
    } as never, { authenticatedUserId: userId, name: "Patagonia", primaryDestination: " " });
    expect(result).toMatchObject({ ok: false, error: { tag: "ValidationError", issues: [{ field: "primaryDestination" }] } });
    expect(called).toBe(false);
  });

  it("returns a trip only through the member-scoped lookup", async () => {
    const seen: unknown[] = [];
    const repository = { findByIdForMember: async (...args: unknown[]) => { seen.push(args); return ok(undefined); } };
    const result = await getTrip.execute({ trips: repository } as never, { authenticatedUserId: userId, tripId });
    expect(seen).toEqual([[tripId, userId]]);
    expect(result).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
  });

  it("lists only memberships of the authenticated user", async () => {
    const seen: unknown[] = [];
    const result = await listUserTrips.execute({
      trips: { listForMember: async (actor: unknown) => { seen.push(actor); return ok([view]); } },
    } as never, { authenticatedUserId: userId });
    expect(seen).toEqual([userId]);
    expect(result).toEqual(ok([view]));
  });

  it("validates configuration before a member-scoped update", async () => {
    const seen: unknown[] = [];
    const repository = { updateConfigurationForMember: async (...args: unknown[]) => { seen.push(args); return ok(view); } };
    const payload = { authenticatedUserId: userId, tripId, visibility: "public", votingEnabled: true, expenseMode: "balance" } as const;
    expect(await updateTripConfiguration.execute({ trips: repository } as never, payload)).toEqual(ok(view));
    expect(seen).toEqual([[tripId, userId, { visibility: "public", votingEnabled: true, expenseMode: "balance" }]]);
    const invalid = await updateTripConfiguration.execute({ trips: repository } as never, { authenticatedUserId: userId, tripId, expenseMode: "invalid" } as never);
    expect(invalid).toMatchObject({ ok: false, error: { tag: "ValidationError", issues: [{ field: "expenseMode" }] } });
    expect(seen).toHaveLength(1);
  });
});
