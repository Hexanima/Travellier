import { MAX_POST_CHAIN_DEPTH, type Post } from "./post.js";
import type { ObjectId } from "../value-objects/object-id.js";

export interface PostRoots {
  rootPostId: ObjectId;
  /** Own activity link first, else the root's. */
  activityId: ObjectId | null;
  /** Own transport link first, else the root's. */
  transportId: ObjectId | null;
}

/** A resolved chain (`null` = broken: cycle, missing parent or deeper than the technical bound). */
type Resolved = { root: Post; depth: number } | null;

/**
 * Pure projection of each post's effective activity/transport from the root of its chain. It follows the itinerary rule
 * (first link that exists in the given Trip id sets, own before the root's, else none; a broken chain counts as no chain,
 * so the post is its own root) and memoizes
 * every node, so each post is walked once instead of paying the whole chain per post. Nothing is persisted: relinking
 * or deleting an activity only changes the next projection, never the photos.
 */
export const projectPostRoots = (
  posts: readonly Post[], activityIds: ReadonlySet<ObjectId>, transportIds: ReadonlySet<ObjectId>,
): Map<ObjectId, PostRoots> => {
  const byId = new Map(posts.map((post) => [post.id, post]));
  const memo = new Map<ObjectId, Resolved>();
  const resolve = (start: Post): Resolved => {
    const path: Post[] = [], onPath = new Set<ObjectId>();
    let current: Post | undefined = start, tail: Resolved = null;
    for (;;) {
      if (current === undefined) break; // missing parent: broken
      const known = memo.get(current.id);
      if (known !== undefined) { tail = known; break; }
      if (onPath.has(current.id)) break; // cycle: broken
      onPath.add(current.id);
      if (current.parentPostId == null) { tail = { root: current, depth: 0 }; memo.set(current.id, tail); break; }
      path.push(current);
      current = byId.get(current.parentPostId);
    }
    for (let index = path.length - 1; index >= 0; index--) {
      tail = tail === null || tail.depth + 1 > MAX_POST_CHAIN_DEPTH ? null : { root: tail.root, depth: tail.depth + 1 };
      memo.set(path[index]!.id, tail);
    }
    return memo.get(start.id) ?? null;
  };
  const result = new Map<ObjectId, PostRoots>();
  for (const post of posts) {
    const chain = resolve(post), root = chain?.root ?? post;
    const activityId = [post.activityId, root.activityId].find((value) => value != null && activityIds.has(value)) ?? null;
    const transportId = [post.transportId, root.transportId].find((value) => value != null && transportIds.has(value)) ?? null;
    result.set(post.id, { rootPostId: root.id, activityId, transportId });
  }
  return result;
};
