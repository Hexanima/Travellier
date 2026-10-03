import { describe, expect, it, vi } from "vitest";
import { createObjectId, err, ok, TripNotFoundError, UnknownError } from "app-domain";
import { handleApiRequest, type TripApi } from "../app.js";

const parsed = createObjectId("507f1f77bcf86cd799439011");
if (!parsed.ok) throw parsed.error;
const actor = parsed.value;
const trip = "507f191e810c19729de860ea";
const url = `/trips/${trip}/itinerary`;
const dependencies = (getItinerary: unknown) => ({ trips: { getItinerary } as TripApi });

describe("itinerary route", () => {
  it("returns a single aggregate and serializes UTC dates and nulls", async () => {
    const value = { tripId: trip, days: [{ startsAt: new Date("2026-09-25T08:00:00.123Z"), endsAt: null }], posts: [] };
    const getItinerary = vi.fn().mockResolvedValue(ok(value));
    const response = await handleApiRequest({ method: "GET", url, authenticatedUserId: actor }, dependencies(getItinerary));
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ itinerary: { ...value, days: [{ startsAt: "2026-09-25T08:00:00.123Z", endsAt: null }] } });
    expect(getItinerary).toHaveBeenCalledExactlyOnceWith({ tripId: trip, authenticatedUserId: actor });
  });

  it("requires authentication before accessing itinerary data", async () => {
    const getItinerary = vi.fn();
    expect((await handleApiRequest({ method: "GET", url }, dependencies(getItinerary))).statusCode).toBe(401);
    expect(getItinerary).not.toHaveBeenCalled();
  });

  it("rejects malformed IDs before accessing data", async () => {
    const getItinerary = vi.fn();
    expect((await handleApiRequest({ method: "GET", url: "/trips/invalid/itinerary", authenticatedUserId: actor }, dependencies(getItinerary))).statusCode).toBe(400);
    expect(getItinerary).not.toHaveBeenCalled();
  });

  it.each([[new TripNotFoundError(), 404], [new UnknownError("database unavailable"), 500]] as const)("maps %s to %s", async (error, status) => {
    const response = await handleApiRequest({ method: "GET", url, authenticatedUserId: actor }, dependencies(vi.fn().mockResolvedValue(err(error))));
    expect(response.statusCode).toBe(status);
    expect(response.body).not.toContain("database unavailable");
  });

  it("returns 503 when the service is not configured", async () => {
    expect((await handleApiRequest({ method: "GET", url, authenticatedUserId: actor })).statusCode).toBe(503);
  });
});
