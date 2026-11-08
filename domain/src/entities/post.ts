import type { Activity } from "./activity.js";
import type { Transport } from "./transport.js";
import type { Trip } from "./trip.js";
import { ValidationError } from "../errors/validation-error.js";
import { err, ok, type Result } from "../types/result.js";
import type { ObjectId } from "../value-objects/object-id.js";

export interface PostLinks {
  activityId: ObjectId | null;
  parentPostId: ObjectId | null;
  transportId: ObjectId | null;
}

export interface Post extends PostLinks {
  id: ObjectId;
  tripId: ObjectId;
  /** @deprecated Legacy read-only field of records created before T54; never required, written or edited. */
  dayId?: ObjectId | null;
  authorId: ObjectId;
  description: string | null;
  mapsUrl: string | null;
  createdAt: Date;
}

export type CreatePostInput = Omit<Post, "dayId" | "description" | "mapsUrl" | keyof PostLinks> & Partial<PostLinks> & {
  description?: string | null;
  mapsUrl?: string | null;
};

export interface CreatePostContext {
  trip: Pick<Trip, "id">;
  activity?: Pick<Activity, "id" | "tripId"> | null;
  parentPost?: Pick<Post, "id" | "tripId"> | null;
  transport?: Pick<Transport, "id" | "tripId"> | null;
}

const invalid = (field: string, code: string, message: string) =>
  err(new ValidationError([{ field, code, message }]));

/** The post is independent of the itinerary; the caller resolves the requested links from a consistent persistence snapshot. */
export const createPost = (input: CreatePostInput, context: CreatePostContext): Result<Post, ValidationError> => {
  if (input.tripId !== context.trip.id) {
    return invalid("tripId", "mismatch", "Post must belong to the supplied Trip.");
  }
  if (input.parentPostId === input.id) {
    return invalid("parentPostId", "self_reference", "Post must link to another post, not itself.");
  }
  const references = [
    ["activityId", input.activityId, context.activity],
    ["parentPostId", input.parentPostId, context.parentPost],
    ["transportId", input.transportId, context.transport],
  ] as const;
  for (const [field, referenceId, reference] of references) {
    if (referenceId == null) continue;
    if (reference == null) {
      return invalid(field, "not_found", `Post ${field} must reference an existing entity.`);
    }
    if (reference.id !== referenceId || reference.tripId !== input.tripId) {
      return invalid(field, "mismatch", `Post ${field} must reference the supplied entity in the same Trip.`);
    }
  }
  // A child hangs only from its immediate parent; the root activity is projected by walking the chain.
  if (input.parentPostId != null && (input.activityId != null || input.transportId != null)) {
    return invalid("parentPostId", "conflict", "A post linked to a parent cannot also link directly to an activity or transport.");
  }
  for (const field of ["description", "mapsUrl"] as const) {
    if (input[field] != null && typeof input[field] !== "string") {
      return invalid(field, "invalid", `Post ${field} must be text or null.`);
    }
  }
  if (!(input.createdAt instanceof Date) || !Number.isFinite(input.createdAt.getTime())) {
    return invalid("createdAt", "invalid", "Post creation time must be a valid UTC instant.");
  }
  return ok({
    id: input.id, tripId: input.tripId, authorId: input.authorId,
    description: input.description ?? null, mapsUrl: input.mapsUrl ?? null,
    activityId: input.activityId ?? null, parentPostId: input.parentPostId ?? null,
    transportId: input.transportId ?? null, createdAt: new Date(input.createdAt.getTime()),
  });
};

/** Undefined preserves a link; null removes it. Resolve retained links as well as replacements. */
export const relinkPost = (post: Post, links: Partial<PostLinks>, context: CreatePostContext): Result<Post, ValidationError> =>
  createPost({
    ...post,
    activityId: links.activityId === undefined ? post.activityId : links.activityId,
    parentPostId: links.parentPostId === undefined ? post.parentPostId : links.parentPostId,
    transportId: links.transportId === undefined ? post.transportId : links.transportId,
  }, context);

/** Technical anti-corruption bound; there is no functional maximum depth. */
export const MAX_POST_CHAIN_DEPTH = 1000;

export interface PostChain {
  /** Nearest parent first, root last. */
  ancestors: Post[];
  rootPostId: ObjectId;
  rootActivityId: ObjectId | null;
}

/** Walks immediate parents up to the root; tolerates corrupt data by reporting cycles instead of looping. */
export const resolvePostChain = (post: Post, lookup: (postId: ObjectId) => Post | undefined): Result<PostChain, ValidationError> => {
  const visited = new Set<ObjectId>([post.id]), ancestors: Post[] = [];
  let current = post;
  while (current.parentPostId != null) {
    if (visited.has(current.parentPostId)) return invalid("parentPostId", "cycle", "Post chain contains a cycle.");
    if (ancestors.length >= MAX_POST_CHAIN_DEPTH) return invalid("parentPostId", "too_deep", "Post chain exceeds the supported depth.");
    const parent = lookup(current.parentPostId);
    if (parent === undefined) return invalid("parentPostId", "not_found", "Post chain references a missing post.");
    visited.add(parent.id);
    ancestors.push(parent);
    current = parent;
  }
  return ok({ ancestors, rootPostId: current.id, rootActivityId: current.activityId });
};
