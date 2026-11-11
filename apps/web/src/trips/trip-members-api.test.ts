import { describe, expect, it, vi } from "vitest";

import { createHttpClient } from "../api/index.js";
import { createTripMembersApi } from "./trip-members-api.js";

const tripId = "507f191e810c19729de860ea";
const userId = "507f1f77bcf86cd799439011";
const member = { id: "507f1f77bcf86cd799439013", userId, name: "Nico", role: "admin", joinedAt: "2026-09-24T12:00:00.000Z" };

describe("createTripMembersApi", () => {
  it("reads members and identifies the authenticated viewer", async () => {
    const get = vi.fn().mockResolvedValue({ ok: true, value: { members: [member], currentUserId: userId } });
    const api = createTripMembersApi({ get, delete: vi.fn() } as never);

    expect(await api.list(tripId)).toEqual({ ok: true, value: { members: [member], currentUserId: userId } });
    expect(get).toHaveBeenCalledWith(`/trips/${tripId}/members`);
  });

  it("rejects a malformed member list", async () => {
    const get = vi.fn().mockResolvedValue({ ok: true, value: { members: [{ ...member, role: "owner" }], currentUserId: userId } });
    const api = createTripMembersApi({ get, delete: vi.fn() } as never);

    expect(await api.list(tripId)).toEqual({ ok: false, error: { kind: "server" } });
  });

  it("deletes a participant by user ID and accepts the empty 204 response", async () => {
    const remove = vi.fn().mockResolvedValue({ ok: true, value: undefined });
    const api = createTripMembersApi({ get: vi.fn(), delete: remove } as never);

    expect(await api.expel(tripId, userId)).toEqual({ ok: true, value: undefined });
    expect(remove).toHaveBeenCalledWith(`/trips/${tripId}/members/${userId}`);
  });

  it("passes a forbidden response to the screen", async () => {
    const remove = vi.fn().mockResolvedValue({ ok: false, error: { kind: "forbidden" } });
    const api = createTripMembersApi({ get: vi.fn(), delete: remove } as never);

    expect(await api.expel(tripId, userId)).toEqual({ ok: false, error: { kind: "forbidden" } });
  });

  it("accepts members without a name", async () => {
    const nameless = { ...member, name: null };
    const get = vi.fn().mockResolvedValue({ ok: true, value: { members: [nameless], currentUserId: userId } });
    const api = createTripMembersApi({ get, delete: vi.fn() } as never);

    expect(await api.list(tripId)).toEqual({ ok: true, value: { members: [nameless], currentUserId: userId } });
  });

  it("exposes the owner marker and ownerId, tolerating their absence", async () => {
    const owner = { ...member, isOwner: true };
    const get = vi.fn().mockResolvedValue({ ok: true, value: { members: [owner], currentUserId: userId, ownerId: userId } });
    const api = createTripMembersApi({ get, delete: vi.fn() } as never);
    expect(await api.list(tripId)).toEqual({ ok: true, value: { members: [owner], currentUserId: userId, ownerId: userId } });
    get.mockResolvedValue({ ok: true, value: { members: [owner], currentUserId: userId, ownerId: null } });
    expect(await api.list(tripId)).toEqual({ ok: true, value: { members: [owner], currentUserId: userId, ownerId: null } });
  });

  it("rejects a malformed owner marker", async () => {
    const get = vi.fn().mockResolvedValue({ ok: true, value: { members: [{ ...member, isOwner: "yes" }], currentUserId: userId } });
    const api = createTripMembersApi({ get, delete: vi.fn() } as never);
    expect(await api.list(tripId)).toEqual({ ok: false, error: { kind: "server" } });
  });

  it("changes a role with PUT and the 204 response", async () => {
    const put = vi.fn().mockResolvedValue({ ok: true, value: undefined });
    const api = createTripMembersApi({ get: vi.fn(), delete: vi.fn(), put, post: vi.fn() } as never);
    expect(await api.setRole(tripId, userId, "admin")).toEqual({ ok: true, value: undefined });
    expect(put).toHaveBeenCalledWith(`/trips/${tripId}/members/${userId}/role`, { role: "admin" });
  });

  it("transfers ownership and leaves with POST", async () => {
    const post = vi.fn().mockResolvedValue({ ok: true, value: undefined });
    const api = createTripMembersApi({ get: vi.fn(), delete: vi.fn(), put: vi.fn(), post } as never);
    expect(await api.transferOwnership(tripId, userId)).toEqual({ ok: true, value: undefined });
    expect(post).toHaveBeenLastCalledWith(`/trips/${tripId}/transfer-ownership`, { userId });
    expect(await api.leave(tripId)).toEqual({ ok: true, value: undefined });
    expect(post).toHaveBeenLastCalledWith(`/trips/${tripId}/leave`);
  });

  it.each(["setRole", "transferOwnership", "leave", "expel"] as const)("%s propagates the kind and a specific error code only", async (method) => {
    const failure = (code: string) => vi.fn().mockResolvedValue({ ok: false, error: { kind: "conflict", code } });
    const call = (client: unknown) => {
      const api = createTripMembersApi(client as never);
      return method === "setRole" ? api.setRole(tripId, userId, "admin") : method === "transferOwnership" ? api.transferOwnership(tripId, userId)
        : method === "leave" ? api.leave(tripId) : api.expel(tripId, userId);
    };
    const client = (code: string) => ({ get: vi.fn(), delete: failure(code), put: failure(code), post: failure(code) });
    expect(await call(client("TripOwnerProtectedError"))).toEqual({ ok: false, error: { kind: "conflict", code: "TripOwnerProtectedError" } });
    expect(await call(client("HttpError"))).toEqual({ ok: false, error: { kind: "conflict" } });
  });

  it("surfaces same_owner from the real 422 ValidationError body of transfer-ownership", async () => {
    const body = { error: { code: "ValidationError", message: "Validation failed", fields: [{ field: "userId", code: "same_owner", message: "La persona ya es titular." }] } };
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 422, headers: { "content-type": "application/json" } }));
    const client = createHttpClient({ baseUrl: "https://api.test", fetch, getAccessToken: async () => "t", onUnauthorized: () => undefined });
    const api = createTripMembersApi(client);
    expect(await api.transferOwnership(tripId, userId)).toEqual({ ok: false, error: { kind: "validation", code: "same_owner" } });
  });

  it("keeps a 422 without same_owner as a plain validation failure", async () => {
    const body = { error: { code: "ValidationError", message: "x", fields: [{ field: "userId", code: "invalid", message: "x" }] } };
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 422 }));
    const client = createHttpClient({ baseUrl: "https://api.test", fetch, getAccessToken: async () => "t", onUnauthorized: () => undefined });
    const api = createTripMembersApi(client);
    expect(await api.transferOwnership(tripId, userId)).toEqual({ ok: false, error: { kind: "validation", code: "ValidationError" } });
  });
});
