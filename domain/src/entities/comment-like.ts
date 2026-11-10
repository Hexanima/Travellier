import type { Comment } from "./comment.js";
import { ValidationError } from "../errors/validation-error.js";
import { err, ok, type Result } from "../types/result.js";
import type { ObjectId } from "../value-objects/object-id.js";

/** One like of a user on a comment; unique per (commentId, userId). The user is never removed when they leave the Trip. */
export interface CommentLike {
  id: ObjectId;
  tripId: ObjectId;
  commentId: ObjectId;
  userId: ObjectId;
  createdAt: Date;
}

export interface CreateCommentLikeContext {
  /** Comment resolved in the same Trip snapshot. */
  comment: Pick<Comment, "id" | "tripId">;
}

/** Copies the date; the caller resolves the comment from a consistent snapshot. */
export const createCommentLike = (input: CommentLike, context: CreateCommentLikeContext): Result<CommentLike, ValidationError> => {
  if (context.comment.id !== input.commentId || context.comment.tripId !== input.tripId) {
    return err(new ValidationError([{ field: "commentId", code: "mismatch", message: "Like must belong to a comment of the supplied Trip." }]));
  }
  if (!(input.createdAt instanceof Date) || !Number.isFinite(input.createdAt.getTime())) {
    return err(new ValidationError([{ field: "createdAt", code: "invalid", message: "Like creation time must be a valid UTC instant." }]));
  }
  return ok({ id: input.id, tripId: input.tripId, commentId: input.commentId, userId: input.userId, createdAt: new Date(input.createdAt.getTime()) });
};
