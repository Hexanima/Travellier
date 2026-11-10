import { buildTripNotifications, notificationRecipients, type BuildTripNotificationsInput, type TripNotificationType } from "../../entities/trip-notification.js";
import type { NotificationScope } from "../../ports/trip-notification-port.js";
import { ok, type AsyncResult } from "../../types/result.js";
import type { ObjectId } from "../../value-objects/object-id.js";

/** An event for the current members of the Trip except the `exclude`d users (the actor, and whoever has a more specific notice). */
export type MemberNotification = { [T in TripNotificationType]: Omit<BuildTripNotificationsInput<T>, "recipients"> & { exclude: readonly ObjectId[] } }[TripNotificationType];

/**
 * Last write of an operation that saved something: reads the CURRENT members inside the operation's transaction (so an expulsion
 * and the operation are serialized) and appends one event per recipient. A failure returns the error and the transaction rolls back.
 */
export const emitToMembers = async (scope: NotificationScope, notifications: readonly MemberNotification[]): AsyncResult<void> => {
  const members = await scope.listMemberIds();
  if (!members.ok) return members;
  const drafts = notifications.flatMap(({ exclude, ...input }) => buildTripNotifications({ ...input,
    recipients: notificationRecipients(members.value, exclude) } as BuildTripNotificationsInput<TripNotificationType>));
  if (drafts.length === 0) return ok(undefined);
  return scope.appendNotifications(drafts);
};
