import type { ApiClientError, HttpClient } from "../api/index.js";
import type { TripFailure, TripResult } from "./trip-management-api.js";

export type TransportDirection = "outbound" | "return";
export type TransportType = "bus_local" | "bus_long" | "flight" | "car" | "other";
export type UrbanTransportStep = { line: string; fromStop: string; toStop: string; estimatedTime: string };

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
const isOptionalText = (value: unknown) => value === undefined || value === null || isText(value);
const isTimestamp = (value: unknown): value is string => isText(value) && !Number.isNaN(Date.parse(value));
const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
const isStep = (value: unknown): value is UrbanTransportStep => isRecord(value) &&
  isText(value.line) && isText(value.fromStop) && isText(value.toStop) &&
  typeof value.estimatedTime === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.estimatedTime);

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
  switch (value.type) {
    case "bus_local":
      return hasOnlyKeys(value.details, ["steps"]) && Array.isArray(value.details.steps) &&
        value.details.steps.length > 0 && value.details.steps.every(isStep);
    case "bus_long":
      return hasOnlyKeys(value.details, ["company", "terminal"]) &&
        isOptionalText(value.details.company) && isOptionalText(value.details.terminal);
    case "flight":
      return hasOnlyKeys(value.details, ["flightNumber", "airline"]) &&
        isOptionalText(value.details.flightNumber) && isOptionalText(value.details.airline);
    case "car":
    case "other":
      return Object.keys(value.details).length === 0;
    default:
      return false;
  }
};

const toFailure = (error: ApiClientError): TripFailure =>
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
