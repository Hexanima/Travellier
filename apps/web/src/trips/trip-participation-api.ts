import type { ActivityParticipationStatus } from "app-domain";
import type { ApiClientError, HttpClient } from "../api/index.js";
import type { TripResult } from "./trip-management-api.js";

export type ParticipationResponse = {
  id: string; tripId: string; activityId: string; userId: string;
  status: ActivityParticipationStatus; updatedAt: string;
};
export type TripParticipationApi = {
  get: (tripId: string, activityId: string) => Promise<TripResult<ParticipationResponse | null>>;
  set: (tripId: string, activityId: string, status: ActivityParticipationStatus) => Promise<TripResult<ParticipationResponse>>;
};

const path = (tripId: string, activityId: string) =>
  `/trips/${encodeURIComponent(tripId)}/activities/${encodeURIComponent(activityId)}/participation`;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{24}$/.test(value);
const timestamp = (value: unknown) => typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const valid = (value: unknown, tripId: string, activityId: string): value is ParticipationResponse => record(value) &&
  id(value.id) && id(value.tripId) && value.tripId === tripId && id(value.activityId) && value.activityId === activityId &&
  id(value.userId) && ["going", "not_going", "pending"].includes(value.status as string) && timestamp(value.updatedAt);
const failure = (error: ApiClientError): TripResult<never> => ({ ok: false, error: { kind: error.kind,
  ...(error.fields ? { fields: error.fields.map(({ field, message }) => ({ field, message })) } : {}) } });
const invalid: TripResult<never> = { ok: false, error: { kind: "server" } };

export const createTripParticipationApi = (client: Pick<HttpClient, "get" | "put">): TripParticipationApi => ({
  get: async (tripId, activityId) => {
    const result = await client.get<unknown>(path(tripId, activityId));
    if (!result.ok) return failure(result.error);
    return record(result.value) && (result.value.participation === null || valid(result.value.participation, tripId, activityId))
      ? { ok: true, value: result.value.participation } : invalid;
  },
  set: async (tripId, activityId, status) => {
    const result = await client.put<unknown>(path(tripId, activityId), { status });
    if (!result.ok) return failure(result.error);
    return record(result.value) && valid(result.value.participation, tripId, activityId)
      ? { ok: true, value: result.value.participation } : invalid;
  },
});
