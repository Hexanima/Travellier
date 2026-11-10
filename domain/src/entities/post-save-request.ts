import type { Activity } from "./activity.js";
import type { Post, PostLinks } from "./post.js";

/** What is stored of a joint post save, read back to recognize a retry. */
export interface StoredPostSave {
  post: Post;
  /** The activity the post links to, when the request carried a new one. */
  activity: Pick<Activity, "title" | "description" | "scheduledAt" | "durationMinutes" | "mapsUrl"> | null;
  /** S3 keys of the photos of the post, in order. */
  photoKeys: readonly string[];
  hasExpense: boolean;
}

/** The persistable intent of a save request: what the use case would write, already parsed. */
export interface PostSaveRequest extends Partial<Pick<Post, "description" | "mapsUrl">>, Partial<PostLinks> {
  newActivity?: Pick<Activity, "title" | "scheduledAt"> & Partial<Pick<Activity, "description" | "mapsUrl" | "durationMinutes">>;
  /** Verified photo keys of the request, in order; absent when it carried no photos. */
  photoKeys?: readonly string[];
  /** The request carried an expense. */
  expenseSent?: boolean;
  /** Whether that expense, normalized, equals the stored one (only read when `expenseSent`). */
  expenseMatches: boolean;
}

/**
 * A retry of a save is the SAME request when every persistable field equals what was stored: description, maps link, the three
 * links (an omitted field is null, as the creation stores it), the new activity (title, start, duration, description, maps link),
 * the photo keys as an ordered list and the expense. Anything else, including a retry that adds or drops a part, is a different
 * request. Pure: it compares, never validates (a retry is not revalidated against the current window or agenda).
 */
export const isSameRequest = (stored: StoredPostSave, request: PostSaveRequest): boolean => {
  const { post } = stored;
  if ((request.description ?? null) !== post.description || (request.mapsUrl ?? null) !== post.mapsUrl) return false;
  if ((request.parentPostId ?? null) !== post.parentPostId || (request.transportId ?? null) !== post.transportId) return false;
  if (request.newActivity === undefined) {
    if ((request.activityId ?? null) !== post.activityId) return false;
  } else {
    const { activity } = stored, wanted = request.newActivity;
    if (post.activityId === null || activity === null || request.activityId != null) return false;
    if (wanted.title !== activity.title || wanted.scheduledAt.getTime() !== activity.scheduledAt.getTime()) return false;
    if ((wanted.durationMinutes ?? null) !== activity.durationMinutes || (wanted.description ?? null) !== activity.description
      || (wanted.mapsUrl ?? null) !== activity.mapsUrl) return false;
  }
  const keys = request.photoKeys ?? [];
  if (keys.length !== stored.photoKeys.length || keys.some((key, index) => key !== stored.photoKeys[index])) return false;
  return (request.expenseSent ?? false) === stored.hasExpense && (!request.expenseSent || request.expenseMatches);
};
