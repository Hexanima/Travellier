import { describe, expect, it, vi } from "vitest";

import { createTripManagementApi } from "./trip-management-api.js";
import { createHttpClient } from "../api/http-client.js";

const trip = {
  id: "507f191e810c19729de860ea",
  name: "Patagonia",
  description: null,
  primaryDestination: { name: "Bariloche" },
};

const configuredTrip = {
  ...trip,
  visibility: "private",
  inviteCode: "VIAJE-X7K2",
  expenseMode: "register",
};

describe("createTripManagementApi", () => {
  it.each([{}, { votingEnabled: true }])("accepts a member without voting settings and tolerates a legacy votingEnabled: %j", async (legacy) => {
    const memberTrip = { ...configuredTrip, ...legacy };
    const get = vi.fn().mockResolvedValue({ ok: true, value: { trip: memberTrip } });
    const api = createTripManagementApi({ get } as never);
    expect(await api.get(trip.id)).toEqual({ ok: true, value: { ...memberTrip, kind: "member" } });
  });
  it("sends only supported configuration fields", async () => {
    const patch = vi.fn().mockResolvedValue({ ok: true, value: { trip: configuredTrip } });
    await createTripManagementApi({ patch } as never).updateConfiguration(trip.id, { visibility: "public", expenseMode: "balance" });
    expect(patch).toHaveBeenCalledWith(`/trips/${trip.id}/config`, { visibility: "public", expenseMode: "balance" });
  });
  it("deletes a Trip through authenticated HTTP and preserves permission failures", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "Forbidden" } }), { status: 403 }));
    const api = createTripManagementApi(createHttpClient({ baseUrl: "https://api.example.test", fetch,
      getAccessToken: async () => "access", onUnauthorized: vi.fn() }));
    expect(await api.deleteTrip(trip.id)).toEqual({ ok: true, value: undefined });
    expect(fetch).toHaveBeenCalledWith(`https://api.example.test/trips/${trip.id}`,
      expect.objectContaining({ method: "DELETE", headers: expect.objectContaining({ Authorization: "Bearer access" }) }));
    expect(await api.deleteTrip(trip.id)).toEqual({ ok: false, error: { kind: "forbidden" } });
  });
  it("loads the authenticated user's Trips", async () => {
    const get = vi.fn().mockResolvedValue({ ok: true, value: { trips: [trip] } });
    const api = createTripManagementApi({ get, post: vi.fn() } as never);

    expect(await api.list()).toEqual({ ok: true, value: [{ ...trip, startAt: null, endAt: null }] });
    expect(get).toHaveBeenCalledWith("/trips");
  });

  it("tolerates the additive startAt/endAt of the Trip list, as ISO strings or null", async () => {
    const dated = { ...trip, startAt: "2026-10-01T10:00:00.123Z", endAt: "2026-10-09T12:00:00.999Z" };
    const undated = { ...trip, id: "507f191e810c19729de860eb", startAt: null, endAt: null };
    const get = vi.fn().mockResolvedValue({ ok: true, value: { trips: [dated, undated] } });
    const api = createTripManagementApi({ get, post: vi.fn() } as never);

    expect(await api.list()).toEqual({ ok: true, value: [dated, undated] });
  });

  it("normalizes missing or invalid startAt/endAt of the Trip list to null without failing the list", async () => {
    const listWith = async (extra: Record<string, unknown>) => {
      const get = vi.fn().mockResolvedValue({ ok: true, value: { trips: [{ ...trip, ...extra }] } });
      return createTripManagementApi({ get } as never).list();
    };
    const dates = (result: Awaited<ReturnType<typeof listWith>>) => result.ok ? { startAt: result.value[0]?.startAt, endAt: result.value[0]?.endAt } : result;

    expect(dates(await listWith({}))).toEqual({ startAt: null, endAt: null });
    for (const bad of ["", "x", 5, {}, true, "2026-13-45"]) {
      expect(dates(await listWith({ startAt: bad, endAt: bad }))).toEqual({ startAt: null, endAt: null });
    }
    expect(dates(await listWith({ startAt: "2026-10-01T10:00:00.000Z" }))).toEqual({ startAt: "2026-10-01T10:00:00.000Z", endAt: null });
  });

  it("canonicalizes valid startAt/endAt of the Trip list to ISO UTC instants", async () => {
    const get = vi.fn().mockResolvedValue({ ok: true, value: { trips: [{ ...trip, startAt: "2026-10-01T07:00:00-03:00", endAt: "2026-10-09T12:00:00Z" }] } });
    const result = await createTripManagementApi({ get } as never).list();
    expect(result).toEqual({ ok: true, value: [{ ...trip, startAt: "2026-10-01T10:00:00.000Z", endAt: "2026-10-09T12:00:00.000Z" }] });
  });

  it("does not add dates to the created or detailed Trip", async () => {
    const post = vi.fn().mockResolvedValue({ ok: true, value: { trip } });
    const get = vi.fn().mockResolvedValue({ ok: true, value: { trip: configuredTrip } });
    const api = createTripManagementApi({ get, post } as never);
    expect(await api.create({ name: "Patagonia", primaryDestination: "Bariloche" })).toEqual({ ok: true, value: trip });
    expect(await api.get(trip.id)).toEqual({ ok: true, value: { ...configuredTrip, kind: "member" } });
  });

  it("loads only limited public Trip previews", async () => {
    const publicTrip = { ...trip, visibility: "public" };
    const get = vi.fn().mockResolvedValue({ ok: true, value: { trips: [publicTrip] } });
    const api = createTripManagementApi({ get, post: vi.fn() } as never);

    expect(await api.listPublic?.()).toEqual({ ok: true, value: [{ ...publicTrip, kind: "public" }] });
    expect(get).toHaveBeenCalledWith("/trips/public");
  });

  it("does not accept private Trips or extra member fields in discovery", async () => {
    const get = vi.fn().mockResolvedValue({ ok: true, value: { trips: [
      { ...trip, visibility: "private" },
      { ...trip, visibility: "public", inviteCode: "VIAJE-SECRET" },
    ] } });
    const api = createTripManagementApi({ get, post: vi.fn() } as never);

    expect(await api.listPublic?.()).toEqual({ ok: false, error: { kind: "server" } });
  });

  it("joins a public Trip by ID and validates the response", async () => {
    const post = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: { tripId: trip.id, joined: true } })
      .mockResolvedValueOnce({ ok: true, value: { tripId: trip.id, joined: "yes" } });
    const api = createTripManagementApi({ get: vi.fn(), post } as never);

    expect(await api.joinPublic?.(trip.id)).toEqual({ ok: true, value: { tripId: trip.id, joined: true } });
    expect(post).toHaveBeenCalledWith(`/trips/${trip.id}/join`);
    expect(await api.joinPublic?.(trip.id)).toEqual({ ok: false, error: { kind: "server" } });
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

  it("requires an invitation code for a member Trip", async () => {
    const withoutCode = Object.fromEntries(Object.entries(configuredTrip).filter(([key]) => key !== "inviteCode"));
    const get = vi.fn().mockResolvedValue({ ok: true, value: { trip: withoutCode } });
    const api = createTripManagementApi({ get, post: vi.fn(), patch: vi.fn() } as never);

    expect(await api.get(trip.id)).toEqual({ ok: false, error: { kind: "server" } });
  });

  it("updates only supported configuration fields", async () => {
    const patch = vi.fn().mockResolvedValue({ ok: true, value: { trip: { ...configuredTrip, visibility: "public", expenseMode: "balance" } } });
    const api = createTripManagementApi({ get: vi.fn(), post: vi.fn(), patch } as never);
    const input = { visibility: "public" as const, expenseMode: "balance" as const };

    expect(await api.updateConfiguration(trip.id, input)).toEqual({
      ok: true,
      value: { ...configuredTrip, ...input, kind: "member" },
    });
    expect(patch).toHaveBeenCalledWith(`/trips/${trip.id}/config`, { visibility: input.visibility, expenseMode: input.expenseMode });
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
