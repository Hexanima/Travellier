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
  it.each(["create", "get", "update"] as const)("authenticates %s and accepts the single activity response without postIds", async (operation) => {
    const value = activity();
    const { api, fetch } = setup({ activity: value }, operation === "create" ? 201 : 200);
    const result = operation === "create" ? await api.create(value.tripId, input)
      : operation === "get" ? await api.get(value.tripId, value.id) : await api.update(value.tripId, value.id, { description: null });
    expect(result).toEqual({ ok: true, value });
    const [url, request] = fetch.mock.calls[0];
    expect(url).toBe(`https://api.test/trips/${value.tripId}/activities${operation === "create" ? "" : `/${value.id}`}`);
    expect(request.method).toBe({ create: "POST", get: "GET", update: "PATCH" }[operation]);
    expect(request.headers.Authorization).toBe("Bearer token");
    if (operation !== "get") expect(JSON.parse(request.body)).toEqual(operation === "create" ? input : { description: null });
  });
  it.each([
    { tripId: itineraryId(99) }, { id: "bad" }, { dayId: "bad" }, { title: " " }, { scheduledAt: null },
    { scheduledAt: "2026-09-25T12:00:00+00:00" }, { createdAt: "bad" }, { status: "done" }, { mapsUrl: 4 },
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
  it.each([[401, "unauthorized"], [403, "forbidden"], [404, "not-found"], [500, "server"]])("propagates HTTP %s", async (status, kind) => {
    const { api, onUnauthorized } = setup({}, status as number);
    expect(await api.get(itineraryId(1), itineraryId(8))).toEqual({ ok: false, error: { kind } });
    expect(onUnauthorized).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
  });
  it("propagates network errors", async () => {
    const { api, fetch } = setup({}); fetch.mockRejectedValue(new Error("Offline"));
    expect(await api.create(itineraryId(1), input)).toEqual({ ok: false, error: { kind: "network" } });
  });
});
