import { describe, expect, it, vi } from "vitest";
import { createHttpClient } from "../api/index.js";
import { itineraryId } from "./itinerary-test-fixture.js";
import { createTripVoteApi } from "./trip-vote-api.js";

const vote = (value = "up") => ({ id: itineraryId(50), tripId: itineraryId(1), activityId: itineraryId(8),
  userId: itineraryId(20), value, createdAt: "2026-09-25T12:00:00.123Z" });
const setup = (body: unknown, status = 200) => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  const onUnauthorized = vi.fn();
  const client = createHttpClient({ baseUrl: "https://api.test", fetch, getAccessToken: async () => "token", onUnauthorized });
  return { api: createTripVoteApi(client), fetch, onUnauthorized };
};

describe("vote HTTP adapter", () => {
  it("reads the own vote and server activity status with the JWT", async () => {
    const body = { vote: vote(), activityStatus: "voting" }; const { api, fetch } = setup(body);
    expect(await api.get(itineraryId(1), itineraryId(8))).toEqual({ ok: true, value: body });
    expect(fetch).toHaveBeenCalledWith(`https://api.test/trips/${itineraryId(1)}/activities/${itineraryId(8)}/vote`,
      expect.objectContaining({ method: "GET", headers: { Authorization: "Bearer token" } }));
  });
  it.each(["proposed", "voting", "confirmed"])("reads absence in %s without writing", async (activityStatus) => {
    const body = { vote: null, activityStatus }; const { api, fetch } = setup(body);
    expect(await api.get(itineraryId(1), itineraryId(8))).toEqual({ ok: true, value: body });
    expect(fetch).toHaveBeenCalledOnce(); expect(fetch.mock.calls[0][1].method).toBe("GET");
  });
  it.each(["up", "down"] as const)("sets %s sending only the value", async (value) => {
    const body = { vote: vote(value), activityStatus: "voting" }; const { api, fetch } = setup(body);
    expect(await api.set(itineraryId(1), itineraryId(8), value)).toEqual({ ok: true, value: body });
    const [url, request] = fetch.mock.calls[0];
    expect(url).toBe(`https://api.test/trips/${itineraryId(1)}/activities/${itineraryId(8)}/vote`);
    expect(request.method).toBe("PUT"); expect(request.headers.Authorization).toBe("Bearer token");
    expect(JSON.parse(request.body)).toEqual({ value });
  });
  it.each([{ id: "bad" }, { tripId: itineraryId(99) }, { activityId: itineraryId(99) }, { userId: "bad" },
    { value: "going" }, { createdAt: "bad" }, { createdAt: "2026-02-30T12:00:00.000Z" },
    { createdAt: "2026-09-25T12:00:00+00:00" }])("rejects invalid vote data %j", async (change) => {
    const { api } = setup({ vote: { ...vote(), ...change }, activityStatus: "voting" });
    expect(await api.get(itineraryId(1), itineraryId(8))).toEqual({ ok: false, error: { kind: "server" } });
    expect(await api.set(itineraryId(1), itineraryId(8), "up")).toEqual({ ok: false, error: { kind: "server" } });
  });
  it.each([null, {}, [], { vote: vote() }, { vote: null, activityStatus: "pending" }])("rejects invalid envelopes %j", async (body) => {
    const { api } = setup(body);
    expect(await api.get(itineraryId(1), itineraryId(8))).toEqual({ ok: false, error: { kind: "server" } });
  });
  it("requires a vote in the PUT response", async () => {
    const { api } = setup({ vote: null, activityStatus: "voting" });
    expect(await api.set(itineraryId(1), itineraryId(8), "up")).toEqual({ ok: false, error: { kind: "server" } });
  });
  it.each([["ActivityVotingDisabledError", "voting-disabled"], ["ActivityVotingClosedError", "voting-closed"]] as const)(
    "recognizes 409 %s", async (code, kind) => {
      const { api } = setup({ error: { code } }, 409);
      expect(await api.set(itineraryId(1), itineraryId(8), "down")).toEqual({ ok: false, error: { kind } });
    });
  it.each([[401, "unauthorized"], [403, "forbidden"], [404, "not-found"], [409, "server"], [500, "server"], [503, "server"]] as const)(
    "propagates HTTP %s", async (status, kind) => {
      const { api, onUnauthorized } = setup({}, status);
      expect(await api.get(itineraryId(1), itineraryId(8))).toEqual({ ok: false, error: { kind } });
      expect(await api.set(itineraryId(1), itineraryId(8), "up")).toEqual({ ok: false, error: { kind } });
      expect(onUnauthorized).toHaveBeenCalledTimes(status === 401 ? 2 : 0);
    });
  it("preserves validation details", async () => {
    const fields = [{ field: "value", code: "invalid", message: "Invalid vote" }];
    const { api } = setup({ error: { code: "ValidationError", fields } }, 422);
    expect(await api.set(itineraryId(1), itineraryId(8), "up")).toEqual({ ok: false,
      error: { kind: "validation", fields: [{ field: "value", message: "Invalid vote" }] } });
  });
  it("handles connection failures", async () => {
    const { api, fetch } = setup({}); fetch.mockRejectedValue(new Error("Offline"));
    expect(await api.get(itineraryId(1), itineraryId(8))).toEqual({ ok: false, error: { kind: "network" } });
    expect(await api.set(itineraryId(1), itineraryId(8), "up")).toEqual({ ok: false, error: { kind: "network" } });
  });
});
