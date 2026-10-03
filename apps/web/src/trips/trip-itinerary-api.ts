import { createTransport, type ObjectId, type Transport, type TripItinerary } from "app-domain";
import type { HttpClient } from "../api/index.js";
import type { TripResult } from "./trip-management-api.js";

/** HTTP serialization is distinct from domain entities: IDs and UTC dates arrive as strings. */
type Serialized<T> = T extends Date ? string : T extends ObjectId ? string :
  T extends readonly (infer U)[] ? Serialized<U>[] : T extends object ? { [K in keyof T]: Serialized<T[K]> } : T;
export type TripItineraryResponse = Serialized<TripItinerary>;
export type ItineraryDayResponse = TripItineraryResponse["days"][number];
export type ItineraryPostResponse = TripItineraryResponse["posts"][number];
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
const summary = (v: unknown) => record(v) && finite(v.totalAmount) && Number.isSafeInteger(v.expenseCount) && (v.expenseCount as number) >= 0;
const destination = (v: unknown) => entity(v) && text(v.name) && order(v.order) && timestamp(v.createdAt);
const item = (v: unknown) => record(v) && ["transport", "activity", "post"].includes(v.kind as string) && id(v.id) && timestamp(v.at);
const day = (v: unknown) => entity(v) && id(v.destinationId) && timestamp(v.date) &&
  ["transit_out", "activity", "transit_return", "arrival"].includes(v.type as string) && timestamp(v.startsAt) &&
  (v.endsAt === null || (timestamp(v.endsAt) && Date.parse(v.endsAt) >= Date.parse(v.startsAt))) &&
  order(v.order) && list(v.items, item) && summary(v.expenseSummary);
const activity = (v: unknown) => entity(v) && id(v.dayId) && text(v.title) && nullableText(v.description) &&
  timestamp(v.scheduledAt) && nullableText(v.mapsUrl) && ["proposed", "voting", "confirmed"].includes(v.status as string) &&
  id(v.createdBy) && timestamp(v.createdAt) && ids(v.postIds);
const expense = (v: unknown) => entity(v) && id(v.postId) && finite(v.totalAmount) && nullableText(v.breakdown) &&
  nullableId(v.paidBy) && timestamp(v.createdAt);
const post = (v: unknown) => entity(v) && id(v.dayId) && id(v.authorId) && nullableText(v.description) &&
  nullableText(v.mapsUrl) && nullableId(v.activityId) && nullableId(v.transportId) && nullableId(v.parentPostId) &&
  timestamp(v.createdAt) && (v.expense === null || expense(v.expense));
const transport = (v: unknown) => {
  if (!entity(v) || !id(v.destinationId) || !timestamp(v.departureAt) || !timestamp(v.arrivalAt) || !ids(v.postIds)) return false;
  // Reuse transport validation rather than introducing a different set of valid details in the client.
  return createTransport({ ...v, departureAt: new Date(v.departureAt), arrivalAt: new Date(v.arrivalAt) } as unknown as Transport).ok;
};

const validItinerary = (v: unknown, tripId: string): v is TripItineraryResponse => {
  if (!record(v) || !id(v.tripId) || v.tripId !== tripId ||
      !["register", "balance"].includes(v.expenseMode as string) || typeof v.votingEnabled !== "boolean" ||
      !list(v.destinations, destination) || !list(v.days, day) || !list(v.transports, transport) ||
      !list(v.activities, activity) || !list(v.posts, post)) return false;
  const sets = Object.fromEntries(["destinations", "days", "transports", "activities", "posts"].map((key) => {
    const values = v[key] as RecordValue[];
    return [key, new Set(values.map((value) => value.id as string))];
  }));
  const belongs = (values: RecordValue[], key: string) => values.every((value) => value.tripId === tripId) && sets[key].size === values.length;
  if (!["destinations", "days", "transports", "activities", "posts"].every((key) => belongs(v[key] as RecordValue[], key))) return false;
  if (!v.days.every((value) => sets.destinations.has(value.destinationId as string) &&
      (value.items as RecordValue[]).every((entry) => sets[entry.kind === "activity" ? "activities" : entry.kind === "post" ? "posts" : "transports"].has(entry.id as string)))) return false;
  if (!v.transports.every((value) => sets.destinations.has(value.destinationId as string) && (value.postIds as string[]).every((postId) => sets.posts.has(postId)))) return false;
  if (!v.activities.every((value) => sets.days.has(value.dayId as string) && (value.postIds as string[]).every((postId) => sets.posts.has(postId)))) return false;
  return v.posts.every((value) => sets.days.has(value.dayId as string) &&
    (value.activityId === null || sets.activities.has(value.activityId as string)) &&
    (value.transportId === null || sets.transports.has(value.transportId as string)) &&
    (value.parentPostId === null || sets.posts.has(value.parentPostId as string)) &&
    (value.expense === null || ((value.expense as RecordValue).tripId === tripId && (value.expense as RecordValue).postId === value.id)));
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
