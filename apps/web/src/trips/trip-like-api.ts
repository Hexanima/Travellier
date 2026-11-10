import type { ApiClientError, HttpClient } from "../api/index.js";
import { interactionFailure, isId, isRecord, serverFailure } from "./api-failure.js";
import type { TripResult } from "./trip-management-api.js";

export type LikeState = { liked: boolean; count: number };
/** Initial counters: `comments` is keyed by comment id; a comment missing from it has no known counter. */
export type LikesSummary = { post: { count: number; likedByMe: boolean }; comments: Record<string, { count: number; likedByMe: boolean }> };
export type TripLikeApi = {
  summary: (tripId: string, postId: string) => Promise<TripResult<LikesSummary>>;
  /** Idempotent: PUT likes, DELETE removes the like; the server answers with the resulting state. */
  setPostLike: (tripId: string, postId: string, liked: boolean) => Promise<TripResult<LikeState>>;
  setCommentLike: (tripId: string, postId: string, commentId: string, liked: boolean) => Promise<TripResult<LikeState>>;
};

const postPath = (tripId: string, postId: string) => `/trips/${encodeURIComponent(tripId)}/posts/${encodeURIComponent(postId)}`;
const validCount = (count: unknown): count is number => typeof count === "number" && Number.isInteger(count) && count >= 0;
/** A liked state with a zero count is contradictory, so it is a server failure rather than something to repair. */
const consistent = (liked: boolean, count: number) => !liked || count >= 1;
const parseLike = (value: unknown): LikeState | undefined => isRecord(value) && typeof value.liked === "boolean" && validCount(value.count) && consistent(value.liked, value.count)
  ? { liked: value.liked, count: value.count } : undefined;
const parseCounter = (value: unknown): { count: number; likedByMe: boolean } | undefined => isRecord(value) && typeof value.likedByMe === "boolean" && validCount(value.count) &&
  consistent(value.likedByMe, value.count) ? { count: value.count, likedByMe: value.likedByMe } : undefined;
type Raw = { ok: true; value: unknown } | { ok: false; error: ApiClientError };
const single = (result: Raw): TripResult<LikeState> => {
  if (!result.ok) return interactionFailure(result.error);
  const like = isRecord(result.value) ? parseLike(result.value.like) : undefined;
  return like ? { ok: true, value: like } : serverFailure;
};

export const createTripLikeApi = (client: Pick<HttpClient, "get" | "put" | "delete">): TripLikeApi => {
  const set = async (url: string, liked: boolean): Promise<TripResult<LikeState>> =>
    single(liked ? await client.put<unknown>(url) : await client.delete<unknown>(url));
  return {
    summary: async (tripId, postId) => {
      const result: Raw = await client.get<unknown>(`${postPath(tripId, postId)}/likes`);
      if (!result.ok) return interactionFailure(result.error);
      if (!isRecord(result.value) || !Array.isArray(result.value.comments)) return serverFailure;
      const post = parseCounter(result.value.post);
      if (!post) return serverFailure;
      const comments: LikesSummary["comments"] = {};
      for (const item of result.value.comments) {
        const counter = parseCounter(item);
        if (!isRecord(item) || !isId(item.commentId) || !counter || item.commentId in comments) return serverFailure;
        comments[item.commentId] = counter;
      }
      return { ok: true, value: { post, comments } };
    },
    setPostLike: (tripId, postId, liked) => set(`${postPath(tripId, postId)}/like`, liked),
    setCommentLike: (tripId, postId, commentId, liked) => set(`${postPath(tripId, postId)}/comments/${encodeURIComponent(commentId)}/like`, liked),
  };
};
