import { buildTripNotifications, notificationRecipients, type BuildTripNotificationsInput, type TripNotificationType } from "../../entities/trip-notification.js";
import type { NotificationScope } from "../../ports/trip-notification-port.js";
import { ok, type AsyncResult } from "../../types/result.js";
import type { ObjectId } from "../../value-objects/object-id.js";

type WithoutRecipients = { [T in TripNotificationType]: Omit<BuildTripNotificationsInput<T>, "recipients"> }[TripNotificationType];
/**
 * An event for the current members of the Trip except the `exclude`d users (the actor, and whoever has a more specific notice),
 * or only for `only` (a personal notice such as an unlinking, sent to exactly the affected user).
 */
export type MemberNotification = WithoutRecipients & ({ exclude: readonly ObjectId[]; only?: undefined } | { only: readonly ObjectId[]; exclude?: undefined });

/**
 * Last write of an operation that saved something: reads the CURRENT members inside the operation's transaction (so an expulsion
 * and the operation are serialized) and appends one event per recipient. A failure returns the error and the transaction rolls back.
 */
export const emitToMembers = async (scope: NotificationScope, notifications: readonly MemberNotification[]): AsyncResult<void> => {
  const members = await scope.listMemberIds();
  if (!members.ok) return members;
  const drafts = notifications.flatMap(({ exclude, only, ...input }) => buildTripNotifications({ ...input,
    recipients: only ?? notificationRecipients(members.value, exclude ?? []) } as BuildTripNotificationsInput<TripNotificationType>));
  if (drafts.length === 0) return ok(undefined);
  return scope.appendNotifications(drafts);
};
