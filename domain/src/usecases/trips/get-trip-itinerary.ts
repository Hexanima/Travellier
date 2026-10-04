import { TripNotFoundError } from "../../errors/trip-not-found-error.js";
import type { TripMemberManagementPort } from "../../ports/trip-member-management-port.js";
import type { TripItineraryQueryPort } from "../../ports/trip-itinerary-query-port.js";
import type { TaggedError } from "../../types/error.js";
import { err, ok } from "../../types/result.js";
import type { ItineraryItem, TripItinerary, TripItinerarySnapshot } from "../../types/trip-itinerary.js";
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
  const posts = snapshot.posts.filter((value) => value.tripId === tripId && dayIds.has(value.dayId)).sort(byCreatedAt);
  const postIds = new Set(posts.map((value) => value.id));
  const expenses = new Map(snapshot.expenses.filter((value) => value.tripId === tripId && postIds.has(value.postId)).map((value) => [value.postId, value]));
  const postViews = posts.map((post) => ({ ...post,
    activityId: post.activityId !== null && activityIds.has(post.activityId) ? post.activityId : null,
    transportId: post.transportId !== null && transportIds.has(post.transportId) ? post.transportId : null,
    parentPostId: post.parentPostId !== null && postIds.has(post.parentPostId) ? post.parentPostId : null,
    expense: expenses.get(post.id) ?? null,
  }));
  const postsByActivity = group(postViews, (post) => post.activityId);
  const postsByTransport = group(postViews, (post) => post.transportId);
  const postsByDay = group(postViews, (post) => post.dayId);
  const activitiesByDay = group(activities, (activity) => activity.dayId);
  const transportsByDestination = group(transports, (transport) => transport.destinationId);
  const itemRank = { transport: 0, activity: 1, post: 2 };

  return {
    tripId, expenseMode: snapshot.trip.expenseMode, votingEnabled: snapshot.trip.votingEnabled, destinations,
    activities: activities.map((activity) => ({ ...activity, postIds: (postsByActivity.get(activity.id) ?? []).map((post) => post.id) })),
    transports: transports.map((transport) => ({ ...transport, postIds: (postsByTransport.get(transport.id) ?? []).map((post) => post.id) })),
    posts: postViews,
    days: days.map((day) => {
      const dayPosts = postsByDay.get(day.id) ?? [];
      const items: ItineraryItem[] = (activitiesByDay.get(day.id) ?? []).map((activity) => ({ kind: "activity", id: activity.id, at: activity.scheduledAt }));
      for (const transport of transportsByDestination.get(day.destinationId) ?? []) {
        if ((day.type === "transit_out" && transport.direction === "outbound") ||
            (day.type === "transit_return" && transport.direction === "return")) {
          items.push({ kind: "transport", id: transport.id, at: new Date(Math.max(day.startsAt.getTime(), transport.departureAt.getTime())) });
        }
      }
      for (const post of dayPosts) {
        if (post.activityId === null && post.transportId === null) items.push({ kind: "post", id: post.id, at: post.createdAt });
      }
      items.sort((a, b) => a.at.getTime() - b.at.getTime() || itemRank[a.kind] - itemRank[b.kind] || byId(a, b));
      const expenseSummary = { totalAmount: 0, expenseCount: 0 };
      for (const post of dayPosts) {
        if (post.expense !== null) { expenseSummary.totalAmount += post.expense.totalAmount; expenseSummary.expenseCount++; }
      }
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
