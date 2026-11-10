import { isId } from "../trips/api-failure.js";
import type { TripNotification } from "./trip-notification-api.js";

/** What identifies a resource: the push `data` and the inbox payload both reduce to this. Every id is validated again here. */
export type DestinationInput = { type: string; tripId: string; payloadTripId?: string; postId?: string; activityId?: string };

/**
 * The exact in-app route of a notice, always inside the Trip of the notice; a Trip is never inferred from another id.
 * `null` means there is nothing to open: an invalid or missing id, an unknown type or the expulsion (the user is no longer a member).
 * Routes are built only from validated 24-hex ids, so `../`, queries or fragments cannot reach the path.
 * `member.joined` opens the Trip members screen (`/trips/:tripId/members`); `comment.created` opens the post without anchoring the comment.
 */
export const notificationDestination = ({ type, tripId, payloadTripId, postId, activityId }: DestinationInput): string | null => {
  if (!isId(tripId) || (payloadTripId !== undefined && payloadTripId !== tripId)) return null;
  switch (type) {
    case "post.created":
    case "comment.created":
      return isId(postId) ? `/trips/${tripId}/memories/${postId}` : null;
    case "activity.created":
    case "activity.updated":
    case "activity.participant_unlinked":
      return isId(activityId) ? `/trips/${tripId}/itinerary?activity=${activityId}` : null;
    case "member.joined":
      return `/trips/${tripId}/members`;
    default:
      return null; // member.expelled and anything unknown
  }
};

export const destinationOfNotification = (notification: TripNotification): string | null => {
  switch (notification.type) {
    case "post.created":
    case "comment.created":
      return notificationDestination({ type: notification.type, tripId: notification.tripId, postId: notification.payload.postId });
    case "activity.created":
    case "activity.updated":
    case "activity.participant_unlinked":
      return notificationDestination({ type: notification.type, tripId: notification.tripId, activityId: notification.payload.activityId });
    case "member.joined":
      return notificationDestination({ type: notification.type, tripId: notification.tripId });
    default:
      return null;
  }
};
