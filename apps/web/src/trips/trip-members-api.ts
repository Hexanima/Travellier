import type { ApiErrorKind, HttpClient } from "../api/index.js";

export type TripMemberSummary = {
  id: string;
  userId: string;
  name: string;
  role: "admin" | "participant";
  joinedAt: string;
};

export type TripMembersResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { kind: ApiErrorKind } };

export type TripMembersApi = {
  list: (tripId: string) => Promise<TripMembersResult<{ members: TripMemberSummary[]; currentUserId: string }>>;
  expel: (tripId: string, userId: string) => Promise<TripMembersResult<void>>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isMember = (value: unknown): value is TripMemberSummary =>
  isRecord(value) && typeof value.id === "string" && typeof value.userId === "string" &&
  typeof value.name === "string" && (value.role === "admin" || value.role === "participant") &&
  typeof value.joinedAt === "string";

const isMemberList = (value: unknown): value is { members: TripMemberSummary[]; currentUserId: string } =>
  isRecord(value) && typeof value.currentUserId === "string" &&
  Array.isArray(value.members) && value.members.every(isMember);

export const createTripMembersApi = (client: Pick<HttpClient, "get" | "delete">): TripMembersApi => ({
  list: async (tripId) => {
    const result = await client.get<unknown>(`/trips/${encodeURIComponent(tripId)}/members`);
    if (!result.ok) return { ok: false, error: { kind: result.error.kind } };
    return isMemberList(result.value)
      ? { ok: true, value: result.value }
      : { ok: false, error: { kind: "server" } };
  },
  expel: async (tripId, userId) => {
    const result = await client.delete<void>(`/trips/${encodeURIComponent(tripId)}/members/${encodeURIComponent(userId)}`);
    return result.ok
      ? { ok: true, value: undefined }
      : { ok: false, error: { kind: result.error.kind } };
  },
});
