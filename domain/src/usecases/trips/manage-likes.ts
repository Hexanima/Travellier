import { createCommentLike } from "../../entities/comment-like.js";
import { createPostLike } from "../../entities/post-like.js";
import { CommentNotFoundError } from "../../errors/comment-not-found-error.js";
import { PostNotFoundError } from "../../errors/post-not-found-error.js";
import { TripNotFoundError } from "../../errors/trip-not-found-error.js";
import type { CommentLikeSummary, TripLikePort, TripLikeReadScope } from "../../ports/trip-like-port.js";
import type { TaggedError } from "../../types/error.js";
import { err, ok } from "../../types/result.js";
import type { UseCase } from "../../types/usecase.js";
import type { ObjectId } from "../../value-objects/object-id.js";

export interface TripPostLikePayload { tripId: ObjectId; postId: ObjectId; authenticatedUserId: ObjectId }
export interface TripCommentLikePayload extends TripPostLikePayload { commentId: ObjectId }
/** State of the caller's like after the operation, with the total count (former members included). */
export interface LikeState { liked: boolean; count: number }
export interface TripPostLikesView {
  post: { count: number; likedByMe: boolean };
  comments: CommentLikeSummary[];
}
interface Dependencies { likes: TripLikePort }
interface CreationDependencies extends Dependencies { createId: () => ObjectId; now: () => Date }

/** Only a current member of an existing Trip; anyone else gets the same not-found as a missing Trip. */
const authorize = async (scope: TripLikeReadScope, payload: TripPostLikePayload) => {
  const member = await scope.findMemberRole(payload.authenticatedUserId);
  if (!member.ok) return member;
  if (member.value !== "admin" && member.value !== "participant") return err(new TripNotFoundError());
  const trip = await scope.findTrip();
  if (!trip.ok) return trip;
  return trip.value?.id === payload.tripId ? ok(trip.value) : err(new TripNotFoundError());
};
const findPost = async (scope: TripLikeReadScope, payload: TripPostLikePayload) => {
  const post = await scope.findPost(payload.postId);
  if (!post.ok) return post;
  return post.value?.id === payload.postId && post.value.tripId === payload.tripId ? ok(post.value) : err(new PostNotFoundError());
};
const findComment = async (scope: TripLikeReadScope, payload: TripCommentLikePayload) => {
  const found = await scope.findComment(payload.commentId, payload.postId);
  if (!found.ok) return found;
  const comment = found.value;
  return comment?.id === payload.commentId && comment.tripId === payload.tripId && comment.postId === payload.postId
    ? ok(comment) : err(new CommentNotFoundError());
};
const resolvePost = async (scope: TripLikeReadScope, payload: TripPostLikePayload) => {
  const trip = await authorize(scope, payload);
  return trip.ok ? findPost(scope, payload) : trip;
};
const resolveComment = async (scope: TripLikeReadScope, payload: TripCommentLikePayload) => {
  const post = await resolvePost(scope, payload);
  if (!post.ok) return post;
  const comment = await findComment(scope, payload);
  return comment.ok ? ok({ post: post.value, comment: comment.value }) : comment;
};

/** Idempotent: liking twice keeps one like; the count is read again inside the same transaction. */
export const likeTripPost: UseCase<CreationDependencies, TripPostLikePayload, LikeState, TaggedError> = {
  execute: ({ likes, createId, now }, payload) => likes.withTransaction<LikeState>(payload.tripId, async (scope) => {
    const post = await resolvePost(scope, payload);
    if (!post.ok) return post;
    const like = createPostLike({ id: createId(), tripId: payload.tripId, postId: payload.postId,
      userId: payload.authenticatedUserId, createdAt: now() }, { post: post.value });
    if (!like.ok) return like;
    const inserted = await scope.insertPostLike(like.value);
    if (!inserted.ok) return inserted;
    const count = await scope.countPostLikes(payload.postId);
    return count.ok ? ok({ liked: true, count: count.value }) : count;
  }),
};

export const unlikeTripPost: UseCase<Dependencies, TripPostLikePayload, LikeState, TaggedError> = {
  execute: ({ likes }, payload) => likes.withTransaction<LikeState>(payload.tripId, async (scope) => {
    const post = await resolvePost(scope, payload);
    if (!post.ok) return post;
    const deleted = await scope.deletePostLike(payload.postId, payload.authenticatedUserId);
    if (!deleted.ok) return deleted;
    const count = await scope.countPostLikes(payload.postId);
    return count.ok ? ok({ liked: false, count: count.value }) : count;
  }),
};

export const likeTripComment: UseCase<CreationDependencies, TripCommentLikePayload, LikeState, TaggedError> = {
  execute: ({ likes, createId, now }, payload) => likes.withTransaction<LikeState>(payload.tripId, async (scope) => {
    const resolved = await resolveComment(scope, payload);
    if (!resolved.ok) return resolved;
    const like = createCommentLike({ id: createId(), tripId: payload.tripId, commentId: payload.commentId,
      userId: payload.authenticatedUserId, createdAt: now() }, { comment: resolved.value.comment });
    if (!like.ok) return like;
    const inserted = await scope.insertCommentLike(like.value);
    if (!inserted.ok) return inserted;
    const count = await scope.countCommentLikes(payload.commentId);
    return count.ok ? ok({ liked: true, count: count.value }) : count;
  }),
};

export const unlikeTripComment: UseCase<Dependencies, TripCommentLikePayload, LikeState, TaggedError> = {
  execute: ({ likes }, payload) => likes.withTransaction<LikeState>(payload.tripId, async (scope) => {
    const resolved = await resolveComment(scope, payload);
    if (!resolved.ok) return resolved;
    const deleted = await scope.deleteCommentLike(payload.commentId, payload.authenticatedUserId);
    if (!deleted.ok) return deleted;
    const count = await scope.countCommentLikes(payload.commentId);
    return count.ok ? ok({ liked: false, count: count.value }) : count;
  }),
};

/** Counts and the caller's own likes for a post and its comments, from a snapshot without writes. */
export const getTripPostLikes: UseCase<Dependencies, TripPostLikePayload, TripPostLikesView, TaggedError> = {
  execute: ({ likes }, payload) => likes.withReadSnapshot<TripPostLikesView>(payload.tripId, async (scope) => {
    const post = await resolvePost(scope, payload);
    if (!post.ok) return post;
    const count = await scope.countPostLikes(payload.postId);
    if (!count.ok) return count;
    const liked = await scope.hasPostLike(payload.postId, payload.authenticatedUserId);
    if (!liked.ok) return liked;
    const comments = await scope.listCommentLikeSummaries(payload.postId, payload.authenticatedUserId);
    if (!comments.ok) return comments;
    return ok({ post: { count: count.value, likedByMe: liked.value }, comments: comments.value });
  }),
};
