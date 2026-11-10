import type { Comment } from "../entities/comment.js";
import type { Post } from "../entities/post.js";
import type { TripRole } from "../entities/trip-member.js";
import type { Trip } from "../entities/trip.js";
import type { NotificationScope } from "./trip-notification-port.js";
import type { AsyncResult } from "../types/result.js";
import type { ObjectId } from "../value-objects/object-id.js";

/** Authorization and all references are resolved in the same Trip snapshot. */
export interface TripCommentReadScope {
  findMemberRole: (userId: ObjectId) => AsyncResult<TripRole | undefined>;
  findTrip: () => AsyncResult<Pick<Trip, "id"> | undefined>;
  /** Only a post of this Trip. */
  findPost: (postId: ObjectId) => AsyncResult<Pick<Post, "id" | "tripId"> | undefined>;
  /** Only a comment of this post in this Trip. */
  findComment: (commentId: ObjectId, postId: ObjectId) => AsyncResult<Comment | undefined>;
  /** Comments of a post in this Trip, oldest first (id ascending on ties). */
  listComments: (postId: ObjectId) => AsyncResult<Comment[]>;
  /** Subset of the given users that are current members of this Trip. */
  listMemberUserIds: (userIds: ObjectId[]) => AsyncResult<ObjectId[]>;
}

/** `appendNotifications` is the last write of `insert`'s operation (T91). */
export interface TripCommentScope extends TripCommentReadScope, NotificationScope {
  insert: (comment: Comment) => AsyncResult<void>;
  /** Changes only the text of an existing comment of this post and Trip. */
  replaceText: (comment: Comment) => AsyncResult<void>;
}

export interface TripCommentPort {
  withReadSnapshot: <T>(tripId: ObjectId, work: (scope: TripCommentReadScope) => AsyncResult<T>) => AsyncResult<T>;
  /** Serialize with Trip mutations; Result.err rolls back every write. */
  withTransaction: <T>(tripId: ObjectId, work: (scope: TripCommentScope) => AsyncResult<T>) => AsyncResult<T>;
}
