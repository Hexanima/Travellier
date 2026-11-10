import type { ApiClientError, HttpClient } from "../api/index.js";
import type { TripResult } from "./trip-management-api.js";
import { parseConfirmation, type ParticipationConfirmation } from "./participation-conflict.js";
import { validActivity, type ActivityResponse } from "./trip-activity-api.js";
import { valid as validParticipation, type ParticipationResponse } from "./trip-participation-api.js";

export type PostResponse = { id: string; tripId: string; authorId: string; description: string | null; mapsUrl: string | null;
  activityId: string | null; parentPostId: string | null; transportId: string | null; createdAt: string };
/** Only content fields: the publication date and the day are decided by the server and can never be sent. */
export type NewActivityInput = { title: string; scheduledAt: string; durationMinutes?: number | null; description?: string | null; mapsUrl?: string | null };
/** Only these three fields travel: payments and shares are never sent, so a merge-patch keeps them. `breakdown: null` clears it. */
export type ExpenseInput = { totalAmount?: number; currency?: "ARS" | "EUR" | "USD"; breakdown?: string | null };
/** `newActivity` creates the activity together with the post; the server derives its day, so `dayId` is never sent. */
export type PostInput = { description?: string | null; mapsUrl?: string | null; parentPostId?: string | null; activityId?: string | null; transportId?: string | null;
  newActivity?: NewActivityInput; photos?: { key: string }[]; expense?: ExpenseInput };
/** What the server stored for the expense (the currency is null only in legacy data); payments and shares are not read here. */
export type SavedExpenseResponse = { postId: string; totalAmount: number; currency: "ARS" | "EUR" | "USD" | null; breakdown: string | null };
/** `activity` and `participation` are present only when a new activity was sent; `expense` only when an expense was sent. */
export type SavedPost = PostResponse & { activity?: ActivityResponse; participation?: ParticipationResponse | null; expense?: SavedExpenseResponse };
/** Summary of a chained post: the server sends only these fields for the immediate parent and the direct children. */
export type PostSummary = { id: string; authorId: string; createdAt: string; description: string | null };
/** `parent` is the immediate parent (null when absent or not visible); `children` are only the direct children, newest first. */
export type PostDetail = { post: PostResponse; parent: PostSummary | null; children: PostSummary[]; rootActivityId: string | null };
export type TripPostApi = {
  list: (tripId: string) => Promise<TripResult<PostResponse[]>>;
  get: (tripId: string, postId: string) => Promise<TripResult<PostDetail>>;
  create: (tripId: string, input: PostInput, confirmation?: ParticipationConfirmation) => Promise<TripResult<SavedPost>>;
  update: (tripId: string, postId: string, input: PostInput, confirmation?: ParticipationConfirmation) => Promise<TripResult<SavedPost>>;
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
    transportId: (value.transportId as string | null | undefined) ?? null, createdAt: value.createdAt as string };
};
/** Strict: a present summary with an invalid id, timestamp or text is a server failure (no content is invented). */
const parseSummary = (value: unknown): PostSummary | undefined => {
  if (!record(value) || !id(value.id) || !id(value.authorId) || !timestamp(value.createdAt) || !nullableText(value.description)) return undefined;
  return { id: value.id, authorId: value.authorId, createdAt: value.createdAt as string, description: value.description as string | null };
};
const newestFirst = (a: PostSummary, b: PostSummary) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id);
type Raw = { ok: true; value: unknown } | { ok: false; error: ApiClientError };
const failure = (error: ApiClientError): TripResult<never> => {
  if (error.status === 409 && error.code === "ParticipationConflictError") {
    const confirmation = parseConfirmation(error.details);
    return { ok: false, error: confirmation ? { kind: "participation-conflict", confirmation } : { kind: "server" } };
  }
  if (error.status === 409 && error.code === "PhotoConflictError") return { ok: false, error: { kind: "server", code: "PhotoConflictError" } };
  return { ok: false, error: { kind: error.kind,
    ...(error.fields ? { fields: error.fields.map(({ field, code, message }) => ({ field, code, message })) } : {}) } };
};
const server: TripResult<never> = { ok: false, error: { kind: "server" } };
/** Strict, and only when the request carried an expense: it must belong to this post and have a finite amount and a known currency. */
const parseExpense = (value: unknown, tripId: string, postId: string): SavedExpenseResponse | undefined => {
  if (!record(value) || value.tripId !== tripId || value.postId !== postId || typeof value.totalAmount !== "number" || !Number.isFinite(value.totalAmount) ||
    !(value.currency === null || value.currency === undefined || value.currency === "ARS" || value.currency === "EUR" || value.currency === "USD") ||
    !nullableText(value.breakdown ?? null)) return undefined;
  return { postId, totalAmount: value.totalAmount, currency: (value.currency as SavedExpenseResponse["currency"] | undefined) ?? null, breakdown: (value.breakdown as string | null | undefined) ?? null };
};
const single = (result: Raw, tripId: string, postId?: string, withActivity = false, withExpense = false): TripResult<SavedPost> => {
  if (!result.ok) return failure(result.error);
  const parsed = record(result.value) ? parsePost(result.value.post, tripId, postId) : undefined;
  if (!parsed || !record(result.value)) return server;
  const expense = withExpense ? parseExpense(result.value.expense, tripId, parsed.id) : undefined;
  // An expense that was sent but not confirmed must not be announced as saved either.
  if (withExpense && !expense) return server;
  const withSaved = (saved: SavedPost): SavedPost => expense ? { ...saved, expense } : saved;
  if (!withActivity) return { ok: true, value: withSaved(parsed) };
  // A post saved without its activity must not be announced as a success: the activity is the point of the request.
  if (!validActivity(result.value.activity, tripId)) return server;
  const { activity, participation } = result.value;
  return { ok: true, value: withSaved({ ...parsed, activity, participation: validParticipation(participation, tripId, activity.id) ? participation : null }) };
};
/** Only content and link fields travel (null is meaningful: it clears a link): anything else on `input` (e.g. a forced createdAt) is dropped. */
const newActivityBody = (value: NewActivityInput): NewActivityInput => ({ title: value.title, scheduledAt: value.scheduledAt,
  ...(value.durationMinutes !== undefined ? { durationMinutes: value.durationMinutes } : {}),
  ...(value.description !== undefined ? { description: value.description } : {}),
  ...(value.mapsUrl !== undefined ? { mapsUrl: value.mapsUrl } : {}) });
/** Allow list: payments, shares and `paidBy` never travel; `null` is never a valid expense and an empty object carries nothing. */
const expenseBody = (value: ExpenseInput | null | undefined): Pick<PostInput, "expense"> => {
  if (typeof value !== "object" || value === null) return {};
  const expense: ExpenseInput = { ...(value.totalAmount !== undefined ? { totalAmount: value.totalAmount } : {}),
    ...(value.currency !== undefined ? { currency: value.currency } : {}), ...(value.breakdown !== undefined ? { breakdown: value.breakdown } : {}) };
  return Object.keys(expense).length > 0 ? { expense } : {};
};
const carriesExpense = (input: PostInput) => expenseBody(input.expense).expense !== undefined;
/** The confirmation of a previous 409 travels at the root of the body, never inside `newActivity`. */
const body = (input: PostInput, confirmation?: ParticipationConfirmation): PostInput => ({
  ...(input.description !== undefined ? { description: input.description } : {}),
  ...(input.mapsUrl !== undefined ? { mapsUrl: input.mapsUrl } : {}),
  ...(input.parentPostId !== undefined ? { parentPostId: input.parentPostId } : {}),
  ...(input.activityId !== undefined ? { activityId: input.activityId } : {}),
  ...(input.transportId !== undefined ? { transportId: input.transportId } : {}),
  ...(input.newActivity !== undefined ? { newActivity: newActivityBody(input.newActivity) } : {}),
  ...(input.photos !== undefined ? { photos: input.photos.map(({ key }) => ({ key })) } : {}),
  ...expenseBody(input.expense),
  ...(confirmation ? { confirmedConflicts: confirmation.confirmedConflicts, confirmedActivity: confirmation.confirmedActivity } : {}),
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
    const rawParent = result.value.parent;
    const parent = rawParent === undefined || rawParent === null ? null : parseSummary(rawParent);
    const rawChildren = result.value.children ?? [];
    if (parent === undefined || !Array.isArray(rawChildren)) return server;
    const children = rawChildren.map(parseSummary);
    if (!children.every((child) => child !== undefined)) return server;
    return { ok: true, value: { post, parent, children: children.sort(newestFirst), rootActivityId: id(rootActivityId) ? rootActivityId : null } };
  },
  create: async (tripId, input, confirmation) => single(await client.post<unknown>(path(tripId), body(input, confirmation)), tripId, undefined, input.newActivity !== undefined, carriesExpense(input)),
  update: async (tripId, postId, input, confirmation) => single(await client.patch<unknown>(`${path(tripId)}/${encodeURIComponent(postId)}`, body(input, confirmation)),
    tripId, postId, input.newActivity !== undefined, carriesExpense(input)),
});
