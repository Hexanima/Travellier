import type { ItineraryPostResponse } from "./trip-itinerary-api.js";
import type { GalleryPhoto } from "./trip-gallery-api.js";

export type ActivityTab = "memories" | "photos";
const idPattern = /^[0-9a-f]{24}$/;

/** `?activity=<id>&tab=memories|photos`: an invalid id is dropped and an invalid or missing tab is «Recuerdos». */
export const readActivityParams = (search: string): { activityId: string | undefined; tab: ActivityTab } => {
  const params = new URLSearchParams(search);
  const activity = params.get("activity");
  return { activityId: activity !== null && idPattern.test(activity) ? activity : undefined, tab: params.get("tab") === "photos" ? "photos" : "memories" };
};

/** Publication order of the diary: newest first, ties by id descending (plain comparison, not locale-aware). */
const newerFirst = (a: Pick<ItineraryPostResponse, "id" | "createdAt">, b: Pick<ItineraryPostResponse, "id" | "createdAt">) => {
  const diff = Date.parse(b.createdAt) - Date.parse(a.createdAt);
  if (diff !== 0) return diff;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
};

/**
 * The memories of an activity from the already loaded itinerary: every post whose server-computed root activity is this one
 * (descendants included, placed or not), once each, newest first.
 */
export const activityMemories = (posts: readonly ItineraryPostResponse[], unplacedPosts: readonly ItineraryPostResponse[], activityId: string): ItineraryPostResponse[] => {
  const seen = new Set<string>();
  const result: ItineraryPostResponse[] = [];
  for (const item of [...posts, ...unplacedPosts]) {
    if (item.context.placement !== "activity" || item.context.rootActivityId !== activityId || seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }
  return result.sort(newerFirst);
};

export type MemoryThumbnails = { thumbnails: ReadonlyMap<string, GalleryPhoto>; pending: ReadonlySet<string> };

/**
 * Thumbnail of each memory (first photo of its post, lowest `order`) from the loaded gallery pages. A memory with no loaded photo is
 * text-only for certain only when nothing else can be loaded or the gallery already moved on to a strictly older post (the server orders
 * `(post.createdAt desc, postId desc)`); otherwise it is pending and nothing is claimed about it.
 */
export const memoryThumbnails = (memories: readonly ItineraryPostResponse[], photos: readonly GalleryPhoto[], hasMore: boolean): MemoryThumbnails => {
  const thumbnails = new Map<string, GalleryPhoto>();
  for (const item of photos) {
    const current = thumbnails.get(item.postId);
    if (!current || item.order < current.order) thumbnails.set(item.postId, item);
  }
  const pending = new Set<string>();
  if (!hasMore) return { thumbnails, pending };
  const last = photos[photos.length - 1];
  const frontier = last ? { id: last.postId, createdAt: last.post.createdAt } : undefined;
  for (const item of memories) {
    if (thumbnails.has(item.id)) continue;
    // Certain only if the last loaded photo is of a post strictly older than this one: the gallery passed it without finding photos.
    if (frontier === undefined || newerFirst(item, frontier) >= 0) pending.add(item.id);
  }
  return { thumbnails, pending };
};
