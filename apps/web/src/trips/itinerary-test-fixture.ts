// Shared synthetic itinerary for client tests; IDs and timestamps follow the HTTP contract.
import { attributeExpense, totalizeExpenses, transportCostTotals, type ObjectId } from "app-domain";
import { createTripItineraryApi, type TripItineraryResponse } from "./trip-itinerary-api.js";
export const itineraryId = (n: number) => n.toString(16).padStart(24, "0");
type LinkablePost = { id: string; activityId: string | null; transportId: string | null; parentPostId: string | null;
  context: { parentPostId: string | null; rootPostId: string; rootActivityId: string | null; rootTransportId: string | null;
    placement: "activity" | "transport" | "independent" } };
/** Sets a post's own links and keeps `context` coherent; root fields default to the own links (use overrides for descendants). */
export const linkPost = <T extends LinkablePost>(post: T, links: { activityId?: string | null; transportId?: string | null;
  parentPostId?: string | null; rootPostId?: string; rootActivityId?: string | null; rootTransportId?: string | null }): T => {
  post.activityId = links.activityId ?? null; post.transportId = links.transportId ?? null; post.parentPostId = links.parentPostId ?? null;
  const rootActivityId = links.rootActivityId !== undefined ? links.rootActivityId : post.activityId;
  const rootTransportId = links.rootTransportId !== undefined ? links.rootTransportId : post.transportId;
  post.context = { parentPostId: post.parentPostId, rootPostId: links.rootPostId ?? post.parentPostId ?? post.id, rootActivityId, rootTransportId,
    placement: rootActivityId !== null ? "activity" : rootTransportId !== null ? "transport" : "independent" };
  return post;
};
/** Totals as the backend computes them from the transports (per currency, without converting); a cost without currency is only counted. */
export const transportTotalsOf = (transports: readonly { costPerPerson: number | null; costCurrency?: "ARS" | "EUR" | "USD" | null }[]): TripItineraryResponse["transportCostTotals"] =>
  transportCostTotals(transports.map((transport) => ({ costPerPerson: transport.costPerPerson, costCurrency: transport.costCurrency ?? null })));
/** Variant with a previous transport cost that has no currency: it appears in `withoutCurrency` and adds to no total. */
export const withUnindicatedTransportCost = <T extends { transports: { direction: string; costPerPerson: number | null; costCurrency?: "ARS" | "EUR" | "USD" | null }[];
  transportCostTotals: TripItineraryResponse["transportCostTotals"] }>(value: T, amount = 50): T => {
  const inbound = value.transports.find((transport) => transport.direction === "return")!;
  inbound.costPerPerson = amount; inbound.costCurrency = null;
  value.transportCostTotals = transportTotalsOf(value.transports);
  return value;
};
export const itineraryFixture = () => {
  const tripId = itineraryId(1), destinationId = itineraryId(2);
  const time = (hour: number) => `2026-09-25T${String(hour).padStart(2, "0")}:00:00.123Z`;
  const day = (id: number, type: string, start: number, end: number, order: number) => ({
    id: itineraryId(id), tripId, destinationId, date: time(0), type,
    startsAt: time(start), endsAt: time(end), order, items: [] as { kind: string; id: string; at: string }[],
    expenseSummary: { byCurrency: [] as { currency: "ARS" | "EUR" | "USD"; totalCents: number; expenseCount: number }[],
      withoutCurrency: { expenseCount: 0 }, expenseCount: 0 },
  });
  const activity = (id: number, hour: number, title: string) => ({
    id: itineraryId(id), tripId, dayId: itineraryId(4), title, description: null,
    scheduledAt: time(hour), mapsUrl: null, createdBy: itineraryId(20),
    createdAt: time(17), postIds: [] as string[],
  });
  const post = (id: number, hour: number, description: string) => ({
    id: itineraryId(id), tripId, authorId: itineraryId(20), description,
    mapsUrl: null, activityId: null as string | null, transportId: null as string | null,
    parentPostId: null as string | null, createdAt: time(hour),
    context: { parentPostId: null as string | null, rootPostId: itineraryId(id), rootActivityId: null as string | null,
      rootTransportId: null as string | null, placement: "independent" as "activity" | "transport" | "independent" },
    expense: null as {
      id: string; tripId: string; postId: string; totalAmount: number;
      currency: "ARS" | "EUR" | "USD" | null; breakdown: string | null;
      paidBy: string | null; createdAt: string;
    } | null,
  });
  const days = [day(3, "transit_out", 8, 10, 1), day(4, "activity", 10, 18, 2), day(5, "transit_return", 18, 20, 3)];
  days[0].items = [{ kind: "transport", id: itineraryId(6), at: time(8) }];
  days[1].items = [{ kind: "activity", id: itineraryId(8), at: time(12) },
    { kind: "post", id: itineraryId(10), at: time(13) }, { kind: "activity", id: itineraryId(9), at: time(14) }];
  days[2].items = [{ kind: "transport", id: itineraryId(7), at: time(18) }];
  const posts = [post(10, 13, "Almuerzo junto al río"), post(11, 9, "En camino")];
  linkPost(posts[1], { transportId: itineraryId(6) });
  posts[0].expense = { id: itineraryId(12), tripId, postId: itineraryId(10),
    totalAmount: 25.5, currency: "ARS", breakdown: "Almuerzo", paidBy: null, createdAt: time(13) };
  days[1].expenseSummary = { byCurrency: [{ currency: "ARS", totalCents: 2550, expenseCount: 1 }], withoutCurrency: { expenseCount: 0 }, expenseCount: 1 };
  return {
    tripId, expenseMode: "register",
    destinations: [{ id: destinationId, tripId, name: "Córdoba", order: 1, createdAt: time(0) }], days,
    transports: [
      { id: itineraryId(6), tripId, destinationId, direction: "outbound", type: "car", departurePlace: "Buenos Aires",
        arrivalPlace: "Córdoba", departureAt: time(8), arrivalAt: time(10), costPerPerson: 999, costCurrency: "ARS", details: {}, postIds: [itineraryId(11)] },
      { id: itineraryId(7), tripId, destinationId, direction: "return", type: "car", departurePlace: "Córdoba",
        arrivalPlace: "Buenos Aires", departureAt: time(18), arrivalAt: time(20), costPerPerson: null, costCurrency: null, details: {}, postIds: [] },
    ], activities: [activity(8, 12, "Paseo por el centro"), activity(9, 14, "Visita al museo")], posts,
    unplacedPosts: [] as typeof posts,
    transportCostTotals: { byCurrency: [{ currency: "ARS" as "ARS" | "EUR" | "USD", totalCents: 99900, transportCount: 1 }], withoutCurrency: { transportCount: 0 } },
    expenseSummary: { ...days[1].expenseSummary, outsideItinerary: { byCurrency: [] as typeof days[1]["expenseSummary"]["byCurrency"],
      withoutCurrency: { expenseCount: 0 }, expenseCount: 0 } },
    expenses: [{ expenseId: itineraryId(12), postId: itineraryId(10), rootPostId: itineraryId(10), source: "publication" as "activity" | "publication",
      rootActivityId: null as string | null, occurredAt: time(13), publishedAt: time(13), dayId: itineraryId(4) as string | null,
      currency: "ARS" as "ARS" | "EUR" | "USD" | null, amountCents: 2550 as number | null }],
  };
};

/**
 * Publication slice of an instant, as the backend resolves it (domain/src/usecases/trips/get-trip-itinerary.ts, `dayForInstant`,
 * lines ~40-44; not exported by app-domain): days by `order`, the one with `[startsAt, endsAt)` containing the instant
 * (open when `endsAt` is null), else the lowest-order one with the same UTC date. Pure UTC.
 */
export const bandOf = (days: readonly { id: string; date: string; startsAt: string; endsAt: string | null; order: number }[], iso: string): string | null => {
  const at = Date.parse(iso), ordered = [...days].sort((a, b) => a.order - b.order);
  return (ordered.find((day) => Date.parse(day.startsAt) <= at && (day.endsAt === null || at < Date.parse(day.endsAt))) ??
    ordered.find((day) => day.date.slice(0, 10) === iso.slice(0, 10)))?.id ?? null;
};

/**
 * Leaves a payload the way the real backend would return it after a change (same rules as `compose` in
 * domain/src/usecases/trips/get-trip-itinerary.ts, lines ~54-135): links to missing activities or transports are dropped, each post
 * lands on its root activity's day, else on its publication slice, else on its transit day, and posts with no day move to
 * `unplacedPosts`. Day items are rebuilt (activities by `dayId`, transports by direction, independent placed posts), and
 * `postIds`, `expenses[]`, every day summary and the Trip summary are recomputed with the domain's own attribution.
 * Mutates and returns the same object; the caller is responsible for the activities, links and dates it changed.
 */
export const settleItinerary = (value: TripItineraryResponse): TripItineraryResponse => {
  const days = [...value.days].sort((a, b) => a.order - b.order);
  const dayIds = new Set(days.map((day) => day.id));
  value.activities = value.activities.filter((activity) => dayIds.has(activity.dayId));
  const activities = new Map(value.activities.map((activity) => [activity.id, activity]));
  const transports = new Map(value.transports.map((transport) => [transport.id, transport]));
  const all = [...value.posts, ...value.unplacedPosts].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));
  const byId = new Map(all.map((post) => [post.id, post]));
  const asId = (text: string | null) => text as unknown as ObjectId;
  const resolved = all.map((post) => {
    const root = byId.get(post.context.rootPostId) ?? post;
    const activityId = [post.activityId, root.activityId].find((id) => id != null && activities.has(id)) ?? null;
    const transportId = [post.transportId, root.transportId].find((id) => id != null && transports.has(id)) ?? null;
    const transport = transportId === null ? undefined : transports.get(transportId);
    const transitDayId = transport === undefined ? null : days.find((day) => day.destinationId === transport.destinationId &&
      day.type === (transport.direction === "outbound" ? "transit_out" : "transit_return"))?.id ?? null;
    const dayId = activityId !== null ? activities.get(activityId)!.dayId : bandOf(days, post.createdAt) ?? transitDayId;
    post.activityId = post.activityId !== null && activities.has(post.activityId) ? post.activityId : null;
    post.transportId = post.transportId !== null && transports.has(post.transportId) ? post.transportId : null;
    post.context = { parentPostId: post.context.parentPostId !== null && byId.has(post.context.parentPostId) ? post.context.parentPostId : null,
      rootPostId: root.id, rootActivityId: activityId, rootTransportId: transportId,
      placement: activityId !== null ? "activity" : transportId !== null ? "transport" : "independent" };
    return { post, activityId, transportId, dayId };
  });
  const placed = resolved.filter((entry) => entry.dayId !== null), placedIds = new Set(placed.map((entry) => entry.post.id));
  for (const entry of resolved) entry.post.parentPostId = entry.dayId !== null && entry.post.context.parentPostId !== null && !placedIds.has(entry.post.context.parentPostId)
    ? null : entry.post.context.parentPostId;
  value.posts = placed.map((entry) => entry.post);
  value.unplacedPosts = resolved.filter((entry) => entry.dayId === null).map((entry) => entry.post);
  for (const activity of value.activities) activity.postIds = placed.filter((entry) => entry.activityId === activity.id).map((entry) => entry.post.id);
  for (const transport of value.transports) transport.postIds = placed.filter((entry) => entry.transportId === transport.id).map((entry) => entry.post.id);
  const rank = { transport: 0, activity: 1, post: 2 };
  for (const day of value.days) {
    const items: { kind: "transport" | "activity" | "post"; id: string; at: string }[] =
      value.activities.filter((activity) => activity.dayId === day.id).map((activity) => ({ kind: "activity", id: activity.id, at: activity.scheduledAt }));
    for (const transport of value.transports) {
      if (transport.destinationId === day.destinationId && ((day.type === "transit_out" && transport.direction === "outbound") ||
        (day.type === "transit_return" && transport.direction === "return"))) {
        items.push({ kind: "transport", id: transport.id, at: new Date(Math.max(Date.parse(day.startsAt), Date.parse(transport.departureAt))).toISOString() });
      }
    }
    for (const entry of placed) if (entry.dayId === day.id && entry.post.context.placement === "independent") items.push({ kind: "post", id: entry.post.id, at: entry.post.createdAt });
    day.items = items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || rank[a.kind] - rank[b.kind] || a.id.localeCompare(b.id));
  }
  const attributions = all.flatMap((post) => {
    if (post.expense === null) return [];
    const activity = post.context.rootActivityId === null ? undefined : activities.get(post.context.rootActivityId);
    return [attributeExpense({
      expense: { id: asId(post.expense.id), postId: asId(post.id), totalAmount: post.expense.totalAmount, currency: post.expense.currency },
      post: { createdAt: new Date(post.createdAt) }, rootPostId: asId(post.context.rootPostId),
      activity: activity ? { id: asId(activity.id), dayId: asId(activity.dayId), scheduledAt: new Date(activity.scheduledAt) } : null,
      publicationDayId: asId(bandOf(days, post.createdAt)),
    })];
  }).sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || String(a.expenseId).localeCompare(String(b.expenseId)));
  const wire = <T,>(data: T) => JSON.parse(JSON.stringify(data)) as T;
  for (const day of value.days) day.expenseSummary = wire(totalizeExpenses(attributions.filter((entry) => String(entry.dayId) === day.id)));
  value.expenses = wire(attributions) as unknown as TripItineraryResponse["expenses"];
  value.expenseSummary = wire({ ...totalizeExpenses(attributions), outsideItinerary: totalizeExpenses(attributions.filter((entry) => entry.dayId === null)) });
  value.transportCostTotals = transportTotalsOf(value.transports);
  return value;
};
/** Passes a payload through the real client validator, as the screen would receive it over HTTP. */
export const throughClientValidator = async (value: TripItineraryResponse) =>
  createTripItineraryApi({ get: async () => ({ ok: true, value: { itinerary: value } }) } as never).get(value.tripId);
