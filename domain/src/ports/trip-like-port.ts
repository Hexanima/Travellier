import type { Comment } from "../entities/comment.js";
import type { CommentLike } from "../entities/comment-like.js";
import type { Post } from "../entities/post.js";
import type { PostLike } from "../entities/post-like.js";
import type { TripRole } from "../entities/trip-member.js";
import type { Trip } from "../entities/trip.js";
import type { AsyncResult } from "../types/result.js";
import type { ObjectId } from "../value-objects/object-id.js";

/** Like count of a comment and whether the asking user liked it. */
export interface CommentLikeSummary { commentId: ObjectId; count: number; likedByMe: boolean }

/** Authorization and all references are resolved in the same Trip snapshot. Likes of former members keep counting. */
export interface TripLikeReadScope {
  findMemberRole: (userId: ObjectId) => AsyncResult<TripRole | undefined>;
  findTrip: () => AsyncResult<Pick<Trip, "id"> | undefined>;
  /** Only a post of this Trip. */
  findPost: (postId: ObjectId) => AsyncResult<Pick<Post, "id" | "tripId"> | undefined>;
  /** Only a comment of this post in this Trip. */
  findComment: (commentId: ObjectId, postId: ObjectId) => AsyncResult<Pick<Comment, "id" | "tripId" | "postId"> | undefined>;
  countPostLikes: (postId: ObjectId) => AsyncResult<number>;
  countCommentLikes: (commentId: ObjectId) => AsyncResult<number>;
  hasPostLike: (postId: ObjectId, userId: ObjectId) => AsyncResult<boolean>;
  hasCommentLike: (commentId: ObjectId, userId: ObjectId) => AsyncResult<boolean>;
  /** One entry per comment of the post in this Trip (including those without likes), oldest comment first. */
  listCommentLikeSummaries: (postId: ObjectId, userId: ObjectId) => AsyncResult<CommentLikeSummary[]>;
}

export interface TripLikeScope extends TripLikeReadScope {
  /** Idempotent: ok(true) when created, ok(false) when the user already liked; never fails for a duplicate. */
  insertPostLike: (like: PostLike) => AsyncResult<boolean>;
  deletePostLike: (postId: ObjectId, userId: ObjectId) => AsyncResult<void>;
  insertCommentLike: (like: CommentLike) => AsyncResult<boolean>;
  deleteCommentLike: (commentId: ObjectId, userId: ObjectId) => AsyncResult<void>;
}

export interface TripLikePort {
  withReadSnapshot: <T>(tripId: ObjectId, work: (scope: TripLikeReadScope) => AsyncResult<T>) => AsyncResult<T>;
  /** Serialize with Trip mutations; Result.err rolls back every write. */
  withTransaction: <T>(tripId: ObjectId, work: (scope: TripLikeScope) => AsyncResult<T>) => AsyncResult<T>;
}
