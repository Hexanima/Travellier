import type { ApiClientError, HttpClient, ApiErrorKind } from "../api/index.js";

export type TripSummary = {
  id: string;
  name: string;
  description: string | null;
  primaryDestination: { name: string };
};

export type CreateTripInput = { name: string; primaryDestination: string; description?: string };
export type TripFailure = { kind: ApiErrorKind; fields?: readonly { field: string; message: string }[] };
export type TripResult<T> = { ok: true; value: T } | { ok: false; error: TripFailure };
export type TripManagementApi = {
  list: () => Promise<TripResult<TripSummary[]>>;
  create: (input: CreateTripInput) => Promise<TripResult<TripSummary>>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isTripSummary = (value: unknown): value is TripSummary =>
  isRecord(value) && typeof value.id === "string" && typeof value.name === "string" &&
  (typeof value.description === "string" || value.description === null) &&
  isRecord(value.primaryDestination) && typeof value.primaryDestination.name === "string";

const toFailure = (error: ApiClientError): TripFailure =>
  error.kind === "validation" && error.fields !== undefined
    ? { kind: error.kind, fields: error.fields.map(({ field, message }) => ({ field, message })) }
    : { kind: error.kind };

export const createTripManagementApi = (client: Pick<HttpClient, "get" | "post">): TripManagementApi => ({
  list: async () => {
    const result = await client.get<unknown>("/trips");
    if (!result.ok) return { ok: false, error: toFailure(result.error) };
    return isRecord(result.value) && Array.isArray(result.value.trips) && result.value.trips.every(isTripSummary)
      ? { ok: true, value: result.value.trips }
      : { ok: false, error: { kind: "server" } };
  },
  create: async (input) => {
    const result = await client.post<unknown>("/trips", input);
    if (!result.ok) return { ok: false, error: toFailure(result.error) };
    return isRecord(result.value) && isTripSummary(result.value.trip)
      ? { ok: true, value: result.value.trip }
      : { ok: false, error: { kind: "server" } };
  },
});
