import type { NotificationPosition } from "../entities/user-notification-cursor.js";
import type { TripNotificationDraft, TripNotificationPayloads, TripNotificationType } from "../entities/trip-notification.js";
import type { AsyncResult } from "../types/result.js";
import type { ObjectId } from "../value-objects/object-id.js";

/**
 * Mixin of the write scopes of operations that emit events (activities, posts, comments). Both calls run in the transaction of the
 * operation: the events exist only if the operation is saved, and a failure afterwards removes them with it.
 */
export interface NotificationScope {
  /** User ids of the CURRENT members of the Trip, read under the Trip lock of the operation. */
  listMemberIds: () => AsyncResult<ObjectId[]>;
  /** Idempotent by `eventKey`: a draft whose key already exists is ignored and never aborts the transaction. */
  appendNotifications: (drafts: readonly TripNotificationDraft[]) => AsyncResult<void>;
}

/** A personal notice as read by its recipient: exact ids, no texts, no delivery state. */
export interface UserNotificationView<T extends TripNotificationType = TripNotificationType> {
  id: ObjectId;
  type: T;
  tripId: ObjectId;
  actorId: ObjectId | null;
  payload: TripNotificationPayloads[T];
  createdAt: Date;
}

export interface UserNotificationQueryPort {
  /**
   * Notices of this user newest first (`createdAt` desc, `id` desc), after `after` when given, at most `limit`. Only notices of Trips the
   * user belongs to today, plus the expulsion notice of any Trip. Read-only: it never changes a notice nor a participation.
   */
  listForUser: (input: { userId: ObjectId; limit: number; after?: NotificationPosition }) => AsyncResult<UserNotificationView[]>;
}
