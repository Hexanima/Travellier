import type { ActivityStatus, ActivityVoteValue } from "app-domain";
import type { ApiClientError, HttpClient } from "../api/index.js";
import type { TripFailure, TripResult } from "./trip-management-api.js";

export type VoteResponse = {
  id: string; tripId: string; activityId: string; userId: string;
  value: ActivityVoteValue; createdAt: string;
};
export type ActivityVoteResponse = { vote: VoteResponse | null; activityStatus: ActivityStatus };
export type TripVoteApi = {
  get: (tripId: string, activityId: string) => Promise<TripResult<ActivityVoteResponse>>;
  set: (tripId: string, activityId: string, value: ActivityVoteValue) => Promise<TripResult<ActivityVoteResponse & { vote: VoteResponse }>>;
};

const path = (tripId: string, activityId: string) =>
  `/trips/${encodeURIComponent(tripId)}/activities/${encodeURIComponent(activityId)}/vote`;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{24}$/.test(value);
const timestamp = (value: unknown) => typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const validVote = (value: unknown, tripId: string, activityId: string): value is VoteResponse => record(value) &&
  id(value.id) && id(value.tripId) && value.tripId === tripId && id(value.activityId) && value.activityId === activityId &&
  id(value.userId) && (value.value === "up" || value.value === "down") && timestamp(value.createdAt);
const valid = (value: unknown, tripId: string, activityId: string): value is ActivityVoteResponse => record(value) &&
  ["proposed", "voting", "confirmed"].includes(value.activityStatus as string) &&
  (value.vote === null || validVote(value.vote, tripId, activityId));
const invalid: TripResult<never> = { ok: false, error: { kind: "server" } };
const failure = (error: ApiClientError): TripFailure =>
  error.status === 409 && error.code === "ActivityVotingDisabledError" ? { kind: "voting-disabled" } :
  error.status === 409 && error.code === "ActivityVotingClosedError" ? { kind: "voting-closed" } :
  { kind: error.kind, ...(error.fields ? { fields: error.fields.map(({ field, message }) => ({ field, message })) } : {}) };

export const createTripVoteApi = (client: Pick<HttpClient, "get" | "put">): TripVoteApi => ({
  get: async (tripId, activityId) => {
    const result = await client.get<unknown>(path(tripId, activityId));
    if (!result.ok) return { ok: false, error: failure(result.error) };
    return valid(result.value, tripId, activityId) ? { ok: true, value: result.value } : invalid;
  },
  set: async (tripId, activityId, value) => {
    const result = await client.put<unknown>(path(tripId, activityId), { value });
    if (!result.ok) return { ok: false, error: failure(result.error) };
    return valid(result.value, tripId, activityId) && result.value.vote !== null
      ? { ok: true, value: { ...result.value, vote: result.value.vote } } : invalid;
  },
});
