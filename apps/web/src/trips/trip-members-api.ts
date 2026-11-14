import { networkCode, type ApiErrorKind, type HttpClient } from "../api/index.js";

export type TripMemberRole = "admin" | "participant";

export type TripMemberSummary = {
  id: string;
  userId: string;
  name: string | null;
  role: TripMemberRole;
  joinedAt: string;
  /** Absent in older answers; the owner is also identified by `ownerId` in the listing. */
  isOwner?: boolean;
};

export type TripMemberList = { members: TripMemberSummary[]; currentUserId: string; ownerId?: string | null };

export type TripMembersResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { kind: ApiErrorKind; code?: string } };

export type TripMembersApi = {
  list: (tripId: string) => Promise<TripMembersResult<TripMemberList>>;
  expel: (tripId: string, userId: string) => Promise<TripMembersResult<void>>;
  setRole: (tripId: string, userId: string, role: TripMemberRole) => Promise<TripMembersResult<void>>;
  transferOwnership: (tripId: string, userId: string) => Promise<TripMembersResult<void>>;
  leave: (tripId: string) => Promise<TripMembersResult<void>>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isMember = (value: unknown): value is TripMemberSummary =>
  isRecord(value) && typeof value.id === "string" && typeof value.userId === "string" &&
  (typeof value.name === "string" || value.name === null) && (value.role === "admin" || value.role === "participant") &&
  typeof value.joinedAt === "string" && (value.isOwner === undefined || typeof value.isOwner === "boolean");

const isMemberList = (value: unknown): value is TripMemberList =>
  isRecord(value) && typeof value.currentUserId === "string" &&
  (value.ownerId === undefined || value.ownerId === null || typeof value.ownerId === "string") &&
  Array.isArray(value.members) && value.members.every(isMember);

type Failure = { ok: false; error: { kind: ApiErrorKind; code?: string } };
type Outcome = { ok: true; value: unknown } | { ok: false; error: { kind: ApiErrorKind; code?: string; fields?: readonly { code: string }[] } };

const done = (result: Outcome): TripMembersResult<void> => {
  if (result.ok) return { ok: true, value: undefined };
  const { kind, code, fields } = result.error;
  const failure: Failure = { ok: false, error: { kind } };
  if (kind === "validation" && fields?.some((field) => field.code === "same_owner")) failure.error.code = "same_owner";
  else if (code && code !== "HttpError") failure.error.code = code;
  return failure;
};

export const createTripMembersApi = (client: Pick<HttpClient, "get" | "delete" | "put" | "post">): TripMembersApi => {
  const base = (tripId: string) => `/trips/${encodeURIComponent(tripId)}`;
  return {
    list: async (tripId) => {
      const result = await client.get<unknown>(`${base(tripId)}/members`);
      if (!result.ok) return { ok: false, error: { kind: result.error.kind, ...networkCode(result.error) } };
      return isMemberList(result.value)
        ? { ok: true, value: result.value }
        : { ok: false, error: { kind: "server" } };
    },
    expel: async (tripId, userId) => done(await client.delete<void>(`${base(tripId)}/members/${encodeURIComponent(userId)}`)),
    setRole: async (tripId, userId, role) =>
      done(await client.put<void>(`${base(tripId)}/members/${encodeURIComponent(userId)}/role`, { role })),
    transferOwnership: async (tripId, userId) => done(await client.post<void>(`${base(tripId)}/transfer-ownership`, { userId })),
    leave: async (tripId) => done(await client.post<void>(`${base(tripId)}/leave`)),
  };
};
