import type { ActivityParticipation } from "../entities/activity-participation.js";
import type { Activity } from "../entities/activity.js";
import type { ItineraryDay } from "../entities/itinerary-day.js";
import type { PostExpense, PostExpenseField } from "../entities/post-expense.js";
import type { PostPhoto } from "../entities/post-photo.js";
import type { Post } from "../entities/post.js";
import type { Transport } from "../entities/transport.js";
import type { TripRole } from "../entities/trip-member.js";
import type { Trip } from "../entities/trip.js";
import type { AsyncResult } from "../types/result.js";
import type { ObjectId } from "../value-objects/object-id.js";
import type { NotificationScope } from "./trip-notification-port.js";

/** Authorization and all references are resolved in the same Trip snapshot. */
export interface TripPostReadScope {
  findMemberRole: (userId: ObjectId) => AsyncResult<TripRole | undefined>;
  findTrip: () => AsyncResult<Pick<Trip, "id"> | undefined>;
  listDays: () => AsyncResult<ItineraryDay[]>;
  findActivity: (activityId: ObjectId) => AsyncResult<Pick<Activity, "id" | "tripId"> | undefined>;
  findTransport: (transportId: ObjectId) => AsyncResult<Pick<Transport, "id" | "tripId"> | undefined>;
  /** Ids of the activities of this Trip (existing now), to validate post links in the same snapshot. */
  listActivityIds: () => AsyncResult<ObjectId[]>;
  /** Ids of the transports of this Trip (existing now), to validate post links in the same snapshot. */
  listTransportIds: () => AsyncResult<ObjectId[]>;
  find: (postId: ObjectId) => AsyncResult<Post | undefined>;
  /** Owner of a post by id whatever its Trip: only to tell a client-supplied post id that is free from one that is taken (never exposed). */
  findPostOwner: (postId: ObjectId) => AsyncResult<Pick<Post, "id" | "tripId" | "authorId"> | undefined>;
  list: () => AsyncResult<Post[]>;
  /** Direct children of a post in this Trip, newest publication first (id descending on ties). */
  listChildren: (postId: ObjectId) => AsyncResult<Post[]>;
  /** Photos of a post of this Trip, `order` ascending. */
  listPhotos: (postId: ObjectId) => AsyncResult<PostPhoto[]>;
  /** Photos of any of these posts within this Trip (`tripId` and `postId`), `order` ascending inside each post; the order across posts is the caller's. */
  listPhotosByPosts: (postIds: readonly ObjectId[]) => AsyncResult<PostPhoto[]>;
  /** Photo by id whatever its Trip: the caller compares `tripId` with the Trip it authorized. */
  findPhoto: (photoId: ObjectId) => AsyncResult<PostPhoto | undefined>;
  /** Expense of a post of this Trip (1:1 by `postId`); a legacy record has `currency` null. */
  findExpense: (postId: ObjectId) => AsyncResult<PostExpense | undefined>;
  /**
   * Which of these users are CURRENT members of the Trip, read in the same scope as `authorize`. In a write scope that runs under the Trip lock,
   * so an expulsion and an expense save are serialized; in a read scope it is a consistent snapshot and takes no lock. A user not listed may be a
   * former member or never have belonged: they cannot be told apart.
   */
  listMemberUserIds: (userIds: ObjectId[]) => AsyncResult<ObjectId[]>;
}

/** `appendNotifications` is the last write of a creation that saved something (T91). */
export interface TripPostScope extends TripPostReadScope, NotificationScope {
  insert: (post: Post) => AsyncResult<void>;
  replace: (post: Post) => AsyncResult<void>;
  /** Registered photos with any of these S3 keys, in any Trip. */
  findPhotosByKeys: (keys: readonly string[]) => AsyncResult<PostPhoto[]>;
  /** Writes the photo records; a key already registered fails with `PhotoConflictError`. */
  insertPhotos: (photos: readonly PostPhoto[]) => AsyncResult<void>;
  /** Writes a new expense (`payments` and `shares` are stored as given, empty by default); a second one for the same post fails with `ExpenseConflictError`. */
  insertExpense: (expense: PostExpense) => AsyncResult<void>;
  /** `$set` of only these fields of an existing expense; never replaces the record (the legacy `paidBy`, `createdAt` and the lists not listed are kept). */
  updateExpenseFields: (expense: PostExpense, fields: readonly PostExpenseField[]) => AsyncResult<void>;
  insertActivity: (activity: Activity) => AsyncResult<void>;
  /** Complete activities of the Trip, to review the author's agenda in the same snapshot. */
  listActivities: () => AsyncResult<Activity[]>;
  /** Every participation of this user in the Trip. */
  listUserParticipations: (userId: ObjectId) => AsyncResult<ActivityParticipation[]>;
  /** Upsert only this activity/user pair in the same transaction. */
  saveParticipation: (participation: ActivityParticipation) => AsyncResult<ActivityParticipation>;
  /** Moves the direct children of a post of this Trip under `newParentId` (`null` = independent); only `parentPostId` changes. */
  relinkChildren: (postId: ObjectId, newParentId: ObjectId | null) => AsyncResult<void>;
  /** Removes the expense of a post of this Trip (nothing to remove is not an error). */
  deleteExpense: (postId: ObjectId) => AsyncResult<void>;
  /** Removes the comments of a post (with the likes of those comments) and the likes of the post itself. */
  deletePostEngagement: (postId: ObjectId) => AsyncResult<void>;
  /** Removes the photo records of a post of this Trip (the objects are cleaned by `enqueueStorageDeletion`). */
  deletePhotos: (postId: ObjectId) => AsyncResult<void>;
  /** Removes only these photo records of a post of this Trip (ids of other posts or Trips are ignored); the objects are cleaned by `enqueueStorageDeletion`. */
  deletePhotosByIds: (postId: ObjectId, photoIds: readonly ObjectId[]) => AsyncResult<void>;
  /**
   * Sets the `order` of photos of a post of this Trip. Call it after the removals, with `updates` in ascending order of the OLD `order`: each
   * new value is never above the old one and the gaps are already free, so applying them one by one never meets the unique index.
   */
  setPhotoOrders: (postId: ObjectId, updates: readonly { id: ObjectId; order: number }[]) => AsyncResult<void>;
  /** Records one pending storage deletion job for these object keys, in the same transaction. */
  enqueueStorageDeletion: (keys: readonly string[], createdAt: Date) => AsyncResult<void>;
  /** Removes one post of this Trip; no document matched fails with `PostNotFoundError`. */
  deletePost: (postId: ObjectId) => AsyncResult<void>;
}

export interface TripPostPort {
  withReadSnapshot: <T>(tripId: ObjectId, work: (scope: TripPostReadScope) => AsyncResult<T>) => AsyncResult<T>;
  /** Serialize with Trip mutations; Result.err rolls back every write. */
  withTransaction: <T>(tripId: ObjectId, work: (scope: TripPostScope) => AsyncResult<T>) => AsyncResult<T>;
}
