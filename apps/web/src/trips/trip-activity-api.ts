import type { ApiClientError, HttpClient } from "../api/index.js";
import type { TripResult } from "./trip-management-api.js";
import type { ItineraryActivityResponse } from "./trip-itinerary-api.js";
import { parseConfirmation, type ParticipationConfirmation } from "./participation-conflict.js";
import { valid as validParticipation, type ParticipationResponse } from "./trip-participation-api.js";

export type ActivityResponse = Omit<ItineraryActivityResponse, "postIds">;
export type ActivityInput = Pick<ActivityResponse, "dayId" | "title" | "scheduledAt" | "description" | "mapsUrl"> & { durationMinutes?: number | null };
export type CreatedActivity = { activity: ActivityResponse; participation: ParticipationResponse | null };
export type TripActivityApi = {
  create: (tripId: string, input: ActivityInput, confirmation?: ParticipationConfirmation) => Promise<TripResult<CreatedActivity>>;
  get: (tripId: string, activityId: string) => Promise<TripResult<ActivityResponse>>;
  update: (tripId: string, activityId: string, input: Partial<ActivityInput>) => Promise<TripResult<ActivityResponse>>;
  /** DELETE answers 204 with no body; any successful response is accepted without validating one. */
  remove: (tripId: string, activityId: string) => Promise<TripResult<void>>;
};

const path = (tripId: string) => `/trips/${encodeURIComponent(tripId)}/activities`;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{24}$/.test(value);
const nullableText = (value: unknown) => value === null || typeof value === "string";
const timestamp = (value: unknown) => typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
/** Absent is tolerated; when present it is null or a positive whole number of minutes. */
const validDuration = (value: unknown) => value === undefined || value === null || (Number.isSafeInteger(value) && (value as number) > 0);
export const validActivity = (value: unknown, tripId: string, activityId?: string): value is ActivityResponse => record(value) &&
  id(value.id) && (activityId === undefined || value.id === activityId) && value.tripId === tripId && id(value.tripId) &&
  id(value.dayId) && typeof value.title === "string" && value.title.trim() !== "" && nullableText(value.description) &&
  nullableText(value.mapsUrl) && validDuration(value.durationMinutes) && timestamp(value.scheduledAt) && timestamp(value.createdAt) && id(value.createdBy);
type Raw = { ok: true; value: unknown } | { ok: false; error: ApiClientError };
const failure = (error: ApiClientError): TripResult<never> => {
  if (error.status === 409 && error.code === "ParticipationConflictError") {
    const confirmation = parseConfirmation(error.details);
    return { ok: false, error: confirmation ? { kind: "participation-conflict", confirmation } : { kind: "server" } };
  }
  return { ok: false, error: { kind: error.kind,
    ...(error.fields ? { fields: error.fields.map(({ field, code, message }) => ({ field, code, message })) } : {}) } };
};
const response = (result: Raw, tripId: string, activityId?: string): TripResult<ActivityResponse> => {
  if (!result.ok) return failure(result.error);
  return record(result.value) && validActivity(result.value.activity, tripId, activityId)
    ? { ok: true, value: result.value.activity } : { ok: false, error: { kind: "server" } };
};
/** A saved activity is accepted even when the author's participation is missing or invalid. */
const created = (result: Raw, tripId: string): TripResult<CreatedActivity> => {
  const saved = response(result, tripId);
  if (!saved.ok || !result.ok) return saved as TripResult<never>;
  const participation = (result.value as Record<string, unknown>).participation;
  return { ok: true, value: { activity: saved.value, participation: validParticipation(participation, tripId, saved.value.id) ? participation : null } };
};
export const createTripActivityApi = (client: Pick<HttpClient, "get" | "post" | "patch" | "delete">): TripActivityApi => ({
  create: async (tripId, input, confirmation) => created(await client.post<unknown>(path(tripId), { ...input, ...confirmation }), tripId),
  get: async (tripId, activityId) => response(await client.get<unknown>(`${path(tripId)}/${encodeURIComponent(activityId)}`), tripId, activityId),
  update: async (tripId, activityId, input) => response(await client.patch<unknown>(`${path(tripId)}/${encodeURIComponent(activityId)}`, input), tripId, activityId),
  remove: async (tripId, activityId) => {
    const result = await client.delete<void>(`${path(tripId)}/${encodeURIComponent(activityId)}`);
    return result.ok ? { ok: true, value: undefined } : failure(result.error);
  },
});
