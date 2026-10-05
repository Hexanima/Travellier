import { describe, expect, it, vi } from "vitest";
import { createHttpClient } from "../api/index.js";
import { itineraryId } from "./itinerary-test-fixture.js";
import { createTripParticipationApi } from "./trip-participation-api.js";

const participation = (status = "going") => ({ id: itineraryId(50), tripId: itineraryId(1), activityId: itineraryId(8),
  userId: itineraryId(20), status, updatedAt: "2026-09-25T12:00:00.123Z" });
const setup = (body: unknown, status = 200) => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  const onUnauthorized = vi.fn();
  const client = createHttpClient({ baseUrl: "https://api.test", fetch, getAccessToken: async () => "token", onUnauthorized });
  return { api: createTripParticipationApi(client), fetch, onUnauthorized };
};

describe("participation HTTP adapter", () => {
  it("reads the authenticated user's participation", async () => {
    const value = participation(); const { api, fetch } = setup({ participation: value });
    expect(await api.get(value.tripId, value.activityId)).toEqual({ ok: true, value });
    expect(fetch).toHaveBeenCalledWith(`https://api.test/trips/${value.tripId}/activities/${value.activityId}/participation`,
      expect.objectContaining({ method: "GET", headers: { Authorization: "Bearer token" } }));
  });
  it("reads absence without writing", async () => {
    const { api, fetch } = setup({ participation: null });
    expect(await api.get(itineraryId(1), itineraryId(8))).toEqual({ ok: true, value: null });
    expect(fetch).toHaveBeenCalledOnce(); expect(fetch.mock.calls[0][1].method).toBe("GET");
  });
  it.each(["going", "not_going", "pending"] as const)("sets %s sending only the status", async (status) => {
    const value = participation(status); const { api, fetch } = setup({ participation: value });
    expect(await api.set(value.tripId, value.activityId, status)).toEqual({ ok: true, value });
    const [url, request] = fetch.mock.calls[0];
    expect(url).toBe(`https://api.test/trips/${value.tripId}/activities/${value.activityId}/participation`);
    expect(request.method).toBe("PUT"); expect(request.headers.Authorization).toBe("Bearer token");
    expect(JSON.parse(request.body)).toEqual({ status });
  });
  it.each([
    { id: "bad" }, { tripId: itineraryId(99) }, { activityId: itineraryId(99) }, { userId: "bad" },
    { status: "confirmed" }, { updatedAt: "bad" }, { updatedAt: "2026-09-25T12:00:00+00:00" },
    { updatedAt: "2026-02-30T12:00:00.000Z" },
  ])("rejects an invalid response: %j", async (change) => {
    const { api } = setup({ participation: { ...participation(), ...change } });
    expect(await api.get(itineraryId(1), itineraryId(8))).toEqual({ ok: false, error: { kind: "server" } });
    expect(await api.set(itineraryId(1), itineraryId(8), "going")).toEqual({ ok: false, error: { kind: "server" } });
  });
  it.each([null, {}, [], { participation: null }, { participation: undefined }])("rejects missing PUT data: %j", async (body) => {
    const { api } = setup(body);
    expect(await api.set(itineraryId(1), itineraryId(8), "going")).toEqual({ ok: false, error: { kind: "server" } });
  });
  it.each([[401, "unauthorized"], [403, "forbidden"], [404, "not-found"], [500, "server"], [503, "server"]] as const)(
    "propagates HTTP %s", async (status, kind) => {
      const { api, onUnauthorized } = setup({}, status);
      expect(await api.get(itineraryId(1), itineraryId(8))).toEqual({ ok: false, error: { kind } });
      expect(await api.set(itineraryId(1), itineraryId(8), "going")).toEqual({ ok: false, error: { kind } });
      expect(onUnauthorized).toHaveBeenCalledTimes(status === 401 ? 2 : 0);
    });
  it("preserves validation details", async () => {
    const fields = [{ field: "status", code: "invalid", message: "Invalid status" }];
    const { api } = setup({ error: { code: "ValidationError", fields } }, 422);
    expect(await api.set(itineraryId(1), itineraryId(8), "going")).toMatchObject({ ok: false,
      error: { kind: "validation", fields: [{ field: "status", message: "Invalid status" }] } });
  });
  it("handles network failure", async () => {
    const { api, fetch } = setup({}); fetch.mockRejectedValue(new Error("Offline"));
    expect(await api.get(itineraryId(1), itineraryId(8))).toEqual({ ok: false, error: { kind: "network" } });
    expect(await api.set(itineraryId(1), itineraryId(8), "going")).toEqual({ ok: false, error: { kind: "network" } });
  });
});
