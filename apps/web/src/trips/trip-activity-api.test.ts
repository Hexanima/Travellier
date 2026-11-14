import { describe, expect, it, vi } from "vitest";
import { createHttpClient } from "../api/index.js";
import { itineraryFixture, itineraryId } from "./itinerary-test-fixture.js";
import { createTripActivityApi } from "./trip-activity-api.js";

const activity = () => {
  const source = itineraryFixture().activities[0];
  const value: Omit<typeof source, "postIds"> & { postIds?: string[] } = { ...source };
  delete value.postIds;
  return value;
};
const input = { dayId: itineraryId(4), title: "Paseo", scheduledAt: "2026-09-25T12:00:00.123Z", description: null, mapsUrl: null };
const setup = (body: unknown, status = 200) => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  const onUnauthorized = vi.fn();
  const client = createHttpClient({ baseUrl: "https://api.test", fetch, getAccessToken: async () => "token", onUnauthorized });
  return { api: createTripActivityApi(client), fetch, onUnauthorized };
};

describe("activity HTTP adapter", () => {
  it("accepts the active activity contract without an approval status", async () => {
    const value = activity() as Omit<ReturnType<typeof activity>, "status"> & { status?: string };
    delete value.status;
    const { api } = setup({ activity: value });
    expect(await api.get(value.tripId, value.id)).toEqual({ ok: true, value });
  });
  it.each([{ status: "done" }, { status: "proposed" }, { status: 4 }, {}])("ignores a legacy approval status: %j", async (legacy) => {
    const value = { ...activity(), ...legacy };
    const { api } = setup({ activity: value });
    expect(await api.get(value.tripId, value.id)).toEqual({ ok: true, value });
  });
  it.each(["create", "get", "update"] as const)("authenticates %s and accepts the single activity response without postIds", async (operation) => {
    const value = activity();
    const { api, fetch } = setup({ activity: value }, operation === "create" ? 201 : 200);
    const result = operation === "create" ? await api.create(value.tripId, input)
      : operation === "get" ? await api.get(value.tripId, value.id) : await api.update(value.tripId, value.id, { description: null });
    expect(result).toEqual({ ok: true, value: operation === "create" ? { activity: value, participation: null } : value });
    const [url, request] = fetch.mock.calls[0];
    expect(url).toBe(`https://api.test/trips/${value.tripId}/activities${operation === "create" ? "" : `/${value.id}`}`);
    expect(request.method).toBe({ create: "POST", get: "GET", update: "PATCH" }[operation]);
    expect(request.headers.Authorization).toBe("Bearer token");
    if (operation !== "get") expect(JSON.parse(request.body)).toEqual(operation === "create" ? input : { description: null });
  });
  it.each([
    { tripId: itineraryId(99) }, { id: "bad" }, { dayId: "bad" }, { title: " " }, { scheduledAt: null },
    { scheduledAt: "2026-09-25T12:00:00+00:00" }, { createdAt: "bad" }, { mapsUrl: 4 },
  ])("rejects an invalid response: %j", async (change) => {
    const { api } = setup({ activity: { ...activity(), ...change } });
    expect(await api.create(itineraryId(1), input)).toEqual({ ok: false, error: { kind: "server" } });
  });
  it("rejects a detail for a different activity", async () => {
    const { api } = setup({ activity: activity() });
    expect(await api.get(itineraryId(1), itineraryId(99))).toEqual({ ok: false, error: { kind: "server" } });
  });
  it("preserves validation fields for the form", async () => {
    const fields = [{ field: "scheduledAt", code: "outside_window", message: "Outside window" }];
    const { api } = setup({ error: { code: "ValidationError", message: "Invalid", fields } }, 400);
    expect(await api.create(itineraryId(1), input)).toMatchObject({ ok: false, error: { kind: "validation", fields: [{ field: "scheduledAt", message: "Outside window" }] } });
  });
  it("keeps the field code so the form can tell a window rejection from an invalid duration", async () => {
    const fields = [{ field: "durationMinutes", code: "outside_window", message: "Outside window" }];
    const { api } = setup({ error: { code: "ValidationError", message: "Invalid", fields } }, 422);
    expect(await api.update(itineraryId(1), itineraryId(8), { durationMinutes: 600 })).toEqual({ ok: false,
      error: { kind: "validation", fields: [{ field: "durationMinutes", code: "outside_window", message: "Outside window" }] } });
  });
  it.each([[undefined], [null], [90]])("accepts durationMinutes %s in a response", async (durationMinutes) => {
    const value = { ...activity(), ...(durationMinutes === undefined ? {} : { durationMinutes }) };
    const { api } = setup({ activity: value });
    expect(await api.get(value.tripId, value.id)).toEqual({ ok: true, value });
  });
  it.each([[0], [-30], [1.5], ["90"]])("rejects durationMinutes %j in a response", async (durationMinutes) => {
    const { api } = setup({ activity: { ...activity(), durationMinutes } });
    const value = activity();
    expect(await api.get(value.tripId, value.id)).toEqual({ ok: false, error: { kind: "server" } });
  });
  it("sends durationMinutes null to remove the duration and a number to set it", async () => {
    const { api, fetch } = setup({ activity: activity() });
    await api.update(itineraryId(1), itineraryId(8), { durationMinutes: null });
    await api.create(itineraryId(1), { ...input, durationMinutes: 90 });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ durationMinutes: null });
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ ...input, durationMinutes: 90 });
  });
  it.each([[401, "unauthorized"], [403, "forbidden"], [404, "not-found"], [500, "server"]])("propagates HTTP %s", async (status, kind) => {
    const { api, onUnauthorized } = setup({}, status as number);
    expect(await api.get(itineraryId(1), itineraryId(8))).toEqual({ ok: false, error: { kind } });
    expect(onUnauthorized).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
  });
  it("propagates network errors", async () => {
    const { api, fetch } = setup({}); fetch.mockRejectedValue(new Error("Offline"));
    expect(await api.create(itineraryId(1), input)).toEqual({ ok: false, error: { kind: "network", code: "NetworkError" } });
  });
  describe("remove", () => {
    const tripId = itineraryId(1), activityId = itineraryId(8);
    const empty = (status: number) => { const fetch = vi.fn().mockResolvedValue(new Response(null, { status })); const onUnauthorized = vi.fn();
      const client = createHttpClient({ baseUrl: "https://api.test", fetch, getAccessToken: async () => "token", onUnauthorized });
      return { api: createTripActivityApi(client), fetch, onUnauthorized }; };
    it("sends an authenticated DELETE without body or content-type and accepts a 204", async () => {
      const { api, fetch } = empty(204);
      expect(await api.remove(tripId, activityId)).toEqual({ ok: true, value: undefined });
      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, request] = fetch.mock.calls[0];
      expect(url).toBe(`https://api.test/trips/${tripId}/activities/${activityId}`);
      expect(request.method).toBe("DELETE"); expect(request.headers.Authorization).toBe("Bearer token");
      expect(request.body).toBeUndefined(); expect(Object.keys(request.headers).map((h) => h.toLowerCase())).not.toContain("content-type");
    });
    it("encodes the path segments", async () => {
      const { api, fetch } = empty(204);
      await api.remove("a/b", "x y?#");
      expect(fetch.mock.calls[0][0]).toBe("https://api.test/trips/a%2Fb/activities/x%20y%3F%23");
    });
    it.each([
      [401, "UnauthorizedError", "unauthorized"], [403, "ForbiddenError", "forbidden"], [404, "TripNotFoundError", "not-found"],
      [404, "ActivityNotFoundError", "not-found"], [500, "InternalError", "server"],
    ])("maps HTTP %s %s to %s and never to ok", async (status, code, kind) => {
      const { api, onUnauthorized } = setup({ error: { code, message: "x" } }, status);
      expect(await api.remove(tripId, activityId)).toEqual({ ok: false, error: { kind } });
      expect(onUnauthorized).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
    });
    it("maps a rejected fetch to network", async () => {
      const { api, fetch } = empty(204); fetch.mockRejectedValue(new Error("Offline"));
      expect(await api.remove(tripId, activityId)).toEqual({ ok: false, error: { kind: "network", code: "NetworkError" } });
    });
    it("never produces a participation conflict from an unexpected 409 without valid details", async () => {
      const { api } = setup({ error: { code: "ParticipationConflictError", message: "x" } }, 409);
      expect(await api.remove(tripId, activityId)).toEqual({ ok: false, error: { kind: "server" } });
    });
  });
  describe("create with participation and confirmation", () => {
    const participation = (status = "going") => ({ id: itineraryId(50), tripId: itineraryId(1), activityId: itineraryId(8),
      userId: itineraryId(20), status, updatedAt: "2026-09-25T12:00:00.123Z" });
    const confirmation = { confirmedConflicts: [{ activityId: itineraryId(9), reason: "same_start", scheduledAt: "2026-09-25T12:00:00.000Z", durationMinutes: null }],
      confirmedActivity: { scheduledAt: "2026-09-25T12:00:00.123Z", durationMinutes: null } } as const;
    it("does not send confirmation keys without confirmation", async () => {
      const { api, fetch } = setup({ activity: activity() }, 201);
      await api.create(itineraryId(1), input);
      const body = JSON.parse(fetch.mock.calls[0][1].body);
      expect(body).not.toHaveProperty("confirmedConflicts"); expect(body).not.toHaveProperty("confirmedActivity");
    });
    it("sends the confirmation unchanged next to the input", async () => {
      const { api, fetch } = setup({ activity: activity() }, 201);
      await api.create(itineraryId(1), input, confirmation as never);
      expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ ...input, ...confirmation });
    });
    it("returns the activity and the author's participation from a 201", async () => {
      const { api } = setup({ activity: activity(), participation: participation() }, 201);
      expect(await api.create(itineraryId(1), input)).toEqual({ ok: true, value: { activity: activity(), participation: participation() } });
    });
    it.each([[{ status: "confirmed" }], [{ activityId: itineraryId(99) }], [{ tripId: itineraryId(99) }]])("keeps the saved activity with participation null when participation is invalid: %j", async (change) => {
      const { api } = setup({ activity: activity(), participation: { ...participation(), ...change } }, 201);
      expect(await api.create(itineraryId(1), input)).toEqual({ ok: true, value: { activity: activity(), participation: null } });
    });
    it("maps a valid 409 to participation-conflict", async () => {
      const { api } = setup({ error: { code: "ParticipationConflictError", message: "x", conflicts: confirmation.confirmedConflicts, activity: confirmation.confirmedActivity } }, 409);
      expect(await api.create(itineraryId(1), input)).toEqual({ ok: false, error: { kind: "participation-conflict", confirmation } });
    });
    it("treats a malformed 409 as a server failure", async () => {
      const { api } = setup({ error: { code: "ParticipationConflictError", conflicts: [] } }, 409);
      expect(await api.create(itineraryId(1), input)).toEqual({ ok: false, error: { kind: "server" } });
    });
  });
});
