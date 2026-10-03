import { describe, expect, it, vi } from "vitest";
import { err, ItineraryConflictError, ok } from "app-domain";
import { handleApiRequest } from "../app.js";

const actor = "507f1f77bcf86cd799439011";
const trip = "507f191e810c19729de860ea";
const destination = "507f1f77bcf86cd799439013";
const transport = "507f1f77bcf86cd799439014";

describe("destination and transport routes", () => {
  it("returns a specific 409 for incompatible itinerary mutations", async () => {
    const updateTransport = vi.fn().mockResolvedValue(err(new ItineraryConflictError()));
    const response = await handleApiRequest({ method: "PATCH", url: `/trips/${trip}/destinations/${destination}/transports/${transport}`,
      authenticatedUserId: actor as never, body: JSON.stringify({ arrivalAt: "2026-09-25T12:00:00Z" }) },
    { trips: { updateTransport } } as never);
    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body)).toMatchObject({ error: { code: "ItineraryConflictError" } });
  });
  it("creates and lists destinations with the JWT actor and path Trip", async () => {
    const createDestination = vi.fn().mockResolvedValue(ok({ id: destination, tripId: trip, name: "Córdoba", order: 2 }));
    const listDestinations = vi.fn().mockResolvedValue(ok([{ id: destination, tripId: trip, name: "Córdoba", order: 2 }]));
    const dependencies = { trips: { createDestination, listDestinations } } as never;
    const request = { method: "POST", url: `/trips/${trip}/destinations`, body: JSON.stringify({ name: "Córdoba", tripId: "spoofed", order: 99 }) };
    expect((await handleApiRequest(request, dependencies)).statusCode).toBe(401);
    expect((await handleApiRequest({ ...request, authenticatedUserId: actor as never }, dependencies)).statusCode).toBe(201);
    expect(createDestination).toHaveBeenCalledWith({ authenticatedUserId: actor, tripId: trip, name: "Córdoba" });
    const listed = await handleApiRequest({ method: "GET", url: `/trips/${trip}/destinations`, authenticatedUserId: actor as never }, dependencies);
    expect(JSON.parse(listed.body)).toEqual({ destinations: [{ id: destination, tripId: trip, name: "Córdoba", order: 2 }] });
    expect(listDestinations).toHaveBeenCalledWith({ authenticatedUserId: actor, tripId: trip });
  });

  it("updates destination name and position within the path Trip", async () => {
    const updateDestination = vi.fn().mockResolvedValue(ok({ id: destination, tripId: trip, name: "Carlos Paz", order: 1 }));
    const response = await handleApiRequest({ method: "PATCH", url: `/trips/${trip}/destinations/${destination}`, authenticatedUserId: actor as never,
      body: JSON.stringify({ name: "Carlos Paz", order: 1, tripId: "spoofed" }) }, { trips: { updateDestination } } as never);
    expect(response.statusCode).toBe(200);
    expect(updateDestination).toHaveBeenCalledWith({ authenticatedUserId: actor, tripId: trip, destinationId: destination, name: "Carlos Paz", order: 1 });
  });

  it("creates, updates and lists transports scoped to both path IDs", async () => {
    const body = { direction: "outbound", type: "car", departurePlace: "Origen", departureAt: "2026-09-24T08:00:00.000Z",
      arrivalPlace: "Destino", arrivalAt: "2026-09-24T09:00:00.000Z", costPerPerson: null, details: {}, tripId: "spoofed" };
    const createTransport = vi.fn().mockResolvedValue(ok({ id: transport }));
    const updateTransport = vi.fn().mockResolvedValue(ok({ id: transport }));
    const listTransports = vi.fn().mockResolvedValue(ok([{ id: transport }]));
    const dependencies = { trips: { createTransport, updateTransport, listTransports } } as never;
    const base = `/trips/${trip}/destinations/${destination}/transports`;
    expect((await handleApiRequest({ method: "POST", url: base, authenticatedUserId: actor as never, body: JSON.stringify(body) }, dependencies)).statusCode).toBe(201);
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ authenticatedUserId: actor, tripId: trip, destinationId: destination, departureAt: new Date(body.departureAt) }));
    expect((await handleApiRequest({ method: "PATCH", url: `${base}/${transport}`, authenticatedUserId: actor as never, body: JSON.stringify(body) }, dependencies)).statusCode).toBe(200);
    expect(updateTransport).toHaveBeenCalledWith(expect.objectContaining({ authenticatedUserId: actor, tripId: trip, destinationId: destination, transportId: transport }));
    const listed = await handleApiRequest({ method: "GET", url: base, authenticatedUserId: actor as never }, dependencies);
    expect(JSON.parse(listed.body)).toEqual({ transports: [{ id: transport }] });
  });

  it("accepts a partial transport PATCH and rejects an empty update", async () => {
    const updateTransport = vi.fn().mockResolvedValue(ok({ id: transport, arrivalPlace: "Nuevo destino" }));
    const dependencies = { trips: { updateTransport } } as never;
    const url = `/trips/${trip}/destinations/${destination}/transports/${transport}`;
    const response = await handleApiRequest({ method: "PATCH", url, authenticatedUserId: actor as never,
      body: JSON.stringify({ arrivalPlace: "Nuevo destino" }) }, dependencies);
    expect(response.statusCode).toBe(200);
    expect(updateTransport).toHaveBeenCalledWith({ authenticatedUserId: actor, tripId: trip, destinationId: destination,
      transportId: transport, arrivalPlace: "Nuevo destino" });
    expect((await handleApiRequest({ method: "PATCH", url, authenticatedUserId: actor as never, body: "{}" }, dependencies)).statusCode).toBe(400);
    expect(updateTransport).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed route IDs before accessing data", async () => {
    const listDestinations = vi.fn();
    const listTransports = vi.fn();
    const dependencies = { trips: { listDestinations, listTransports } } as never;
    expect((await handleApiRequest({ method: "GET", url: "/trips/invalid/destinations", authenticatedUserId: actor as never }, dependencies)).statusCode).toBe(400);
    expect((await handleApiRequest({ method: "GET", url: `/trips/${trip}/destinations/invalid/transports`, authenticatedUserId: actor as never }, dependencies)).statusCode).toBe(400);
    expect(listDestinations).not.toHaveBeenCalled();
    expect(listTransports).not.toHaveBeenCalled();
  });
});
