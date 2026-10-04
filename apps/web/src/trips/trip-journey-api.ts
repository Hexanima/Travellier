import { readTransport, type Transport } from "app-domain";
import type { ApiClientError, HttpClient } from "../api/index.js";
import type { TripFailure, TripResult } from "./trip-management-api.js";

export type TransportDirection = "outbound" | "return";
export type TransportType = "bus_local" | "bus_long" | "flight" | "car" | "other";
export type UrbanTransportStep = { line: string; fromStop: string; toStop: string } & (
  | { estimatedAt: string; estimatedTime?: never }
  | { estimatedTime: string; estimatedAt?: never }
);

type TransportBase = {
  direction: TransportDirection;
  departurePlace: string;
  departureAt: string;
  arrivalPlace: string;
  arrivalAt: string;
  costPerPerson: number | null;
};

export type TransportInput = TransportBase & (
  | { type: "bus_local"; details: { steps: UrbanTransportStep[] } }
  | { type: "bus_long"; details: { company?: string | null; terminal?: string | null } }
  | { type: "flight"; details: { flightNumber?: string | null; airline?: string | null } }
  | { type: "car" | "other"; details: Record<string, never> }
);

export type JourneyTransport = TransportInput & { id: string; tripId: string; destinationId: string };
export type JourneyDestination = { id: string; tripId: string; name: string; order: number; createdAt: string };

export type TripJourneyApi = {
  listDestinations: (tripId: string) => Promise<TripResult<JourneyDestination[]>>;
  createDestination: (tripId: string, name: string) => Promise<TripResult<JourneyDestination>>;
  listTransports: (tripId: string, destinationId: string) => Promise<TripResult<JourneyTransport[]>>;
  createTransport: (tripId: string, destinationId: string, input: TransportInput) => Promise<TripResult<JourneyTransport>>;
  updateTransport: (tripId: string, destinationId: string, transportId: string, input: TransportInput) => Promise<TripResult<JourneyTransport>>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";
const isTimestamp = (value: unknown): value is string => isText(value) && !Number.isNaN(Date.parse(value));

/** Hydrate only explicit UTC step instants. Legacy clocks retain their original representation. */
export const journeyTransportForDomain = (value: Record<string, unknown>): Transport => {
  const details = isRecord(value.details) ? value.details : {};
  return { ...value, departureAt: new Date(value.departureAt as string), arrivalAt: new Date(value.arrivalAt as string),
    details: !isRecord(value.details) ? value.details : { ...details, ...(Array.isArray(details.steps) ? { steps: details.steps.map((step: unknown) => {
      if (!isRecord(step) || !Object.hasOwn(step, "estimatedAt")) return step;
      const instant = step.estimatedAt;
      const date = typeof instant === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(instant)
        ? new Date(instant) : new Date(Number.NaN);
      return { ...step, estimatedAt: Number.isFinite(date.getTime()) && date.toISOString() === instant ? date : new Date(Number.NaN) };
    }) } : {}) },
  } as unknown as Transport;
};

const isDestination = (value: unknown): value is JourneyDestination => isRecord(value) &&
  isText(value.id) && isText(value.tripId) && isText(value.name) &&
  Number.isSafeInteger(value.order) && (value.order as number) > 0 && isTimestamp(value.createdAt);

const isTransport = (value: unknown): value is JourneyTransport => {
  if (!isRecord(value) || !isText(value.id) || !isText(value.tripId) || !isText(value.destinationId) ||
      (value.direction !== "outbound" && value.direction !== "return") ||
      !isText(value.departurePlace) || !isTimestamp(value.departureAt) ||
      !isText(value.arrivalPlace) || !isTimestamp(value.arrivalAt) ||
      !(value.costPerPerson === null || (typeof value.costPerPerson === "number" && Number.isFinite(value.costPerPerson))) ||
      !isRecord(value.details)) return false;
  return readTransport(journeyTransportForDomain(value)).ok;
};

const toFailure = (error: ApiClientError): TripFailure =>
  error.status === 409 && error.code === "ItineraryConflictError" ? { kind: "itinerary-conflict" } :
  error.kind === "validation" && error.fields !== undefined
    ? { kind: error.kind, fields: error.fields.map(({ field, message }) => ({ field, message })) }
    : { kind: error.kind };
const serverFailure = (): TripResult<never> => ({ ok: false, error: { kind: "server" } });
const destinationsPath = (tripId: string) => `/trips/${encodeURIComponent(tripId)}/destinations`;
const transportsPath = (tripId: string, destinationId: string) =>
  `${destinationsPath(tripId)}/${encodeURIComponent(destinationId)}/transports`;

export const createTripJourneyApi = (client: Pick<HttpClient, "get" | "post" | "patch">): TripJourneyApi => ({
  listDestinations: async (tripId) => {
    const result = await client.get<unknown>(destinationsPath(tripId));
    if (!result.ok) return { ok: false, error: toFailure(result.error) };
    return isRecord(result.value) && Array.isArray(result.value.destinations) && result.value.destinations.every(isDestination)
      ? { ok: true, value: result.value.destinations }
      : serverFailure();
  },
  createDestination: async (tripId, name) => {
    const result = await client.post<unknown>(destinationsPath(tripId), { name });
    if (!result.ok) return { ok: false, error: toFailure(result.error) };
    return isRecord(result.value) && isDestination(result.value.destination)
      ? { ok: true, value: result.value.destination }
      : serverFailure();
  },
  listTransports: async (tripId, destinationId) => {
    const result = await client.get<unknown>(transportsPath(tripId, destinationId));
    if (!result.ok) return { ok: false, error: toFailure(result.error) };
    return isRecord(result.value) && Array.isArray(result.value.transports) && result.value.transports.every(isTransport)
      ? { ok: true, value: result.value.transports }
      : serverFailure();
  },
  createTransport: async (tripId, destinationId, input) => {
    const result = await client.post<unknown>(transportsPath(tripId, destinationId), input);
    if (!result.ok) return { ok: false, error: toFailure(result.error) };
    return isRecord(result.value) && isTransport(result.value.transport)
      ? { ok: true, value: result.value.transport }
      : serverFailure();
  },
  updateTransport: async (tripId, destinationId, transportId, input) => {
    const result = await client.patch<unknown>(`${transportsPath(tripId, destinationId)}/${encodeURIComponent(transportId)}`, input);
    if (!result.ok) return { ok: false, error: toFailure(result.error) };
    return isRecord(result.value) && isTransport(result.value.transport)
      ? { ok: true, value: result.value.transport }
      : serverFailure();
  },
});
