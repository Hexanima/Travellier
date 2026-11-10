import { compareNotificationPosition, encodeNotificationCursor, parseNotificationCursor, type NotificationPosition } from "../../entities/user-notification-cursor.js";
import { ValidationError, type ValidationIssue } from "../../errors/validation-error.js";
import type { UserNotificationQueryPort, UserNotificationView } from "../../ports/trip-notification-port.js";
import type { TaggedError } from "../../types/error.js";
import { err, ok } from "../../types/result.js";
import type { UseCase } from "../../types/usecase.js";
import type { ObjectId } from "../../value-objects/object-id.js";

export const DEFAULT_NOTIFICATION_PAGE_SIZE = 30;
export const MAX_NOTIFICATION_PAGE_SIZE = 60;

export interface ListUserNotificationsPayload {
  /** Always the user of the session: never read from the request body or query. */
  authenticatedUserId: ObjectId;
  /** Raw `limit`: validated here (integer 1..60, default 30). */
  limit?: unknown;
  /** Raw opaque cursor: validated here. */
  cursor?: unknown;
}
export interface UserNotificationPage { notifications: UserNotificationView[]; nextCursor: string | null }

const parseLimit = (raw: unknown): number | undefined => {
  if (raw === undefined) return DEFAULT_NOTIFICATION_PAGE_SIZE;
  const value = typeof raw === "string" ? (/^[0-9]{1,3}$/.test(raw) ? Number(raw) : NaN) : raw;
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_NOTIFICATION_PAGE_SIZE ? value : undefined;
};

/** Personal notices of the authenticated user, newest first, paged with a keyset cursor. Read-only. */
export const listUserNotifications: UseCase<{ notifications: UserNotificationQueryPort }, ListUserNotificationsPayload, UserNotificationPage, TaggedError> = {
  execute: async ({ notifications }, payload) => {
    const issues: ValidationIssue[] = [];
    const limit = parseLimit(payload.limit);
    if (limit === undefined) issues.push({ field: "limit", code: "invalid", message: `Limit must be an integer between 1 and ${MAX_NOTIFICATION_PAGE_SIZE}.` });
    let after: NotificationPosition | undefined;
    if (payload.cursor !== undefined) {
      const parsed = parseNotificationCursor(payload.cursor);
      if (parsed.ok) after = parsed.value; else issues.push(...parsed.error.issues);
    }
    if (issues.length > 0 || limit === undefined) return err(new ValidationError(issues));
    // One extra notice tells whether another page exists without a count.
    const found = await notifications.listForUser({ userId: payload.authenticatedUserId, limit: limit + 1, ...(after === undefined ? {} : { after }) });
    if (!found.ok) return found;
    const ordered = [...found.value].sort((a, b) => compareNotificationPosition({ createdAtMs: a.createdAt.getTime(), id: a.id },
      { createdAtMs: b.createdAt.getTime(), id: b.id }));
    const page = ordered.slice(0, limit), last = page[page.length - 1];
    return ok({ notifications: page, nextCursor: ordered.length > limit && last !== undefined
      ? encodeNotificationCursor({ createdAtMs: last.createdAt.getTime(), id: last.id }) : null });
  },
};
