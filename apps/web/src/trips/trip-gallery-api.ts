import type { HttpClient } from "../api/index.js";
import { interactionFailure, isId, isRecord, isTimestamp, serverFailure } from "./api-failure.js";
import type { TripResult } from "./trip-management-api.js";

/** `url` is a signed, short-lived GET URL: it lives only in memory and in an `src`; `expiresAtMs` is epoch ms. */
export type GalleryPhoto = {
  id: string; postId: string; order: number; uploadedAt: string; uploaderId: string; url: string; expiresAtMs: number;
  post: { createdAt: string; authorId: string; rootActivityId: string | null; rootTransportId: string | null };
};
export type GalleryPage = { photos: GalleryPhoto[]; nextCursor: string | null };
export type GalleryQuery = { limit?: number; cursor?: string; activityId?: string; transportId?: string };
export type TripGalleryApi = {
  /** One page, newest post first; the order is the server's and the client never re-sorts or re-paginates. */
  list: (tripId: string, query: GalleryQuery) => Promise<TripResult<GalleryPage>>;
};

const maxPage = 60;
const plainHttps = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  try { const url = new URL(value); return url.protocol === "https:" && url.username === "" && url.password === ""; } catch { return false; }
};
const idOrNull = (value: unknown): value is string | null => value === null || isId(value);

/** Strict and rebuilt field by field: anything off is a server failure and nothing of the payload (never the URL) is echoed. */
const parsePhoto = (value: unknown): GalleryPhoto | undefined => {
  if (!isRecord(value) || !isId(value.id) || !isId(value.postId) || !isId(value.uploaderId) || typeof value.order !== "number" || !Number.isInteger(value.order) ||
    value.order < 0 || !isTimestamp(value.uploadedAt) || !plainHttps(value.url) || !isTimestamp(value.expiresAt)) return undefined;
  const post = value.post;
  if (!isRecord(post) || !isTimestamp(post.createdAt) || !isId(post.authorId) || !idOrNull(post.rootActivityId) || !idOrNull(post.rootTransportId)) return undefined;
  return { id: value.id, postId: value.postId, order: value.order, uploadedAt: value.uploadedAt, uploaderId: value.uploaderId, url: value.url,
    expiresAtMs: Date.parse(value.expiresAt), post: { createdAt: post.createdAt, authorId: post.authorId, rootActivityId: post.rootActivityId, rootTransportId: post.rootTransportId } };
};

export const createTripGalleryApi = (client: Pick<HttpClient, "get">): TripGalleryApi => ({
  list: async (tripId, { limit, cursor, activityId, transportId }) => {
    const query = new URLSearchParams();
    if (limit !== undefined) query.set("limit", String(limit));
    if (cursor !== undefined) query.set("cursor", cursor);
    if (activityId !== undefined) query.set("activityId", activityId);
    if (transportId !== undefined) query.set("transportId", transportId);
    const suffix = query.toString();
    const result = await client.get<unknown>(`/trips/${encodeURIComponent(tripId)}/photos${suffix ? `?${suffix}` : ""}`);
    if (!result.ok) return interactionFailure(result.error);
    const body = result.value;
    if (!isRecord(body) || !Array.isArray(body.photos) || body.photos.length > maxPage) return serverFailure;
    if (body.nextCursor !== null && (typeof body.nextCursor !== "string" || body.nextCursor === "")) return serverFailure;
    const photos = body.photos.map(parsePhoto);
    if (!photos.every((photo) => photo !== undefined) || new Set(photos.map((photo) => photo.id)).size !== photos.length) return serverFailure;
    return { ok: true, value: { photos, nextCursor: body.nextCursor } };
  },
});
