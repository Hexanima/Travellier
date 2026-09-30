import { describe, expect, it, vi } from "vitest";

import { TripNotFoundError, ok } from "app-domain";
import { handleApiRequest } from "../app.js";

const actorId = "507f1f77bcf86cd799439011";
const tripId = "507f191e810c19729de860ea";
const trip = { id: tripId, name: "Patagonia", primaryDestination: { name: "Bariloche" } };

describe("Trip management routes", () => {
  it("creates a trip for the JWT user and ignores body user IDs", async () => {
    const create = vi.fn().mockResolvedValue(ok(trip));
    const request = {
      method: "POST", url: "/trips",
      body: JSON.stringify({ name: "Patagonia", primaryDestination: "Bariloche", description: "Lagos", userId: "other" }),
    };
    const dependencies = { trips: { create } } as never;
    expect((await handleApiRequest(request, dependencies)).statusCode).toBe(401);
    const response = await handleApiRequest({ ...request, authenticatedUserId: actorId as never }, dependencies);
    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body)).toEqual({ trip });
    expect(create).toHaveBeenCalledWith({ authenticatedUserId: actorId, name: "Patagonia", primaryDestination: "Bariloche", description: "Lagos" });
  });

  it("lists only trips for the authenticated user", async () => {
    const list = vi.fn().mockResolvedValue(ok([trip]));
    const dependencies = { trips: { list } } as never;
    expect((await handleApiRequest({ method: "GET", url: "/trips" }, dependencies)).statusCode).toBe(401);
    const response = await handleApiRequest({ method: "GET", url: "/trips", authenticatedUserId: actorId as never }, dependencies);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ trips: [trip] });
    expect(list).toHaveBeenCalledWith({ authenticatedUserId: actorId });
  });

  it("returns 404 for a private stranger's trip without exposing its data", async () => {
    const get = vi.fn().mockResolvedValue({ ok: false, error: new TripNotFoundError() });
    const response = await handleApiRequest({ method: "GET", url: `/trips/${tripId}`, authenticatedUserId: actorId as never }, { trips: { get } } as never);
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("Patagonia");
    expect(get).toHaveBeenCalledWith({ authenticatedUserId: actorId, tripId });
  });

  it("updates only configuration for the authenticated member", async () => {
    const updateConfiguration = vi.fn().mockResolvedValue(ok({ ...trip, visibility: "public" }));
    const request = {
      method: "PATCH", url: `/trips/${tripId}/config`,
      body: JSON.stringify({ visibility: "public", votingEnabled: true, expenseMode: "balance", createdBy: "other" }),
    };
    const dependencies = { trips: { updateConfiguration } } as never;
    expect((await handleApiRequest(request, dependencies)).statusCode).toBe(401);
    const response = await handleApiRequest({ ...request, authenticatedUserId: actorId as never }, dependencies);
    expect(response.statusCode).toBe(200);
    expect(updateConfiguration).toHaveBeenCalledWith({ authenticatedUserId: actorId, tripId, visibility: "public", votingEnabled: true, expenseMode: "balance" });
    expect(JSON.parse(response.body)).toEqual({ trip: { ...trip, visibility: "public" } });
  });

  it("rejects malformed creation, configuration and trip IDs", async () => {
    const create = vi.fn();
    const updateConfiguration = vi.fn();
    const get = vi.fn();
    const dependencies = { trips: { create, updateConfiguration, get } } as never;
    expect((await handleApiRequest({ method: "POST", url: "/trips", authenticatedUserId: actorId as never, body: { name: "Patagonia" } }, dependencies)).statusCode).toBe(400);
    expect((await handleApiRequest({ method: "PATCH", url: `/trips/${tripId}/config`, authenticatedUserId: actorId as never, body: { visibility: 1 } }, dependencies)).statusCode).toBe(400);
    expect((await handleApiRequest({ method: "GET", url: "/trips/not-an-id", authenticatedUserId: actorId as never }, dependencies)).statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
    expect(updateConfiguration).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });
});
