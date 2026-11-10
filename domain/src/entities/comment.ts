import type { Post } from "./post.js";
import { ValidationError } from "../errors/validation-error.js";
import { err, ok, type Result } from "../types/result.js";
import { createCommentText } from "../value-objects/comment-text.js";
import type { ObjectId } from "../value-objects/object-id.js";

/** A comment belongs to exactly one post; it is not a child post and never alters the post chain. */
export interface Comment {
  id: ObjectId;
  tripId: ObjectId;
  postId: ObjectId;
  authorId: ObjectId;
  text: string;
  createdAt: Date;
}

export type CreateCommentInput = Omit<Comment, "text"> & { text: unknown };

export interface CreateCommentContext {
  /** Post resolved in the same Trip snapshot. */
  post: Pick<Post, "id" | "tripId">;
}

/** Normalizes the text and copies the date; the caller resolves the post from a consistent snapshot. */
export const createComment = (input: CreateCommentInput, context: CreateCommentContext): Result<Comment, ValidationError> => {
  if (context.post.id !== input.postId || context.post.tripId !== input.tripId) {
    return err(new ValidationError([{ field: "postId", code: "mismatch", message: "Comment must belong to a post of the supplied Trip." }]));
  }
  const text = createCommentText(input.text);
  if (!text.ok) return text;
  if (!(input.createdAt instanceof Date) || !Number.isFinite(input.createdAt.getTime())) {
    return err(new ValidationError([{ field: "createdAt", code: "invalid", message: "Comment creation time must be a valid UTC instant." }]));
  }
  return ok({ id: input.id, tripId: input.tripId, postId: input.postId, authorId: input.authorId,
    text: text.value, createdAt: new Date(input.createdAt.getTime()) });
};

/** Returns a copy with the new text; author, creation date and references never change. */
export const editCommentText = (comment: Comment, value: unknown): Result<Comment, ValidationError> => {
  const text = createCommentText(value);
  return text.ok ? ok({ ...comment, createdAt: new Date(comment.createdAt.getTime()), text: text.value }) : text;
};
