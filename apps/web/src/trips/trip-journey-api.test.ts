import { describe, expect, it, vi } from "vitest";

import { createTripJourneyApi, type JourneyTransport } from "./trip-journey-api.js";
import { createHttpClient } from "../api/http-client.js";

const tripId = "507f191e810c19729de860ea";
const destinationId = "507f1f77bcf86cd799439013";
const transportId = "507f1f77bcf86cd799439014";
const destination = { id: destinationId, tripId, name: "Bariloche", order: 1, createdAt: "2026-09-24T12:00:00.000Z" };
const transport = {
  id: transportId, tripId, destinationId, direction: "outbound", type: "flight",
  departurePlace: "AEP", departureAt: "2026-10-01T12:00:00.000Z",
  arrivalPlace: "BRC", arrivalAt: "2026-10-01T14:00:00.000Z",
  costPerPerson: 150, details: { flightNumber: "AR123" },
} satisfies JourneyTransport;

describe("createTripJourneyApi", () => {
  it("distinguishes an itinerary 409 from a duplicate transport through the HTTP client", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "ItineraryConflictError" } }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "JourneyConflictError" } }), { status: 409 }));
    const api = createTripJourneyApi(createHttpClient({ baseUrl: "https://example.test", fetch,
      getAccessToken: async () => "token", onUnauthorized: vi.fn() }));
    const input = { direction: transport.direction, type: transport.type, departurePlace: transport.departurePlace,
      departureAt: transport.departureAt, arrivalPlace: transport.arrivalPlace, arrivalAt: transport.arrivalAt,
      costPerPerson: transport.costPerPerson, details: transport.details };
    expect(await api.updateTransport(tripId, destinationId, transportId, input)).toEqual({ ok: false, error: { kind: "itinerary-conflict" } });
    expect(await api.createTransport(tripId, destinationId, input)).toEqual({ ok: false, error: { kind: "server" } });
  });
  it("loads ordered destinations and validates their shape", async () => {
    const get = vi.fn().mockResolvedValueOnce({ ok: true, value: { destinations: [destination] } })
      .mockResolvedValueOnce({ ok: true, value: { destinations: [{ name: "Sin ID" }] } });
    const api = createTripJourneyApi({ get, post: vi.fn(), patch: vi.fn() } as never);

    expect(await api.listDestinations(tripId)).toEqual({ ok: true, value: [destination] });
    expect(get).toHaveBeenCalledWith(`/trips/${tripId}/destinations`);
    expect(await api.listDestinations(tripId)).toEqual({ ok: false, error: { kind: "server" } });
  });

  it("creates a destination and uses the server assigned order", async () => {
    const post = vi.fn().mockResolvedValue({ ok: true, value: { destination: { ...destination, order: 2 } } });
    const api = createTripJourneyApi({ get: vi.fn(), post, patch: vi.fn() } as never);

    expect(await api.createDestination(tripId, "Córdoba")).toEqual({ ok: true, value: { ...destination, order: 2 } });
    expect(post).toHaveBeenCalledWith(`/trips/${tripId}/destinations`, { name: "Córdoba" });
  });

  it("loads, creates and updates transports under the selected destination", async () => {
    const get = vi.fn().mockResolvedValue({ ok: true, value: { transports: [transport] } });
    const post = vi.fn().mockResolvedValue({ ok: true, value: { transport } });
    const patch = vi.fn().mockResolvedValue({ ok: true, value: { transport } });
    const api = createTripJourneyApi({ get, post, patch } as never);
    const input = { direction: transport.direction, type: transport.type, departurePlace: transport.departurePlace,
      departureAt: transport.departureAt, arrivalPlace: transport.arrivalPlace, arrivalAt: transport.arrivalAt,
      costPerPerson: transport.costPerPerson, details: transport.details } as const;
    const path = `/trips/${tripId}/destinations/${destinationId}/transports`;

    expect(await api.listTransports(tripId, destinationId)).toEqual({ ok: true, value: [transport] });
    expect(await api.createTransport(tripId, destinationId, input)).toEqual({ ok: true, value: transport });
    expect(await api.updateTransport(tripId, destinationId, transportId, input)).toEqual({ ok: true, value: transport });
    expect(get).toHaveBeenCalledWith(path);
    expect(post).toHaveBeenCalledWith(path, input);
    expect(patch).toHaveBeenCalledWith(`${path}/${transportId}`, input);
  });

  it("preserves field errors and rejects malformed transport responses", async () => {
    const post = vi.fn().mockResolvedValueOnce({ ok: false, error: { kind: "validation", fields: [
      { field: "arrivalAt", code: "before_departure", message: "Arrival cannot precede departure." },
    ] } }).mockResolvedValueOnce({ ok: true, value: { transport: { ...transport, details: { steps: [] } } } });
    const api = createTripJourneyApi({ get: vi.fn(), post, patch: vi.fn() } as never);
    const input = { direction: transport.direction, type: transport.type, departurePlace: transport.departurePlace,
      departureAt: transport.departureAt, arrivalPlace: transport.arrivalPlace, arrivalAt: transport.arrivalAt,
      costPerPerson: transport.costPerPerson, details: transport.details } as const;

    expect(await api.createTransport(tripId, destinationId, input)).toEqual({ ok: false, error: { kind: "validation",
      fields: [{ field: "arrivalAt", message: "Arrival cannot precede departure." }] } });
    expect(await api.createTransport(tripId, destinationId, input)).toEqual({ ok: false, error: { kind: "server" } });
  });
});
