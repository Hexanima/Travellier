import type { Activity } from "./activity.js";
import type { ItineraryDay } from "./itinerary-day.js";
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
  dayId: ObjectId;
  authorId: ObjectId;
  description: string | null;
  mapsUrl: string | null;
  createdAt: Date;
}

export type CreatePostInput = Omit<Post, "description" | "mapsUrl" | keyof PostLinks> & Partial<PostLinks> & {
  description?: string | null;
  mapsUrl?: string | null;
};

export interface CreatePostContext {
  trip: Pick<Trip, "id">;
  day: Pick<ItineraryDay, "id" | "tripId"> | null | undefined;
  activity?: Pick<Activity, "id" | "tripId"> | null;
  parentPost?: Pick<Post, "id" | "tripId"> | null;
  transport?: Pick<Transport, "id" | "tripId"> | null;
}

const invalid = (field: string, code: string, message: string) =>
  err(new ValidationError([{ field, code, message }]));

/** The caller resolves the day and requested links from a consistent persistence snapshot. */
export const createPost = (input: CreatePostInput, context: CreatePostContext): Result<Post, ValidationError> => {
  if (input.tripId !== context.trip.id) {
    return invalid("tripId", "mismatch", "Post must belong to the supplied Trip.");
  }
  const references = [
    ["dayId", input.dayId, context.day],
    ["activityId", input.activityId, context.activity],
    ["parentPostId", input.parentPostId, context.parentPost],
    ["transportId", input.transportId, context.transport],
  ] as const;
  for (const [field, referenceId, reference] of references) {
    if (referenceId == null && field !== "dayId") continue;
    if (reference == null) {
      return invalid(field, "not_found", `Post ${field} must reference an existing entity.`);
    }
    if (reference.id !== referenceId || reference.tripId !== input.tripId) {
      return invalid(field, "mismatch", `Post ${field} must reference the supplied entity in the same Trip.`);
    }
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
    id: input.id, tripId: input.tripId, dayId: input.dayId, authorId: input.authorId,
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
