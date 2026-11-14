import type { ActivityParticipationStatus } from "app-domain";
import { networkCode, type ApiClientError, type HttpClient } from "../api/index.js";
import { parseConfirmation, type ParticipationConfirmation } from "./participation-conflict.js";
import type { TripResult } from "./trip-management-api.js";

/** The only statuses a user can choose; `pending` is a read-only state. */
export type PersonalParticipationStatus = "going" | "not_going";
export type DecisionRequired = { reason: "schedule_conflict"; changedFields: ("scheduledAt" | "durationMinutes")[]; changedAt: string };
export type ParticipationResponse = {
  id: string; tripId: string; activityId: string; userId: string;
  status: ActivityParticipationStatus; updatedAt: string; decisionRequired?: DecisionRequired | null;
};
export type TripParticipationApi = {
  get: (tripId: string, activityId: string) => Promise<TripResult<ParticipationResponse | null>>;
  set: (tripId: string, activityId: string, status: PersonalParticipationStatus, confirmation?: ParticipationConfirmation) => Promise<TripResult<ParticipationResponse>>;
};

const path = (tripId: string, activityId: string) =>
  `/trips/${encodeURIComponent(tripId)}/activities/${encodeURIComponent(activityId)}/participation`;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{24}$/.test(value);
const timestamp = (value: unknown) => typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const changeFields = ["scheduledAt", "durationMinutes"];
const validMark = (value: unknown) => record(value) && value.reason === "schedule_conflict" && Array.isArray(value.changedFields) &&
  value.changedFields.length > 0 && value.changedFields.every((field) => changeFields.includes(field as string)) &&
  new Set(value.changedFields).size === value.changedFields.length && timestamp(value.changedAt);
export const valid = (value: unknown, tripId: string, activityId: string): value is ParticipationResponse => record(value) &&
  (value.decisionRequired === undefined || value.decisionRequired === null || (value.status === "pending" && validMark(value.decisionRequired))) &&
  id(value.id) && id(value.tripId) && value.tripId === tripId && id(value.activityId) && value.activityId === activityId &&
  id(value.userId) && ["going", "not_going", "pending"].includes(value.status as string) && timestamp(value.updatedAt);
const failure = (error: ApiClientError): TripResult<never> => {
  if (error.status === 409 && error.code === "ParticipationConflictError") {
    const confirmation = parseConfirmation(error.details);
    return { ok: false, error: confirmation ? { kind: "participation-conflict", confirmation } : { kind: "server" } };
  }
  return { ok: false, error: { kind: error.kind, ...networkCode(error),
    ...(error.fields ? { fields: error.fields.map(({ field, message }) => ({ field, message })) } : {}) } };
};
const invalid: TripResult<never> = { ok: false, error: { kind: "server" } };

export const createTripParticipationApi = (client: Pick<HttpClient, "get" | "put">): TripParticipationApi => ({
  get: async (tripId, activityId) => {
    const result = await client.get<unknown>(path(tripId, activityId));
    if (!result.ok) return failure(result.error);
    return record(result.value) && (result.value.participation === null || valid(result.value.participation, tripId, activityId))
      ? { ok: true, value: result.value.participation } : invalid;
  },
  set: async (tripId, activityId, status, confirmation) => {
    const result = await client.put<unknown>(path(tripId, activityId), { status, ...confirmation });
    if (!result.ok) return failure(result.error);
    return record(result.value) && valid(result.value.participation, tripId, activityId)
      ? { ok: true, value: result.value.participation } : invalid;
  },
});
