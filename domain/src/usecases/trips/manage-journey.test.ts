import { describe, expect, it, vi } from "vitest";
import { createObjectId, ok, type TripDestination, type Transport, type TripJourneyPort } from "../../index.js";
import { createJourneyDestination, createJourneyTransport, listJourneyDestinations, updateJourneyDestination, updateJourneyTransport } from "./manage-journey.js";

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
  departurePlace: "Origen", departureAt: new Date("2026-09-24T08:00:00Z"), arrivalPlace: "Destino", arrivalAt: new Date("2026-09-24T09:00:00Z"), costPerPerson: null, costCurrency: null, details: {} };
const member = { id: id("507f1f77bcf86cd799439015"), tripId, userId: actorId, role: "participant" as const, joinedAt: new Date() };

const journeyStub = (overrides: Partial<TripJourneyPort>): TripJourneyPort => {
  const journeys = { listDestinations: async () => ok([destination]), listTransports: async () => ok([transport]),
    listItineraryDays: async () => ok([]), listItineraryReferences: async () => ok({ activities: [] }),
    replaceItineraryDays: async () => ok(undefined), ...overrides } as TripJourneyPort;
  journeys.withTransaction = async (_tripId, work) => work(journeys);
  return journeys;
};

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
    const deps = { members: { findByTripAndUser: async () => ok(member) }, journeys: journeyStub({ appendDestination, updateDestination }), createId: () => destinationId, now: () => destination.createdAt } as never;
    expect(await createJourneyDestination.execute(deps, { authenticatedUserId: actorId, tripId, name: "Córdoba" })).toEqual(ok(destination));
    expect(appendDestination).toHaveBeenCalledWith(expect.objectContaining({ tripId, name: "Córdoba" }));
    expect(await updateJourneyDestination.execute(deps, { authenticatedUserId: actorId, tripId, destinationId, order: 0 })).toMatchObject({ ok: false, error: { tag: "ValidationError" } });
    expect(updateDestination).not.toHaveBeenCalled();
  });

  it("rejects a transport when the destination belongs to another Trip", async () => {
    const insertTransport = vi.fn();
    const deps = { members: { findByTripAndUser: async () => ok(member) }, journeys: journeyStub({
      findDestination: async () => ok({ ...destination, tripId: otherTripId }), insertTransport,
    }), createId: () => transport.id } as never;
    const result = await createJourneyTransport.execute(deps, { ...transport, authenticatedUserId: actorId, tripId, destinationId });
    expect(result).toMatchObject({ ok: false, error: { tag: "DestinationNotFoundError" } });
    expect(insertTransport).not.toHaveBeenCalled();
  });

  it("rejects an invalid transport without inserting it", async () => {
    const insertTransport = vi.fn();
    const deps = { members: { findByTripAndUser: async () => ok(member) }, journeys: journeyStub({ findDestination: async () => ok(destination), insertTransport }), createId: () => transport.id } as never;
    const result = await createJourneyTransport.execute(deps, { ...transport, authenticatedUserId: actorId, arrivalAt: new Date("2026-09-24T07:00:00Z") });
    expect(result).toMatchObject({ ok: false, error: { tag: "ValidationError" } });
    expect(insertTransport).not.toHaveBeenCalled();
  });

  it("persists only transport fields and does not expose the authenticated actor", async () => {
    const insertTransport = vi.fn(async (value: Transport) => ok(value));
    const deps = { members: { findByTripAndUser: async () => ok(member) }, journeys: journeyStub({ findDestination: async () => ok(destination), insertTransport }), createId: () => transport.id } as never;
    const result = await createJourneyTransport.execute(deps, { ...transport, authenticatedUserId: actorId });
    expect(result).toEqual(ok(transport));
    expect(insertTransport).toHaveBeenCalledWith(transport);
  });

  it("merges a partial transport update with the stored transport", async () => {
    const replaceTransport = vi.fn(async (value: Transport) => ok(value));
    const findTransport = vi.fn(async () => ok(transport));
    const deps = { members: { findByTripAndUser: async () => ok(member) }, journeys: journeyStub({
      findDestination: async () => ok(destination), findTransport, replaceTransport,
    }), createId: () => transport.id } as never;
    const result = await updateJourneyTransport.execute(deps, { authenticatedUserId: actorId, tripId, destinationId,
      transportId: transport.id, arrivalPlace: "Nuevo destino" } as never);
    expect(result).toEqual(ok({ ...transport, arrivalPlace: "Nuevo destino" }));
    expect(replaceTransport).toHaveBeenCalledWith({ ...transport, arrivalPlace: "Nuevo destino" });
    expect(findTransport).toHaveBeenCalledWith(tripId, destinationId, transport.id);
  });

  it("keeps omitted nested transport details for the same type", async () => {
    const flight: Transport = { ...transport, type: "flight", details: { flightNumber: "LA1", airline: "LATAM" } };
    const replaceTransport = vi.fn(async (value: Transport) => ok(value));
    const deps = { members: { findByTripAndUser: async () => ok(member) }, journeys: journeyStub({
      findDestination: async () => ok(destination), findTransport: async () => ok(flight), replaceTransport,
    }), createId: () => transport.id } as never;
    expect(await updateJourneyTransport.execute(deps, { authenticatedUserId: actorId, tripId, destinationId,
      transportId: flight.id, details: { flightNumber: "LA2" } } as never)).toEqual(ok({ ...flight,
      details: { flightNumber: "LA2", airline: "LATAM" },
    }));
  });

  it("does not save a partial update that makes the transport invalid", async () => {
    const replaceTransport = vi.fn();
    const deps = { members: { findByTripAndUser: async () => ok(member) }, journeys: journeyStub({
      findDestination: async () => ok(destination), findTransport: async () => ok(transport), replaceTransport,
    }), createId: () => transport.id } as never;
    expect(await updateJourneyTransport.execute(deps, { authenticatedUserId: actorId, tripId, destinationId,
      transportId: transport.id, arrivalAt: new Date("2026-09-24T07:00:00Z") } as never)).toMatchObject({
      ok: false, error: { tag: "ValidationError" },
    });
    expect(replaceTransport).not.toHaveBeenCalled();
  });

  it("does not update a transport found outside the requested Trip", async () => {
    const replaceTransport = vi.fn();
    const deps = { members: { findByTripAndUser: async () => ok(member) }, journeys: journeyStub({
      findDestination: async () => ok(destination), findTransport: async () => ok({ ...transport, tripId: otherTripId }), replaceTransport,
    }), createId: () => transport.id } as never;
    expect(await updateJourneyTransport.execute(deps, { authenticatedUserId: actorId, tripId, destinationId,
      transportId: transport.id, arrivalPlace: "Nuevo destino" } as never)).toMatchObject({
      ok: false, error: { tag: "TransportNotFoundError" },
    });
    expect(replaceTransport).not.toHaveBeenCalled();
  });
});

describe("transport cost currency", () => {
  const context = { authenticatedUserId: actorId, tripId, destinationId, transportId: transport.id };
  const setup = (stored: Transport = transport) => {
    const insertTransport = vi.fn(async (value: Transport) => ok(value));
    const replaceTransport = vi.fn(async (value: Transport) => ok(value));
    const replaceItineraryDays = vi.fn(async () => ok(undefined));
    const deps = { members: { findByTripAndUser: async () => ok(member) }, journeys: journeyStub({
      findDestination: async () => ok(destination), findTransport: async () => ok(stored), insertTransport, replaceTransport, replaceItineraryDays,
    }), createId: () => transport.id } as never;
    return { deps, insertTransport, replaceTransport, replaceItineraryDays };
  };
  const previous: Transport = { ...transport, costPerPerson: 80, costCurrency: null };
  const priced: Transport = { ...transport, costPerPerson: 80, costCurrency: "USD" };

  it("rejects a new cost without currency without inserting or regenerating", async () => {
    const { deps, insertTransport, replaceItineraryDays } = setup();
    const result = await createJourneyTransport.execute(deps, { ...transport, authenticatedUserId: actorId, costPerPerson: 10, costCurrency: undefined });
    expect(result).toMatchObject({ ok: false, error: { tag: "ValidationError", issues: [{ field: "costCurrency" }] } });
    expect(insertTransport).not.toHaveBeenCalled();
    expect(replaceItineraryDays).not.toHaveBeenCalled();
  });

  it("creates a transport with cost and currency", async () => {
    const { deps, insertTransport } = setup();
    const result = await createJourneyTransport.execute(deps, { ...transport, authenticatedUserId: actorId, costPerPerson: 10, costCurrency: "EUR" });
    expect(result).toEqual(ok({ ...transport, costPerPerson: 10, costCurrency: "EUR" }));
    expect(insertTransport).toHaveBeenCalledTimes(1);
  });

  it("requires a currency when a previous cost without one is edited", async () => {
    const { deps, replaceTransport, replaceItineraryDays } = setup(previous);
    expect(await updateJourneyTransport.execute(deps, { ...context, costPerPerson: 90 } as never))
      .toMatchObject({ ok: false, error: { issues: [{ field: "costCurrency", code: "required" }] } });
    expect(await updateJourneyTransport.execute(deps, { ...context, arrivalPlace: "Otro" } as never))
      .toMatchObject({ ok: false, error: { issues: [{ field: "costCurrency", code: "required" }] } });
    expect(replaceTransport).not.toHaveBeenCalled();
    expect(replaceItineraryDays).not.toHaveBeenCalled();
  });

  it("accepts choosing the currency of a previous cost", async () => {
    const { deps, replaceTransport } = setup(previous);
    expect(await updateJourneyTransport.execute(deps, { ...context, costCurrency: "ARS" } as never)).toEqual(ok({ ...previous, costCurrency: "ARS" }));
    expect(replaceTransport).toHaveBeenCalledTimes(1);
  });

  it("changes cost and currency together", async () => {
    const { deps } = setup(priced);
    expect(await updateJourneyTransport.execute(deps, { ...context, costPerPerson: 5, costCurrency: "EUR" } as never))
      .toEqual(ok({ ...priced, costPerPerson: 5, costCurrency: "EUR" }));
  });

  it("clears the currency when the cost is removed", async () => {
    const { deps } = setup(priced);
    expect(await updateJourneyTransport.execute(deps, { ...context, costPerPerson: null } as never))
      .toEqual(ok({ ...priced, costPerPerson: null, costCurrency: null }));
  });

  it("rejects a currency sent while removing the cost", async () => {
    const { deps, replaceTransport } = setup(priced);
    expect(await updateJourneyTransport.execute(deps, { ...context, costPerPerson: null, costCurrency: "USD" } as never))
      .toMatchObject({ ok: false, error: { issues: [{ field: "costCurrency", code: "invalid" }] } });
    expect(replaceTransport).not.toHaveBeenCalled();
  });

  it("keeps the stored currency when other fields change", async () => {
    const { deps } = setup(priced);
    expect(await updateJourneyTransport.execute(deps, { ...context, arrivalPlace: "Otro" } as never))
      .toEqual(ok({ ...priced, arrivalPlace: "Otro" }));
  });

  it("requires a currency when a cost is added to a transport without one", async () => {
    const { deps } = setup(transport);
    expect(await updateJourneyTransport.execute(deps, { ...context, costPerPerson: 5 } as never))
      .toMatchObject({ ok: false, error: { issues: [{ field: "costCurrency" }] } });
  });
});

describe("transport cost limits (T133)", () => {
  const context = { authenticatedUserId: actorId, tripId, destinationId, transportId: transport.id };
  const setup = (stored: Transport = transport) => {
    const insertTransport = vi.fn(async (value: Transport) => ok(value));
    const replaceTransport = vi.fn(async (value: Transport) => ok(value));
    const deps = { members: { findByTripAndUser: async () => ok(member) }, journeys: journeyStub({
      findDestination: async () => ok(destination), findTransport: async () => ok(stored), insertTransport, replaceTransport,
    }), createId: () => transport.id } as never;
    return { deps, insertTransport, replaceTransport };
  };
  it.each([0, -1, 1000000000000, 1.001])("rejects creating with the cost %s without inserting", async (cost) => {
    const { deps, insertTransport } = setup();
    const result = await createJourneyTransport.execute(deps, { ...transport, authenticatedUserId: actorId, costPerPerson: cost, costCurrency: "USD" });
    expect(result).toMatchObject({ ok: false, error: { tag: "ValidationError", issues: [{ field: "costPerPerson" }] } });
    expect(insertTransport).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1000000000000, 1.001])("rejects editing to the cost %s without replacing", async (cost) => {
    const { deps, replaceTransport } = setup({ ...transport, costPerPerson: 10, costCurrency: "USD" });
    const result = await updateJourneyTransport.execute(deps, { ...context, costPerPerson: cost } as never);
    expect(result).toMatchObject({ ok: false, error: { tag: "ValidationError", issues: [{ field: "costPerPerson" }] } });
    expect(replaceTransport).not.toHaveBeenCalled();
  });
  it("edits other fields of a stored transport whose cost is outside the rule", async () => {
    const { deps, replaceTransport } = setup({ ...transport, costPerPerson: -5, costCurrency: "USD" });
    const result = await updateJourneyTransport.execute(deps, { ...context, arrivalPlace: "Otro" } as never);
    expect(result.ok).toBe(true);
    expect(replaceTransport).toHaveBeenCalledWith(expect.objectContaining({ arrivalPlace: "Otro", costPerPerson: -5 }));
  });
  it("still clears the cost and currency with null", async () => {
    const { deps } = setup({ ...transport, costPerPerson: -5, costCurrency: "USD" });
    expect(await updateJourneyTransport.execute(deps, { ...context, costPerPerson: null } as never))
      .toEqual(ok({ ...transport, costPerPerson: null, costCurrency: null }));
  });
});
