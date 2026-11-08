import { TripNotFoundError } from "../../errors/trip-not-found-error.js";
import type { TripMemberManagementPort } from "../../ports/trip-member-management-port.js";
import type { TripItineraryQueryPort } from "../../ports/trip-itinerary-query-port.js";
import type { TaggedError } from "../../types/error.js";
import { err, ok } from "../../types/result.js";
import type { ItineraryDay } from "../../entities/itinerary-day.js";
import type { Transport } from "../../entities/transport.js";
import { resolvePostChain } from "../../entities/post.js";
import type { ItineraryItem, ItineraryPostContext, TripItinerary, TripItinerarySnapshot } from "../../types/trip-itinerary.js";
import type { UseCase } from "../../types/usecase.js";
import type { ObjectId } from "../../value-objects/object-id.js";

export interface GetTripItineraryPayload { tripId: ObjectId; authenticatedUserId: ObjectId }
export interface GetTripItineraryDependencies {
  members: Pick<TripMemberManagementPort, "findByTripAndUser">;
  itinerary: TripItineraryQueryPort;
}

const byId = (a: { id: ObjectId }, b: { id: ObjectId }) => a.id.localeCompare(b.id);
const byOrder = (a: { order: number; id: ObjectId }, b: { order: number; id: ObjectId }) => a.order - b.order || byId(a, b);
const byCreatedAt = (a: { createdAt: Date; id: ObjectId }, b: { createdAt: Date; id: ObjectId }) =>
  a.createdAt.getTime() - b.createdAt.getTime() || byId(a, b);
const group = <T>(values: readonly T[], key: (value: T) => ObjectId | null): Map<ObjectId, T[]> => {
  const groups = new Map<ObjectId, T[]>();
  for (const value of values) {
    const id = key(value);
    if (id === null) continue;
    const existing = groups.get(id);
    if (existing) existing.push(value);
    else groups.set(id, [value]);
  }
  return groups;
};

/**
 * Publication slice of an instant: `[startsAt, endsAt)` (open when `endsAt` is null). Without a containing slice,
 * a slice whose UTC date matches the instant's UTC date anchors it (lowest order). Pure UTC: independent of TZ.
 */
export const dayForInstant = <D extends Pick<ItineraryDay, "date" | "startsAt" | "endsAt" | "order">>(days: readonly D[], instant: Date): D | undefined => {
  const at = instant.getTime(), ordered = [...days].sort((a, b) => a.order - b.order);
  return ordered.find((day) => day.startsAt.getTime() <= at && (day.endsAt === null || at < day.endsAt.getTime())) ??
    ordered.find((day) => day.date.toISOString().slice(0, 10) === instant.toISOString().slice(0, 10));
};

/** Transit slice of a transport: same destination, `transit_out` for outbound and `transit_return` for return. */
const transitDayFor = (days: readonly ItineraryDay[], transport: Transport) => {
  const type = transport.direction === "outbound" ? "transit_out" : "transit_return";
  return days.filter((day) => day.destinationId === transport.destinationId && day.type === type).sort((a, b) => a.order - b.order)[0];
};

const compose = (snapshot: TripItinerarySnapshot): TripItinerary => {
  const tripId = snapshot.trip.id;
  const destinations = snapshot.destinations.filter((value) => value.tripId === tripId).sort(byOrder);
  const destinationIds = new Set(destinations.map((value) => value.id));
  const days = snapshot.days.filter((value) => value.tripId === tripId && destinationIds.has(value.destinationId)).sort(byOrder);
  const dayIds = new Set(days.map((value) => value.id));
  const activities = snapshot.activities.filter((value) => value.tripId === tripId && dayIds.has(value.dayId))
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime() || byId(a, b));
  const transports = snapshot.transports.filter((value) => value.tripId === tripId && destinationIds.has(value.destinationId))
    .sort((a, b) => a.departureAt.getTime() - b.departureAt.getTime() || byId(a, b));
  const activityIds = new Set(activities.map((value) => value.id));
  const transportIds = new Set(transports.map((value) => value.id));
  const activityById = new Map(activities.map((value) => [value.id, value]));
  const tripPosts = snapshot.posts.filter((value) => value.tripId === tripId).sort(byCreatedAt);
  const postById = new Map(tripPosts.map((value) => [value.id, value]));
  const expenses = new Map(snapshot.expenses.filter((value) => value.tripId === tripId && postById.has(value.postId)).map((value) => [value.postId, value]));

  // Resolve each memory's context: own valid link first, then the chain root's; a broken chain counts as no chain.
  const resolved = tripPosts.map((post) => {
    const chain = resolvePostChain(post, (postId) => postById.get(postId));
    const root = chain.ok ? postById.get(chain.value.rootPostId) ?? post : post;
    const activityId = [post.activityId, root.activityId].find((value) => value != null && activityIds.has(value)) ?? null;
    const transportId = [post.transportId, root.transportId].find((value) => value != null && transportIds.has(value)) ?? null;
    const placement: ItineraryPostContext["placement"] = activityId !== null ? "activity" : transportId !== null ? "transport" : "independent";
    const publicationDayId = dayForInstant(days, post.createdAt)?.id ?? null;
    const transitDayId = transportId === null ? null : transitDayFor(days, transports.find((value) => value.id === transportId)!)?.id ?? null;
    const dayId = activityId !== null ? activityById.get(activityId)!.dayId : publicationDayId ?? transitDayId;
    const context: ItineraryPostContext = { parentPostId: post.parentPostId != null && postById.has(post.parentPostId) ? post.parentPostId : null,
      rootPostId: root.id, rootActivityId: activityId, rootTransportId: transportId, placement };
    // Expenses are attributed to the activity day, or else to the publication slice (PRD 3.6).
    const summaryDayId = activityId !== null ? dayId : publicationDayId;
    return { post, activityId, transportId, dayId, context, summaryDayId, expense: expenses.get(post.id) ?? null };
  });
  const placedIds = new Set(resolved.filter((value) => value.dayId !== null).map((value) => value.post.id));
  const view = (value: (typeof resolved)[number]) => ({ ...value.post, context: value.context, expense: value.expense,
    activityId: value.post.activityId !== null && activityIds.has(value.post.activityId) ? value.post.activityId : null,
    transportId: value.post.transportId !== null && transportIds.has(value.post.transportId) ? value.post.transportId : null });
  const postViews = resolved.flatMap((value) => value.dayId === null ? [] : [{ ...view(value), dayId: value.dayId,
    parentPostId: value.context.parentPostId !== null && placedIds.has(value.context.parentPostId) ? value.context.parentPostId : null }]);
  const unplacedPosts = resolved.flatMap((value) => value.dayId !== null ? [] : [{ ...view(value), dayId: null, parentPostId: value.context.parentPostId }]);
  const placedResolved = resolved.filter((value) => value.dayId !== null);
  const postsByActivity = group(placedResolved, (value) => value.activityId);
  const postsByTransport = group(placedResolved, (value) => value.transportId);
  const independentByDay = group(placedResolved.filter((value) => value.context.placement === "independent"), (value) => value.dayId);
  const expensesByDay = group(resolved.filter((value) => value.expense !== null && value.summaryDayId !== null), (value) => value.summaryDayId);
  const activitiesByDay = group(activities, (activity) => activity.dayId);
  const transportsByDestination = group(transports, (transport) => transport.destinationId);
  const itemRank = { transport: 0, activity: 1, post: 2 };

  return {
    tripId, expenseMode: snapshot.trip.expenseMode, destinations,
    activities: activities.map((activity) => ({ ...activity, postIds: (postsByActivity.get(activity.id) ?? []).map((value) => value.post.id) })),
    transports: transports.map((transport) => ({ ...transport, postIds: (postsByTransport.get(transport.id) ?? []).map((value) => value.post.id) })),
    posts: postViews, unplacedPosts,
    days: days.map((day) => {
      const items: ItineraryItem[] = (activitiesByDay.get(day.id) ?? []).map((activity) => ({ kind: "activity", id: activity.id, at: activity.scheduledAt }));
      for (const transport of transportsByDestination.get(day.destinationId) ?? []) {
        if ((day.type === "transit_out" && transport.direction === "outbound") ||
            (day.type === "transit_return" && transport.direction === "return")) {
          items.push({ kind: "transport", id: transport.id, at: new Date(Math.max(day.startsAt.getTime(), transport.departureAt.getTime())) });
        }
      }
      for (const value of independentByDay.get(day.id) ?? []) items.push({ kind: "post", id: value.post.id, at: value.post.createdAt });
      items.sort((a, b) => a.at.getTime() - b.at.getTime() || itemRank[a.kind] - itemRank[b.kind] || byId(a, b));
      const expenseSummary = { totalAmount: 0, expenseCount: 0 };
      for (const value of expensesByDay.get(day.id) ?? []) { expenseSummary.totalAmount += value.expense!.totalAmount; expenseSummary.expenseCount++; }
      return { ...day, items, expenseSummary };
    }),
  };
};

export const getTripItinerary: UseCase<GetTripItineraryDependencies, GetTripItineraryPayload, TripItinerary, TaggedError> = {
  execute: async ({ members, itinerary }, { tripId, authenticatedUserId }) => {
    const membership = await members.findByTripAndUser(tripId, authenticatedUserId);
    if (!membership.ok) return membership;
    if (membership.value?.tripId !== tripId || membership.value.userId !== authenticatedUserId) return err(new TripNotFoundError());
    const snapshot = await itinerary.read(tripId);
    if (!snapshot.ok) return snapshot;
    if (snapshot.value === undefined || snapshot.value.trip.id !== tripId) return err(new TripNotFoundError());
    return ok(compose(snapshot.value));
  },
};
