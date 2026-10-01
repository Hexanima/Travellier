import { describe, expect, it, vi } from "vitest";
import { createObjectId, ok, type TripDestination, type Transport } from "../../index.js";
import { createJourneyDestination, createJourneyTransport, listJourneyDestinations, updateJourneyDestination } from "./manage-journey.js";

const id = (value: string) => {
  const result = createObjectId(value);
  if (!result.ok) throw result.error;
  return result.value;
};
const tripId = id("507f191e810c19729de860ea");
const otherTripId = id("507f191e810c19729de860eb");
const actorId = id("507f1f77bcf86cd799439011");
const destinationId = id("507f1f77bcf86cd799439013");
const destination: TripDestination = { id: destinationId, tripId, name: "Córdoba", order: 1, createdAt: new Date() };
const transport: Transport = { id: id("507f1f77bcf86cd799439014"), tripId, destinationId, direction: "outbound", type: "car",
  departurePlace: "Origen", departureAt: new Date("2026-09-24T08:00:00Z"), arrivalPlace: "Destino", arrivalAt: new Date("2026-09-24T09:00:00Z"), costPerPerson: null, details: {} };
const member = { id: id("507f1f77bcf86cd799439015"), tripId, userId: actorId, role: "participant" as const, joinedAt: new Date() };

describe("journey use cases", () => {
  it("does not list or create destinations for a nonmember", async () => {
    const appendDestination = vi.fn();
    const listDestinations = vi.fn();
    const deps = { members: { findByTripAndUser: async () => ok(undefined) }, journeys: { appendDestination, listDestinations }, createId: () => destinationId, now: () => new Date() } as never;
    expect(await createJourneyDestination.execute(deps, { authenticatedUserId: actorId, tripId, name: "Córdoba" })).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    expect(await listJourneyDestinations.execute(deps, { authenticatedUserId: actorId, tripId })).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    expect(appendDestination).not.toHaveBeenCalled();
    expect(listDestinations).not.toHaveBeenCalled();
  });

  it("appends a valid destination and rejects invalid updates before persistence", async () => {
    const appendDestination = vi.fn().mockResolvedValue(ok(destination));
    const updateDestination = vi.fn();
    const deps = { members: { findByTripAndUser: async () => ok(member) }, journeys: { appendDestination, updateDestination }, createId: () => destinationId, now: () => destination.createdAt } as never;
    expect(await createJourneyDestination.execute(deps, { authenticatedUserId: actorId, tripId, name: "Córdoba" })).toEqual(ok(destination));
    expect(appendDestination).toHaveBeenCalledWith(expect.objectContaining({ tripId, name: "Córdoba" }));
    expect(await updateJourneyDestination.execute(deps, { authenticatedUserId: actorId, tripId, destinationId, order: 0 })).toMatchObject({ ok: false, error: { tag: "ValidationError" } });
    expect(updateDestination).not.toHaveBeenCalled();
  });

  it("rejects a transport when the destination belongs to another Trip", async () => {
    const insertTransport = vi.fn();
    const deps = { members: { findByTripAndUser: async () => ok(member) }, journeys: {
      findDestination: async () => ok({ ...destination, tripId: otherTripId }), insertTransport,
    }, createId: () => transport.id } as never;
    const result = await createJourneyTransport.execute(deps, { ...transport, authenticatedUserId: actorId, tripId, destinationId });
    expect(result).toMatchObject({ ok: false, error: { tag: "DestinationNotFoundError" } });
    expect(insertTransport).not.toHaveBeenCalled();
  });

  it("rejects an invalid transport without inserting it", async () => {
    const insertTransport = vi.fn();
    const deps = { members: { findByTripAndUser: async () => ok(member) }, journeys: { findDestination: async () => ok(destination), insertTransport }, createId: () => transport.id } as never;
    const result = await createJourneyTransport.execute(deps, { ...transport, authenticatedUserId: actorId, arrivalAt: new Date("2026-09-24T07:00:00Z") });
    expect(result).toMatchObject({ ok: false, error: { tag: "ValidationError" } });
    expect(insertTransport).not.toHaveBeenCalled();
  });

  it("persists only transport fields and does not expose the authenticated actor", async () => {
    const insertTransport = vi.fn(async (value: Transport) => ok(value));
    const deps = { members: { findByTripAndUser: async () => ok(member) }, journeys: { findDestination: async () => ok(destination), insertTransport }, createId: () => transport.id } as never;
    const result = await createJourneyTransport.execute(deps, { ...transport, authenticatedUserId: actorId });
    expect(result).toEqual(ok(transport));
    expect(insertTransport).toHaveBeenCalledWith(transport);
  });
});
