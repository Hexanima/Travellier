import type { ParticipationConfirmation } from "./participation-conflict.js";
import { networkCode, type ApiClientError, type HttpClient, type ApiErrorKind } from "../api/index.js";

export type TripSummary = {
  id: string;
  name: string;
  description: string | null;
  primaryDestination: { name: string };
};

/** Item of the Trip list: the dates derive from the transports and are ISO UTC instants or null (the list never reads each itinerary). */
export type TripListItem = Omit<TripSummary, "primaryDestination"> & {
  /** Null when the Trip has no primary destination (incomplete data). */
  primaryDestination: { name: string } | null;
  startAt?: string | null;
  endAt?: string | null;
};

export type CreateTripInput = { name: string; primaryDestination: string; description?: string };
export type TripVisibility = "private" | "public";
export type TripExpenseMode = "register" | "balance";
export type TripConfigurationUpdate = {
  visibility?: TripVisibility;
  expenseMode?: TripExpenseMode;
};
export type MemberTripDetail = TripSummary & {
  kind: "member";
  visibility: TripVisibility;
  inviteCode: string;
  expenseMode: TripExpenseMode;
};
export type PublicTripDetail = TripSummary & { kind: "public"; visibility: "public" };
export type TripDetail = MemberTripDetail | PublicTripDetail;
export type PublicTripJoinResult = { tripId: string; joined: boolean };
export type TripFailure = { kind: ApiErrorKind | "itinerary-conflict" | "deletion-conflict" | "last-destination" | "participation-conflict" | "already-saved";
  /** Only with `already-saved`: the saved post of this person in this Trip, when the server sent a valid one. */
  postId?: string;
  fields?: readonly { field: string; message: string; code?: string }[]; confirmation?: ParticipationConfirmation; code?: string };
export type TripResult<T> = { ok: true; value: T } | { ok: false; error: TripFailure };
export type TripManagementApi = {
  list: () => Promise<TripResult<TripListItem[]>>;
  listPublic: () => Promise<TripResult<PublicTripDetail[]>>;
  joinPublic: (tripId: string) => Promise<TripResult<PublicTripJoinResult>>;
  create: (input: CreateTripInput) => Promise<TripResult<TripSummary>>;
  get: (tripId: string) => Promise<TripResult<TripDetail>>;
  deleteTrip: (tripId: string) => Promise<TripResult<void>>;
  updateConfiguration: (tripId: string, input: TripConfigurationUpdate) => Promise<TripResult<MemberTripDetail>>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isListedTrip = (value: unknown): value is Omit<TripListItem, "startAt" | "endAt"> & Record<string, unknown> =>
  isRecord(value) && typeof value.id === "string" && typeof value.name === "string" &&
  (typeof value.description === "string" || value.description === null) &&
  (value.primaryDestination === null || (isRecord(value.primaryDestination) && typeof value.primaryDestination.name === "string"));

const isTripSummary = (value: unknown): value is TripSummary & Record<string, unknown> =>
  isListedTrip(value) && value.primaryDestination !== null;

/** A missing, non-string or unparseable date is null: a bad date never fails the whole list. */
const toInstant = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
};

const toListItem = (value: Omit<TripListItem, "startAt" | "endAt"> & Record<string, unknown>): TripListItem => ({
  ...value, startAt: toInstant(value.startAt), endAt: toInstant(value.endAt),
});

const isMemberTrip = (value: unknown): value is Omit<MemberTripDetail, "kind"> =>
  isTripSummary(value) && isRecord(value) &&
  (value.visibility === "private" || value.visibility === "public") &&
  typeof value.inviteCode === "string" && value.inviteCode.trim() !== "" &&
  (value.expenseMode === "register" || value.expenseMode === "balance");

const isPublicTrip = (value: unknown): value is Omit<PublicTripDetail, "kind"> =>
  isTripSummary(value) && isRecord(value) && value.visibility === "public" &&
  !("inviteCode" in value) && !("expenseMode" in value) &&
  !("createdBy" in value) && !("createdAt" in value);

const toPublicTrip = (value: Omit<PublicTripDetail, "kind">): PublicTripDetail => ({
  id: value.id,
  name: value.name,
  description: value.description,
  visibility: "public",
  primaryDestination: { name: value.primaryDestination.name },
  kind: "public",
});

const isPublicJoinResult = (value: unknown): value is PublicTripJoinResult =>
  isRecord(value) && typeof value.tripId === "string" && typeof value.joined === "boolean";

const parseTripDetail = (value: unknown): TripDetail | undefined => {
  if (isMemberTrip(value)) return { ...value, kind: "member" };
  if (isPublicTrip(value)) return toPublicTrip(value);
  return undefined;
};

const toFailure = (error: ApiClientError): TripFailure =>
  error.kind === "validation" && error.fields !== undefined
    ? { kind: error.kind, fields: error.fields.map(({ field, message }) => ({ field, message })) }
    : { kind: error.kind, ...networkCode(error) };

export const createTripManagementApi = (client: Pick<HttpClient, "get" | "post" | "patch" | "delete">): TripManagementApi => ({
  deleteTrip: async (tripId) => {
    const result = await client.delete<void>(`/trips/${encodeURIComponent(tripId)}`);
    return result.ok ? { ok: true, value: undefined } : { ok: false, error: toFailure(result.error) };
  },
  list: async () => {
    const result = await client.get<unknown>("/trips");
    if (!result.ok) return { ok: false, error: toFailure(result.error) };
    return isRecord(result.value) && Array.isArray(result.value.trips) && result.value.trips.every(isListedTrip)
      ? { ok: true, value: result.value.trips.map(toListItem) }
      : { ok: false, error: { kind: "server" } };
  },
  listPublic: async () => {
    const result = await client.get<unknown>("/trips/public");
    if (!result.ok) return { ok: false, error: toFailure(result.error) };
    return isRecord(result.value) && Array.isArray(result.value.trips) && result.value.trips.every(isPublicTrip)
      ? { ok: true, value: result.value.trips.map(toPublicTrip) }
      : { ok: false, error: { kind: "server" } };
  },
  joinPublic: async (tripId) => {
    const result = await client.post<unknown>(`/trips/${encodeURIComponent(tripId)}/join`);
    if (!result.ok) return { ok: false, error: toFailure(result.error) };
    return isPublicJoinResult(result.value) && result.value.tripId === tripId
      ? { ok: true, value: result.value }
      : { ok: false, error: { kind: "server" } };
  },
  create: async (input) => {
    const result = await client.post<unknown>("/trips", input);
    if (!result.ok) return { ok: false, error: toFailure(result.error) };
    return isRecord(result.value) && isTripSummary(result.value.trip)
      ? { ok: true, value: result.value.trip }
      : { ok: false, error: { kind: "server" } };
  },
  get: async (tripId) => {
    const result = await client.get<unknown>(`/trips/${encodeURIComponent(tripId)}`);
    if (!result.ok) return { ok: false, error: toFailure(result.error) };
    const trip = isRecord(result.value) ? parseTripDetail(result.value.trip) : undefined;
    return trip === undefined
      ? { ok: false, error: { kind: "server" } }
      : { ok: true, value: trip };
  },
  updateConfiguration: async (tripId, input) => {
    const payload = {
      ...(input.visibility === undefined ? {} : { visibility: input.visibility }),
      ...(input.expenseMode === undefined ? {} : { expenseMode: input.expenseMode }),
    };
    const result = await client.patch<unknown>(`/trips/${encodeURIComponent(tripId)}/config`, payload);
    if (!result.ok) return { ok: false, error: toFailure(result.error) };
    const trip = isRecord(result.value) ? parseTripDetail(result.value.trip) : undefined;
    return trip?.kind === "member"
      ? { ok: true, value: trip }
      : { ok: false, error: { kind: "server" } };
  },
});
