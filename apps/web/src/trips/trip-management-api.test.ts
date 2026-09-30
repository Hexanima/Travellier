import { describe, expect, it, vi } from "vitest";

import { createTripManagementApi } from "./trip-management-api.js";

const trip = {
  id: "507f191e810c19729de860ea",
  name: "Patagonia",
  description: null,
  primaryDestination: { name: "Bariloche" },
};

const configuredTrip = {
  ...trip,
  visibility: "private",
  votingEnabled: false,
  expenseMode: "register",
};

describe("createTripManagementApi", () => {
  it("loads the authenticated user's Trips", async () => {
    const get = vi.fn().mockResolvedValue({ ok: true, value: { trips: [trip] } });
    const api = createTripManagementApi({ get, post: vi.fn() } as never);

    expect(await api.list()).toEqual({ ok: true, value: [trip] });
    expect(get).toHaveBeenCalledWith("/trips");
  });

  it("creates a Trip without sending dates", async () => {
    const post = vi.fn().mockResolvedValue({ ok: true, value: { trip } });
    const api = createTripManagementApi({ get: vi.fn(), post } as never);

    expect(await api.create({ name: "Patagonia", primaryDestination: "Bariloche" })).toEqual({ ok: true, value: trip });
    expect(post).toHaveBeenCalledWith("/trips", { name: "Patagonia", primaryDestination: "Bariloche" });
  });

  it("keeps field validation errors for the creation form", async () => {
    const post = vi.fn().mockResolvedValue({ ok: false, error: {
      kind: "validation", fields: [{ field: "name", code: "required", message: "Trip name is required." }],
    } });
    const api = createTripManagementApi({ get: vi.fn(), post } as never);

    expect(await api.create({ name: "", primaryDestination: "Bariloche" })).toEqual({
      ok: false, error: { kind: "validation", fields: [{ field: "name", message: "Trip name is required." }] },
    });
  });

  it("rejects malformed success responses", async () => {
    const api = createTripManagementApi({
      get: vi.fn().mockResolvedValue({ ok: true, value: { trips: [{ id: "1" }] } }),
      post: vi.fn().mockResolvedValue({ ok: true, value: { trip: { name: "Patagonia" } } }),
    } as never);

    expect(await api.list()).toEqual({ ok: false, error: { kind: "server" } });
    expect(await api.create({ name: "Patagonia", primaryDestination: "Bariloche" })).toEqual({ ok: false, error: { kind: "server" } });
  });

  it("loads member configuration and a limited public preview", async () => {
    const get = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: { trip: configuredTrip } })
      .mockResolvedValueOnce({ ok: true, value: { trip: { ...trip, visibility: "public" } } });
    const api = createTripManagementApi({ get, post: vi.fn(), patch: vi.fn() } as never);

    expect(await api.get(trip.id)).toEqual({ ok: true, value: { ...configuredTrip, kind: "member" } });
    expect(await api.get(trip.id)).toEqual({ ok: true, value: { ...trip, visibility: "public", kind: "public" } });
    expect(get).toHaveBeenCalledWith(`/trips/${trip.id}`);
  });

  it("rejects a malformed configuration response", async () => {
    const get = vi.fn().mockResolvedValue({ ok: true, value: { trip: { ...configuredTrip, expenseMode: "unknown" } } });
    const api = createTripManagementApi({ get, post: vi.fn(), patch: vi.fn() } as never);

    expect(await api.get(trip.id)).toEqual({ ok: false, error: { kind: "server" } });
  });

  it("updates only the three configuration fields", async () => {
    const patch = vi.fn().mockResolvedValue({ ok: true, value: { trip: { ...configuredTrip, visibility: "public", votingEnabled: true, expenseMode: "balance" } } });
    const api = createTripManagementApi({ get: vi.fn(), post: vi.fn(), patch } as never);
    const input = { visibility: "public" as const, votingEnabled: true, expenseMode: "balance" as const };

    expect(await api.updateConfiguration(trip.id, input)).toEqual({
      ok: true,
      value: { ...configuredTrip, ...input, kind: "member" },
    });
    expect(patch).toHaveBeenCalledWith(`/trips/${trip.id}/config`, input);
  });

  it("preserves validation errors when an update is rejected", async () => {
    const patch = vi.fn().mockResolvedValue({ ok: false, error: {
      kind: "validation", fields: [{ field: "expenseMode", code: "invalid", message: "Invalid expense mode." }],
    } });
    const api = createTripManagementApi({ get: vi.fn(), post: vi.fn(), patch } as never);

    expect(await api.updateConfiguration(trip.id, { expenseMode: "balance" })).toEqual({
      ok: false,
      error: { kind: "validation", fields: [{ field: "expenseMode", message: "Invalid expense mode." }] },
    });
  });
});
