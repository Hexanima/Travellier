import type { Post } from "./post.js";
import { ValidationError } from "../errors/validation-error.js";
import { err, ok, type Result } from "../types/result.js";
import type { ObjectId } from "../value-objects/object-id.js";

/** One like of a user on a post; unique per (postId, userId). The user is never removed when they leave the Trip. */
export interface PostLike {
  id: ObjectId;
  tripId: ObjectId;
  postId: ObjectId;
  userId: ObjectId;
  createdAt: Date;
}

export interface CreatePostLikeContext {
  /** Post resolved in the same Trip snapshot. */
  post: Pick<Post, "id" | "tripId">;
}

/** Copies the date; the caller resolves the post from a consistent snapshot. */
export const createPostLike = (input: PostLike, context: CreatePostLikeContext): Result<PostLike, ValidationError> => {
  if (context.post.id !== input.postId || context.post.tripId !== input.tripId) {
    return err(new ValidationError([{ field: "postId", code: "mismatch", message: "Like must belong to a post of the supplied Trip." }]));
  }
  if (!(input.createdAt instanceof Date) || !Number.isFinite(input.createdAt.getTime())) {
    return err(new ValidationError([{ field: "createdAt", code: "invalid", message: "Like creation time must be a valid UTC instant." }]));
  }
  return ok({ id: input.id, tripId: input.tripId, postId: input.postId, userId: input.userId, createdAt: new Date(input.createdAt.getTime()) });
};
