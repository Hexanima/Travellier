import type { ApiClientError, HttpClient } from "../api/index.js";
import type { TripResult } from "./trip-management-api.js";

export type PostResponse = { id: string; tripId: string; authorId: string; description: string | null; mapsUrl: string | null;
  activityId: string | null; parentPostId: string | null; transportId: string | null; createdAt: string };
/** Only content fields: the publication date and the day are decided by the server and can never be sent. */
export type PostInput = { description?: string | null; mapsUrl?: string | null };
/** `parent` and `children` are tolerated without deep validation (used by later tasks). */
export type PostDetail = { post: PostResponse; parent: unknown; children: unknown; rootActivityId: string | null };
export type TripPostApi = {
  list: (tripId: string) => Promise<TripResult<PostResponse[]>>;
  get: (tripId: string, postId: string) => Promise<TripResult<PostDetail>>;
  create: (tripId: string, input: PostInput) => Promise<TripResult<PostResponse>>;
  update: (tripId: string, postId: string, input: PostInput) => Promise<TripResult<PostResponse>>;
};

const path = (tripId: string) => `/trips/${encodeURIComponent(tripId)}/posts`;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{24}$/.test(value);
const nullableText = (value: unknown) => value === null || typeof value === "string";
const optionalId = (value: unknown) => value === undefined || value === null || id(value);
const timestamp = (value: unknown) => typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
/** Tolerant: extra fields and a legacy `dayId` are ignored; absent links count as null. */
const parsePost = (value: unknown, tripId: string, postId?: string): PostResponse | undefined => {
  if (!record(value) || !id(value.id) || (postId !== undefined && value.id !== postId) || value.tripId !== tripId || !id(value.authorId) ||
    !timestamp(value.createdAt) || !nullableText(value.description) || !nullableText(value.mapsUrl) ||
    !optionalId(value.activityId) || !optionalId(value.parentPostId) || !optionalId(value.transportId)) return undefined;
  return { id: value.id, tripId, authorId: value.authorId, description: value.description as string | null, mapsUrl: value.mapsUrl as string | null,
    activityId: (value.activityId as string | null | undefined) ?? null, parentPostId: (value.parentPostId as string | null | undefined) ?? null,
    transportId: (value.transportId as string | null | undefined) ?? null, createdAt: value.createdAt };
};
type Raw = { ok: true; value: unknown } | { ok: false; error: ApiClientError };
const failure = (error: ApiClientError): TripResult<never> => ({ ok: false, error: { kind: error.kind,
  ...(error.fields ? { fields: error.fields.map(({ field, code, message }) => ({ field, code, message })) } : {}) } });
const server: TripResult<never> = { ok: false, error: { kind: "server" } };
const single = (result: Raw, tripId: string, postId?: string): TripResult<PostResponse> => {
  if (!result.ok) return failure(result.error);
  const parsed = record(result.value) ? parsePost(result.value.post, tripId, postId) : undefined;
  return parsed ? { ok: true, value: parsed } : server;
};
/** Only the content fields travel: anything else on `input` (e.g. a forced createdAt) is dropped. */
const body = (input: PostInput): PostInput => ({
  ...(input.description !== undefined ? { description: input.description } : {}),
  ...(input.mapsUrl !== undefined ? { mapsUrl: input.mapsUrl } : {}),
});
export const createTripPostApi = (client: Pick<HttpClient, "get" | "post" | "patch">): TripPostApi => ({
  list: async (tripId) => {
    const result: Raw = await client.get<unknown>(path(tripId));
    if (!result.ok) return failure(result.error);
    if (!record(result.value) || !Array.isArray(result.value.posts)) return server;
    const posts = result.value.posts.map((item) => parsePost(item, tripId));
    return posts.every((post) => post !== undefined) ? { ok: true, value: posts } : server;
  },
  get: async (tripId, postId) => {
    const result: Raw = await client.get<unknown>(`${path(tripId)}/${encodeURIComponent(postId)}`);
    if (!result.ok) return failure(result.error);
    const post = record(result.value) ? parsePost(result.value.post, tripId, postId) : undefined;
    if (!post || !record(result.value)) return server;
    const rootActivityId = result.value.rootActivityId;
    return { ok: true, value: { post, parent: result.value.parent ?? null, children: result.value.children ?? [],
      rootActivityId: id(rootActivityId) ? rootActivityId : null } };
  },
  create: async (tripId, input) => single(await client.post<unknown>(path(tripId), body(input)), tripId),
  update: async (tripId, postId, input) => single(await client.patch<unknown>(`${path(tripId)}/${encodeURIComponent(postId)}`, body(input)), tripId, postId),
});
