import type { ApiClientError, HttpClient } from "../api/index.js";
import type { TripResult } from "./trip-management-api.js";
import type { ItineraryActivityResponse } from "./trip-itinerary-api.js";

export type ActivityResponse = Omit<ItineraryActivityResponse, "postIds">;
export type ActivityInput = Pick<ActivityResponse, "dayId" | "title" | "scheduledAt" | "description" | "mapsUrl">;
export type TripActivityApi = {
  create: (tripId: string, input: ActivityInput) => Promise<TripResult<ActivityResponse>>;
  get: (tripId: string, activityId: string) => Promise<TripResult<ActivityResponse>>;
  update: (tripId: string, activityId: string, input: Partial<ActivityInput>) => Promise<TripResult<ActivityResponse>>;
};

const path = (tripId: string) => `/trips/${encodeURIComponent(tripId)}/activities`;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{24}$/.test(value);
const nullableText = (value: unknown) => value === null || typeof value === "string";
const timestamp = (value: unknown) => typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const validActivity = (value: unknown, tripId: string, activityId?: string): value is ActivityResponse => record(value) &&
  id(value.id) && (activityId === undefined || value.id === activityId) && value.tripId === tripId && id(value.tripId) &&
  id(value.dayId) && typeof value.title === "string" && value.title.trim() !== "" && nullableText(value.description) &&
  nullableText(value.mapsUrl) && timestamp(value.scheduledAt) && timestamp(value.createdAt) && id(value.createdBy) &&
  ["proposed", "voting", "confirmed"].includes(value.status as string);
const response = (result: { ok: true; value: unknown } | { ok: false; error: ApiClientError }, tripId: string, activityId?: string): TripResult<ActivityResponse> => {
  if (!result.ok) return { ok: false, error: { kind: result.error.kind,
    ...(result.error.fields ? { fields: result.error.fields.map(({ field, message }) => ({ field, message })) } : {}) } };
  return record(result.value) && validActivity(result.value.activity, tripId, activityId)
    ? { ok: true, value: result.value.activity } : { ok: false, error: { kind: "server" } };
};
export const createTripActivityApi = (client: Pick<HttpClient, "get" | "post" | "patch">): TripActivityApi => ({
  create: async (tripId, input) => response(await client.post<unknown>(path(tripId), input), tripId),
  get: async (tripId, activityId) => response(await client.get<unknown>(`${path(tripId)}/${encodeURIComponent(activityId)}`), tripId, activityId),
  update: async (tripId, activityId, input) => response(await client.patch<unknown>(`${path(tripId)}/${encodeURIComponent(activityId)}`, input), tripId, activityId),
});
