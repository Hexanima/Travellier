import { describe, expect, it, vi } from "vitest";
import { createHttpClient } from "../api/http-client.js";
import { itineraryFixture } from "./itinerary-test-fixture.js";
import { createTripItineraryApi } from "./trip-itinerary-api.js";

describe("itinerary client", () => {
  it("reads canonical UTC and legacy urban steps without mutating their fields", async () => {
    const itinerary = itineraryFixture();
    const canonical = { ...itinerary.transports[0], type: "bus_local", details: { steps: [
      { line: "1", fromStop: "A", toStop: "B", estimatedAt: "2026-09-25T09:00:00.123Z" },
    ] } };
    const legacy = { ...canonical, details: { steps: [{ line: "1", fromStop: "A", toStop: "B", estimatedTime: "06:00" }] } };
    for (const transport of [canonical, legacy]) {
      const response = { ...itinerary, transports: [transport, itinerary.transports[1]] };
      const get = vi.fn().mockResolvedValue({ ok: true, value: { itinerary: response } });
      expect(await createTripItineraryApi({ get }).get(itinerary.tripId)).toEqual({ ok: true, value: response });
    }
  });
  it("reads the aggregate in one authenticated GET and preserves UTC precision", async () => {
    const createApi = createTripItineraryApi, itinerary = itineraryFixture();
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ itinerary })));
    const client = createHttpClient({ baseUrl: "https://example.test", fetch, getAccessToken: async () => "access", onUnauthorized: vi.fn() });
    expect(await createApi(client).get(itinerary.tripId)).toEqual({ ok: true, value: itinerary });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(`https://example.test/trips/${itinerary.tripId}/itinerary`, expect.objectContaining({
      method: "GET", headers: { Authorization: "Bearer access" },
    }));
  });
  it("accepts an empty itinerary and nullable bounds", async () => {
    const createApi = createTripItineraryApi, itinerary = itineraryFixture();
    const get = vi.fn().mockResolvedValueOnce({ ok: true, value: { itinerary: {
      ...itinerary, days: [], activities: [], transports: [], posts: [],
    } } }).mockResolvedValueOnce({ ok: true, value: { itinerary: {
      ...itinerary, days: itinerary.days.map((day, index) => index === 1 ? { ...day, type: "arrival", endsAt: null } : day),
    } } });
    expect(await createApi({ get }).get(itinerary.tripId)).toMatchObject({ ok: true, value: { days: [] } });
    expect(await createApi({ get }).get(itinerary.tripId)).toMatchObject({ ok: true, value: { days: [{}, { endsAt: null }, {}] } });
  });
  it.each(["network", "not-found", "forbidden", "unauthorized", "server"])("propagates %s errors", async (kind) => {
    const createApi = createTripItineraryApi;
    const get = vi.fn().mockResolvedValue({ ok: false, error: { kind } });
    expect(await createApi({ get }).get(itineraryFixture().tripId)).toEqual({ ok: false, error: { kind } });
  });
  it("delegates session expiry to the existing HTTP client", async () => {
    const createApi = createTripItineraryApi, onUnauthorized = vi.fn();
    const client = createHttpClient({ baseUrl: "https://example.test", fetch: vi.fn().mockResolvedValue(new Response("{}", { status: 401 })),
      getAccessToken: async () => "expired", onUnauthorized });
    expect(await createApi(client).get(itineraryFixture().tripId)).toMatchObject({ ok: false, error: { kind: "unauthorized" } });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });
  it.each([
    (v: ReturnType<typeof itineraryFixture>) => { v.tripId = "bad"; },
    (v: ReturnType<typeof itineraryFixture>) => { v.tripId = "000000000000000000000099"; },
    (v: ReturnType<typeof itineraryFixture>) => { v.days[0].startsAt = "invalid"; },
    (v: ReturnType<typeof itineraryFixture>) => { v.days[0].endsAt = "2026-09-25T07:00:00.000Z"; },
    (v: ReturnType<typeof itineraryFixture>) => { v.days[0].type = "unknown"; },
    (v: ReturnType<typeof itineraryFixture>) => { v.activities[0].scheduledAt = "invalid"; },
    (v: ReturnType<typeof itineraryFixture>) => { v.transports[0].arrivalAt = "invalid"; },
    (v: ReturnType<typeof itineraryFixture>) => { v.posts[0].expense!.totalAmount = Infinity; },
    (v: ReturnType<typeof itineraryFixture>) => { v.posts[0].dayId = "000000000000000000000099"; },
    (v: ReturnType<typeof itineraryFixture>) => { v.days[0].items[0].id = "000000000000000000000099"; },
  ])("rejects malformed aggregate %# rather than exposing partial data", async (mutate) => {
    const createApi = createTripItineraryApi, itinerary = itineraryFixture();
    const tripId = itinerary.tripId; mutate(itinerary);
    const get = vi.fn().mockResolvedValue({ ok: true, value: { itinerary } });
    expect(await createApi({ get }).get(tripId)).toEqual({ ok: false, error: { kind: "server" } });
  });
});
