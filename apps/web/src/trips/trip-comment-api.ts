import type { ApiClientError, HttpClient } from "../api/index.js";
import { interactionFailure, isId, isRecord, isTimestamp, serverFailure } from "./api-failure.js";
import type { TripResult } from "./trip-management-api.js";

/** `authorIsFormerMember` comes from the server; the author's name does not: the client resolves it from the current members. */
export type CommentResponse = { id: string; tripId: string; postId: string; authorId: string; text: string; createdAt: string; authorIsFormerMember: boolean };
export type TripCommentApi = {
  list: (tripId: string, postId: string) => Promise<TripResult<CommentResponse[]>>;
  /** Not idempotent on the server: the caller must not resend after an unconfirmed failure without checking the list. */
  create: (tripId: string, postId: string, text: string) => Promise<TripResult<CommentResponse>>;
  update: (tripId: string, postId: string, commentId: string, text: string) => Promise<TripResult<CommentResponse>>;
  /** 204 without a body; a missing comment answers not-found with `CommentNotFoundError`. */
  remove: (tripId: string, postId: string, commentId: string) => Promise<TripResult<void>>;
};

const path = (tripId: string, postId: string) => `/trips/${encodeURIComponent(tripId)}/posts/${encodeURIComponent(postId)}/comments`;
/** Strict: anything off is a server failure; no content is invented. */
export const parseComment = (value: unknown, tripId: string, postId: string, commentId?: string): CommentResponse | undefined => {
  if (!isRecord(value) || !isId(value.id) || (commentId !== undefined && value.id !== commentId) || value.tripId !== tripId || value.postId !== postId ||
    !isId(value.authorId) || typeof value.text !== "string" || !isTimestamp(value.createdAt) || typeof value.authorIsFormerMember !== "boolean") return undefined;
  return { id: value.id, tripId, postId, authorId: value.authorId, text: value.text, createdAt: value.createdAt, authorIsFormerMember: value.authorIsFormerMember };
};
/** Oldest first; the id breaks ties so the order is stable. */
export const oldestFirst = (a: CommentResponse, b: CommentResponse) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id);
type Raw = { ok: true; value: unknown } | { ok: false; error: ApiClientError };
const single = (result: Raw, tripId: string, postId: string, commentId?: string): TripResult<CommentResponse> => {
  if (!result.ok) return interactionFailure(result.error);
  const parsed = isRecord(result.value) ? parseComment(result.value.comment, tripId, postId, commentId) : undefined;
  return parsed ? { ok: true, value: parsed } : serverFailure;
};

export const createTripCommentApi = (client: Pick<HttpClient, "get" | "post" | "patch" | "delete">): TripCommentApi => ({
  list: async (tripId, postId) => {
    const result: Raw = await client.get<unknown>(path(tripId, postId));
    if (!result.ok) return interactionFailure(result.error);
    if (!isRecord(result.value) || !Array.isArray(result.value.comments)) return serverFailure;
    const comments = result.value.comments.map((item) => parseComment(item, tripId, postId));
    if (!comments.every((item) => item !== undefined)) return serverFailure;
    if (new Set(comments.map((item) => item.id)).size !== comments.length) return serverFailure;
    return { ok: true, value: comments.sort(oldestFirst) };
  },
  create: async (tripId, postId, text) => single(await client.post<unknown>(path(tripId, postId), { text }), tripId, postId),
  update: async (tripId, postId, commentId, text) =>
    single(await client.patch<unknown>(`${path(tripId, postId)}/${encodeURIComponent(commentId)}`, { text }), tripId, postId, commentId),
  remove: async (tripId, postId, commentId) => {
    const result = await client.delete<void>(`${path(tripId, postId)}/${encodeURIComponent(commentId)}`);
    return result.ok ? { ok: true, value: undefined } : interactionFailure(result.error);
  },
});
