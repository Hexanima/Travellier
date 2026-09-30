import { describe, expect, it, vi } from "vitest";

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
});
