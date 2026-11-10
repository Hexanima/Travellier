import { readTransport, type ObjectId, type TripItinerary } from "app-domain";
import { journeyTransportForDomain } from "./trip-journey-api.js";
import type { HttpClient } from "../api/index.js";
import type { TripResult } from "./trip-management-api.js";

/** HTTP serialization is distinct from domain entities: IDs and UTC dates arrive as strings. */
type Serialized<T> = T extends Date ? string : T extends ObjectId ? string :
  T extends readonly (infer U)[] ? Serialized<U>[] : T extends object ? { [K in keyof T]: Serialized<T[K]> } : T;
type ActiveItineraryResponse = Serialized<TripItinerary>;
/** Where a memory is projected, as computed by the backend from the chain of posts. */
export type ItineraryPostContext = {
  parentPostId: string | null; rootPostId: string; rootActivityId: string | null; rootTransportId: string | null;
  placement: "activity" | "transport" | "independent";
};
/** The post's day is no longer part of the client contract: a legacy `dayId` is tolerated but ignored at runtime. */
/** `paidBy` may be absent in older payloads (the validator accepts it); null or absent means nobody is recorded as payer. */
type ItineraryExpenseResponse = Omit<NonNullable<ActiveItineraryResponse["posts"][number]["expense"]>, "paidBy"> & { paidBy?: string | null };
export type ItineraryPostResponse = Omit<ActiveItineraryResponse["posts"][number], "dayId" | "context" | "expense"> &
  { context: ItineraryPostContext; expense: ItineraryExpenseResponse | null };
export type TripItineraryResponse = Omit<ActiveItineraryResponse, "activities" | "posts" | "unplacedPosts"> & {
  // durationMinutes stays optional on the client: older payloads and fixtures may omit it; null or absent means no duration.
  activities: (Omit<ActiveItineraryResponse["activities"][number], "durationMinutes"> &
    { durationMinutes?: number | null })[];
  posts: ItineraryPostResponse[];
  /** Posts with no projectable day; the client places them by publication or outside the itinerary. */
  unplacedPosts: ItineraryPostResponse[];
};
export type ItineraryDayResponse = TripItineraryResponse["days"][number];
export type ItineraryActivityResponse = TripItineraryResponse["activities"][number];
export type ItineraryTransportResponse = TripItineraryResponse["transports"][number];
export type TripItineraryApi = { get: (tripId: string) => Promise<TripResult<TripItineraryResponse>> };

type RecordValue = Record<string, unknown>;
const record = (v: unknown): v is RecordValue => typeof v === "object" && v !== null && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{24}$/.test(v);
const text = (v: unknown): v is string => typeof v === "string";
const nullableText = (v: unknown) => v === null || text(v);
const nullableId = (v: unknown) => v === null || id(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const timestamp = (v: unknown): v is string => text(v) &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) &&
  Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const order = (v: unknown) => Number.isSafeInteger(v) && (v as number) > 0;
const ids = (v: unknown): v is string[] => Array.isArray(v) && v.every(id) && new Set(v).size === v.length;
const list = (v: unknown, valid: (item: unknown) => boolean): v is RecordValue[] =>
  Array.isArray(v) && v.every(valid);
const entity = (v: unknown): v is RecordValue => record(v) && id(v.id) && id(v.tripId);
const count = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
const currencies = ["ARS", "EUR", "USD"];
const currencyTotal = (v: unknown) => record(v) && currencies.includes(v.currency as string) && count(v.totalCents) && count(v.expenseCount);
const totals = (v: unknown) => record(v) && list(v.byCurrency, currencyTotal) && record(v.withoutCurrency) && count(v.withoutCurrency.expenseCount);
const summary = (v: unknown) => totals(v) && count((v as RecordValue).expenseCount);
const tripSummary = (v: unknown) => summary(v) && summary((v as RecordValue).outsideItinerary);
const attribution = (v: unknown) => record(v) && id(v.expenseId) && id(v.postId) && id(v.rootPostId) && ["activity", "publication"].includes(v.source as string) &&
  nullableId(v.rootActivityId) && timestamp(v.occurredAt) && timestamp(v.publishedAt) && nullableId(v.dayId) &&
  (v.currency === null || currencies.includes(v.currency as string)) && (v.amountCents === null || count(v.amountCents));
const destination = (v: unknown) => entity(v) && text(v.name) && order(v.order) && timestamp(v.createdAt);
const item = (v: unknown) => record(v) && ["transport", "activity", "post"].includes(v.kind as string) && id(v.id) && timestamp(v.at);
const day = (v: unknown) => entity(v) && id(v.destinationId) && timestamp(v.date) &&
  ["transit_out", "activity", "transit_return"].includes(v.type as string) && timestamp(v.startsAt) &&
  (v.endsAt === null || (timestamp(v.endsAt) && Date.parse(v.endsAt) >= Date.parse(v.startsAt))) &&
  order(v.order) && list(v.items, item) && summary(v.expenseSummary);
const duration = (v: unknown) => v === undefined || v === null || (Number.isSafeInteger(v) && (v as number) > 0);
const activity = (v: unknown) => entity(v) && id(v.dayId) && text(v.title) && nullableText(v.description) && duration(v.durationMinutes) &&
  timestamp(v.scheduledAt) && nullableText(v.mapsUrl) &&
  id(v.createdBy) && timestamp(v.createdAt) && ids(v.postIds);
const expense = (v: unknown) => entity(v) && id(v.postId) && finite(v.totalAmount) && (v.currency === null || currencies.includes(v.currency as string)) && nullableText(v.breakdown) &&
  (v.paidBy === undefined || nullableId(v.paidBy)) && timestamp(v.createdAt);
const placements = ["activity", "transport", "independent"];
// A legacy dayId (absent, null or an ObjectId) is accepted and never used.
const context = (v: unknown) => record(v) && nullableId(v.parentPostId) && id(v.rootPostId) && nullableId(v.rootActivityId) &&
  nullableId(v.rootTransportId) && placements.includes(v.placement as string) &&
  (v.placement === "activity" ? v.rootActivityId !== null
    : v.placement === "transport" ? v.rootActivityId === null && v.rootTransportId !== null
    : v.rootActivityId === null && v.rootTransportId === null);
const post = (v: unknown) => entity(v) && (v.dayId === undefined || nullableId(v.dayId)) && context(v.context) && id(v.authorId) && nullableText(v.description) &&
  nullableText(v.mapsUrl) && nullableId(v.activityId) && nullableId(v.transportId) && nullableId(v.parentPostId) &&
  timestamp(v.createdAt) && (v.expense === null || expense(v.expense));
const transport = (v: unknown) => {
  if (!entity(v) || !id(v.destinationId) || !timestamp(v.departureAt) || !timestamp(v.arrivalAt) || !ids(v.postIds)) return false;
  // Reuse transport validation rather than introducing a different set of valid details in the client.
  return readTransport(journeyTransportForDomain(v)).ok;
};

const validItinerary = (v: unknown, tripId: string): v is TripItineraryResponse => {
  if (!record(v) || !id(v.tripId) || v.tripId !== tripId ||
      !["register", "balance"].includes(v.expenseMode as string) ||
      !list(v.destinations, destination) || !list(v.days, day) || !list(v.transports, transport) ||
      !list(v.activities, activity) || !list(v.posts, post) || !list(v.unplacedPosts, post) ||
      !tripSummary(v.expenseSummary) || !list(v.expenses, attribution)) return false;
  const allPosts = [...v.posts, ...v.unplacedPosts];
  const sets = Object.fromEntries(["destinations", "days", "transports", "activities", "posts"].map((key) => {
    const values = (key === "posts" ? allPosts : v[key]) as RecordValue[];
    return [key, new Set(values.map((value) => value.id as string))];
  }));
  const belongs = (values: RecordValue[], key: string) => values.every((value) => value.tripId === tripId) && sets[key].size === values.length;
  if (!["destinations", "days", "transports", "activities"].every((key) => belongs(v[key] as RecordValue[], key)) ||
      !belongs(allPosts, "posts")) return false;
  // Day items of kind post are legacy hints: posts are placed by the projection from their context.
  if (!v.days.every((value) => sets.destinations.has(value.destinationId as string) &&
      (value.items as RecordValue[]).every((entry) => entry.kind === "post" || sets[entry.kind === "activity" ? "activities" : "transports"].has(entry.id as string)))) return false;
  if (!v.transports.every((value) => sets.destinations.has(value.destinationId as string) && (value.postIds as string[]).every((postId) => sets.posts.has(postId)))) return false;
  if (!v.activities.every((value) => sets.days.has(value.dayId as string) && (value.postIds as string[]).every((postId) => sets.posts.has(postId)))) return false;
  return allPosts.every((value) => {
    const ctx = value.context as RecordValue;
    return (value.activityId === null || sets.activities.has(value.activityId as string)) &&
      (value.transportId === null || sets.transports.has(value.transportId as string)) &&
      (value.parentPostId === null || sets.posts.has(value.parentPostId as string)) &&
      sets.posts.has(ctx.rootPostId as string) && (ctx.parentPostId === null || sets.posts.has(ctx.parentPostId as string)) &&
      (ctx.rootActivityId === null || sets.activities.has(ctx.rootActivityId as string)) &&
      (ctx.rootTransportId === null || sets.transports.has(ctx.rootTransportId as string)) &&
      (value.expense === null || ((value.expense as RecordValue).tripId === tripId && (value.expense as RecordValue).postId === value.id));
  });
};

export const createTripItineraryApi = (client: Pick<HttpClient, "get">): TripItineraryApi => ({
  get: async (tripId) => {
    const result = await client.get<unknown>(`/trips/${encodeURIComponent(tripId)}/itinerary`);
    if (!result.ok) return { ok: false, error: { kind: result.error.kind } };
    return record(result.value) && validItinerary(result.value.itinerary, tripId)
      ? { ok: true, value: result.value.itinerary }
      : { ok: false, error: { kind: "server" } };
  },
});
