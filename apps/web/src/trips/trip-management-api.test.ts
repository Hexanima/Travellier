import { describe, expect, it, vi } from "vitest";

import { createTripManagementApi } from "./trip-management-api.js";

const trip = {
  id: "507f191e810c19729de860ea",
  name: "Patagonia",
  description: null,
  primaryDestination: { name: "Bariloche" },
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
});
