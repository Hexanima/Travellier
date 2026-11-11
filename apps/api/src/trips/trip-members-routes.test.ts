import { describe, expect, it, vi } from "vitest";

import { TripMemberNotFoundError, TripNotFoundError, TripOwnerProtectedError, UnauthorizedError, ValidationError, ok } from "app-domain";
import { handleApiRequest } from "../app.js";

const actorId = "507f1f77bcf86cd799439011" as never;
const targetId = "507f1f77bcf86cd799439012";
const tripId = "507f191e810c19729de860ea";

const roleRequest = (body: unknown, overrides: Record<string, unknown> = {}) => ({
  method: "PUT", url: `/trips/${tripId}/members/${targetId}/role`, body, authenticatedUserId: actorId, ...overrides,
});
const transferRequest = (body: unknown, overrides: Record<string, unknown> = {}) => ({
  method: "POST", url: `/trips/${tripId}/transfer-ownership`, body, authenticatedUserId: actorId, ...overrides,
});

describe("Trip member administration routes", () => {
  it.each(["admin", "participant"])("changes a role to %s using only the JWT actor and path ids, answering 204 without body", async (role) => {
    const changeMemberRole = vi.fn().mockResolvedValue(ok(undefined));
    const dependencies = { trips: { changeMemberRole } } as never;
    const body = JSON.stringify({ role, actorUserId: "spoofed", userId: "spoofed" });
    const response = await handleApiRequest(roleRequest(body), dependencies);
    expect(response).toEqual({ statusCode: 204, headers: {}, body: "" });
    expect(changeMemberRole).toHaveBeenCalledWith({ tripId, actorUserId: actorId, targetUserId: targetId, role });
  });

  it("accepts an already parsed object body for the role", async () => {
    const changeMemberRole = vi.fn().mockResolvedValue(ok(undefined));
    expect((await handleApiRequest(roleRequest({ role: "admin" }), { trips: { changeMemberRole } } as never)).statusCode).toBe(204);
  });

  it("requires authentication", async () => {
    const changeMemberRole = vi.fn(), transferOwnership = vi.fn();
    const dependencies = { trips: { changeMemberRole, transferOwnership } } as never;
    expect((await handleApiRequest(roleRequest({ role: "admin" }, { authenticatedUserId: undefined }), dependencies)).statusCode).toBe(401);
    expect((await handleApiRequest(transferRequest({ userId: targetId }, { authenticatedUserId: undefined }), dependencies)).statusCode).toBe(401);
    expect(changeMemberRole).not.toHaveBeenCalled();
    expect(transferOwnership).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown role", JSON.stringify({ role: "owner" })],
    ["a missing role", JSON.stringify({})],
    ["a non-string role", JSON.stringify({ role: 1 })],
  ])("answers 422 for %s without calling the use case", async (_label, body) => {
    const changeMemberRole = vi.fn();
    const response = await handleApiRequest(roleRequest(body), { trips: { changeMemberRole } } as never);
    expect(response.statusCode).toBe(422);
    expect(JSON.parse(response.body)).toMatchObject({ error: { code: "ValidationError", fields: [{ field: "role" }] } });
    expect(changeMemberRole).not.toHaveBeenCalled();
  });

  it("answers 400 for a body that is not a JSON object", async () => {
    const changeMemberRole = vi.fn(), transferOwnership = vi.fn();
    const dependencies = { trips: { changeMemberRole, transferOwnership } } as never;
    expect((await handleApiRequest(roleRequest("nope"), dependencies)).statusCode).toBe(400);
    expect((await handleApiRequest(transferRequest("nope"), dependencies)).statusCode).toBe(400);
    expect(changeMemberRole).not.toHaveBeenCalled();
    expect(transferOwnership).not.toHaveBeenCalled();
  });

  it("answers 400 for invalid ids before using the use cases", async () => {
    const changeMemberRole = vi.fn(), transferOwnership = vi.fn();
    const dependencies = { trips: { changeMemberRole, transferOwnership } } as never;
    const role = JSON.stringify({ role: "admin" });
    expect((await handleApiRequest(roleRequest(role, { url: `/trips/not-an-id/members/${targetId}/role` }), dependencies)).statusCode).toBe(400);
    expect((await handleApiRequest(roleRequest(role, { url: `/trips/${tripId}/members/not-an-id/role` }), dependencies)).statusCode).toBe(400);
    expect((await handleApiRequest(transferRequest(JSON.stringify({ userId: targetId }), { url: "/trips/not-an-id/transfer-ownership" }), dependencies)).statusCode).toBe(400);
    expect((await handleApiRequest(transferRequest(JSON.stringify({ userId: "not-an-id" })), dependencies)).statusCode).toBe(400);
    expect(changeMemberRole).not.toHaveBeenCalled();
    expect(transferOwnership).not.toHaveBeenCalled();
  });

  it("maps the use case errors to 403, 404, 409 and 422", async () => {
    const failures = [new UnauthorizedError(), new TripNotFoundError(), new TripMemberNotFoundError(), new TripOwnerProtectedError(),
      new ValidationError([{ field: "userId", code: "same_owner", message: "The new owner must be another member." }])];
    const changeMemberRole = vi.fn(), transferOwnership = vi.fn();
    for (const failure of failures) { changeMemberRole.mockResolvedValueOnce({ ok: false, error: failure }); transferOwnership.mockResolvedValueOnce({ ok: false, error: failure }); }
    const dependencies = { trips: { changeMemberRole, transferOwnership } } as never;
    const roleStatuses: number[] = [], transferStatuses: number[] = [];
    for (let index = 0; index < failures.length; index += 1) {
      roleStatuses.push((await handleApiRequest(roleRequest(JSON.stringify({ role: "admin" })), dependencies)).statusCode);
      transferStatuses.push((await handleApiRequest(transferRequest(JSON.stringify({ userId: targetId })), dependencies)).statusCode);
    }
    expect(roleStatuses).toEqual([403, 404, 404, 409, 422]);
    expect(transferStatuses).toEqual(roleStatuses);
  });

  it("answers a generic 409 with its own code for the protected owner", async () => {
    const changeMemberRole = vi.fn().mockResolvedValue({ ok: false, error: new TripOwnerProtectedError() });
    const response = await handleApiRequest(roleRequest(JSON.stringify({ role: "participant" })), { trips: { changeMemberRole } } as never);
    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body)).toEqual({ error: { code: "TripOwnerProtectedError", message: "The Trip owner is protected." } });
  });

  it("transfers the ownership using only the JWT actor, answering 204 without body", async () => {
    const transferOwnership = vi.fn().mockResolvedValue(ok(undefined));
    const response = await handleApiRequest(transferRequest(JSON.stringify({ userId: targetId, actorUserId: "spoofed" })), { trips: { transferOwnership } } as never);
    expect(response).toEqual({ statusCode: 204, headers: {}, body: "" });
    expect(transferOwnership).toHaveBeenCalledWith({ tripId, actorUserId: actorId, targetUserId: targetId });
  });

  it("answers 422 when the transfer body has no userId string", async () => {
    const transferOwnership = vi.fn();
    const dependencies = { trips: { transferOwnership } } as never;
    expect((await handleApiRequest(transferRequest(JSON.stringify({})), dependencies)).statusCode).toBe(422);
    expect((await handleApiRequest(transferRequest(JSON.stringify({ userId: 5 })), dependencies)).statusCode).toBe(422);
    expect(transferOwnership).not.toHaveBeenCalled();
  });

  it("answers 503 when the dependency is missing", async () => {
    expect((await handleApiRequest(roleRequest(JSON.stringify({ role: "admin" })), { trips: {} } as never)).statusCode).toBe(503);
    expect((await handleApiRequest(transferRequest(JSON.stringify({ userId: targetId })), { trips: {} } as never)).statusCode).toBe(503);
  });

  it("does not let the expulsion route capture the role route", async () => {
    const expelMember = vi.fn(), changeMemberRole = vi.fn().mockResolvedValue(ok(undefined));
    const dependencies = { trips: { expelMember, changeMemberRole } } as never;
    expect((await handleApiRequest(roleRequest(JSON.stringify({ role: "admin" })), dependencies)).statusCode).toBe(204);
    expect((await handleApiRequest({ method: "DELETE", url: `/trips/${tripId}/members/${targetId}/role`, authenticatedUserId: actorId }, dependencies)).statusCode).not.toBe(204);
    expect(expelMember).not.toHaveBeenCalled();
  });
});
