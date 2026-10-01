import { describe, expect, it, vi } from "vitest";

import { TripMemberNotFoundError, TripNotFoundError, UnauthorizedError, ok } from "app-domain";
import { handleApiRequest } from "../app.js";

const actorId = "507f1f77bcf86cd799439011";
const tripId = "507f191e810c19729de860ea";
const trip = { id: tripId, name: "Patagonia", primaryDestination: { name: "Bariloche" } };

describe("Trip management routes", () => {
  it("lists members only for the authenticated trip member", async () => {
    const member = { id: "507f1f77bcf86cd799439013", userId: actorId, name: "Nico", role: "admin", joinedAt: "2026-09-24T12:00:00.000Z" };
    const listMembers = vi.fn().mockResolvedValue(ok([member]));
    const dependencies = { trips: { listMembers } } as never;
    const request = { method: "GET", url: `/trips/${tripId}/members`, body: { currentUserId: "spoofed" } };

    expect((await handleApiRequest(request, dependencies)).statusCode).toBe(401);
    const response = await handleApiRequest({ ...request, authenticatedUserId: actorId as never }, dependencies);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ members: [member], currentUserId: actorId });
    expect(listMembers).toHaveBeenCalledWith({ authenticatedUserId: actorId, tripId });
  });

  it("expels a participant using only the JWT actor and path IDs", async () => {
    const targetUserId = "507f1f77bcf86cd799439012";
    const expelMember = vi.fn().mockResolvedValue(ok(undefined));
    const dependencies = { trips: { expelMember } } as never;
    const request = { method: "DELETE", url: `/trips/${tripId}/members/${targetUserId}`, body: { actorUserId: targetUserId } };

    expect((await handleApiRequest(request, dependencies)).statusCode).toBe(401);
    const response = await handleApiRequest({ ...request, authenticatedUserId: actorId as never }, dependencies);
    expect(response.statusCode).toBe(204);
    expect(expelMember).toHaveBeenCalledWith({ tripId, actorUserId: actorId, targetUserId });
  });

  it("does not expose members of a trip to an outsider", async () => {
    const listMembers = vi.fn().mockResolvedValue({ ok: false, error: new TripNotFoundError() });
    const response = await handleApiRequest(
      { method: "GET", url: `/trips/${tripId}/members`, authenticatedUserId: actorId as never },
      { trips: { listMembers } } as never,
    );
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("members");
  });

  it("rejects participant expulsions and reports a missing target", async () => {
    const expelMember = vi.fn().mockResolvedValueOnce({ ok: false, error: new UnauthorizedError() })
      .mockResolvedValueOnce({ ok: false, error: new TripMemberNotFoundError() });
    const request = { method: "DELETE", url: `/trips/${tripId}/members/507f1f77bcf86cd799439012`, authenticatedUserId: actorId as never };
    const dependencies = { trips: { expelMember } } as never;
    expect((await handleApiRequest(request, dependencies)).statusCode).toBe(403);
    expect((await handleApiRequest(request, dependencies)).statusCode).toBe(404);
  });

  it("rejects invalid member route IDs before reading memberships", async () => {
    const listMembers = vi.fn();
    const expelMember = vi.fn();
    const dependencies = { trips: { listMembers, expelMember } } as never;
    const authenticatedUserId = actorId as never;
    expect((await handleApiRequest({ method: "GET", url: "/trips/not-an-id/members", authenticatedUserId }, dependencies)).statusCode).toBe(400);
    expect((await handleApiRequest({ method: "DELETE", url: `/trips/${tripId}/members/not-an-id`, authenticatedUserId }, dependencies)).statusCode).toBe(400);
    expect(listMembers).not.toHaveBeenCalled();
    expect(expelMember).not.toHaveBeenCalled();
  });

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

  it("lists public trip previews for an authenticated user", async () => {
    const preview = { id: tripId, name: "Patagonia", description: null, visibility: "public", primaryDestination: { name: "Bariloche" } };
    const listPublic = vi.fn().mockResolvedValue(ok([preview]));
    const dependencies = { trips: { listPublic } } as never;
    expect((await handleApiRequest({ method: "GET", url: "/trips/public" }, dependencies)).statusCode).toBe(401);
    const response = await handleApiRequest({ method: "GET", url: "/trips/public", authenticatedUserId: actorId as never }, dependencies);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ trips: [preview] });
    expect(listPublic).toHaveBeenCalledWith({ authenticatedUserId: actorId });
  });

  it("joins a public trip using the JWT user and path ID", async () => {
    const joinPublic = vi.fn().mockResolvedValue(ok({ tripId, joined: true }));
    const dependencies = { trips: { joinPublic } } as never;
    const request = { method: "POST", url: `/trips/${tripId}/join`, body: { authenticatedUserId: "spoofed" } };
    expect((await handleApiRequest(request, dependencies)).statusCode).toBe(401);
    const response = await handleApiRequest({ ...request, authenticatedUserId: actorId as never }, dependencies);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ tripId, joined: true });
    expect(joinPublic).toHaveBeenCalledWith({ authenticatedUserId: actorId, tripId });
    expect((await handleApiRequest({ method: "POST", url: "/trips/not-an-id/join", authenticatedUserId: actorId as never }, dependencies)).statusCode).toBe(400);
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
