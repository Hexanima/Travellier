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
  list: () => AsyncResult<Post[]>;
  /** Direct children of a post in this Trip, newest publication first (id descending on ties). */
  listChildren: (postId: ObjectId) => AsyncResult<Post[]>;
  /** Photos of a post of this Trip, `order` ascending. */
  listPhotos: (postId: ObjectId) => AsyncResult<PostPhoto[]>;
  /** Photos of any of these posts within this Trip (`tripId` and `postId`), `order` ascending inside each post; the order across posts is the caller's. */
  listPhotosByPosts: (postIds: readonly ObjectId[]) => AsyncResult<PostPhoto[]>;
  /** Photo by id whatever its Trip: the caller compares `tripId` with the Trip it authorized. */
  findPhoto: (photoId: ObjectId) => AsyncResult<PostPhoto | undefined>;
}

export interface TripPostScope extends TripPostReadScope {
  insert: (post: Post) => AsyncResult<void>;
  replace: (post: Post) => AsyncResult<void>;
  /** Registered photos with any of these S3 keys, in any Trip. */
  findPhotosByKeys: (keys: readonly string[]) => AsyncResult<PostPhoto[]>;
  /** Writes the photo records; a key already registered fails with `PhotoConflictError`. */
  insertPhotos: (photos: readonly PostPhoto[]) => AsyncResult<void>;
  /** Expense of a post of this Trip (1:1 by `postId`); a legacy record has `currency` null. */
  findExpense: (postId: ObjectId) => AsyncResult<PostExpense | undefined>;
  /** Writes a new expense; a second one for the same post fails with `ExpenseConflictError`. */
  insertExpense: (expense: PostExpense) => AsyncResult<void>;
  /** `$set` of only these fields of an existing expense; never replaces the record (payers, payments and shares are kept). */
  updateExpenseFields: (expense: PostExpense, fields: readonly PostExpenseField[]) => AsyncResult<void>;
  insertActivity: (activity: Activity) => AsyncResult<void>;
  /** Complete activities of the Trip, to review the author's agenda in the same snapshot. */
  listActivities: () => AsyncResult<Activity[]>;
  /** Every participation of this user in the Trip. */
  listUserParticipations: (userId: ObjectId) => AsyncResult<ActivityParticipation[]>;
  /** Upsert only this activity/user pair in the same transaction. */
  saveParticipation: (participation: ActivityParticipation) => AsyncResult<ActivityParticipation>;
}

export interface TripPostPort {
  withReadSnapshot: <T>(tripId: ObjectId, work: (scope: TripPostReadScope) => AsyncResult<T>) => AsyncResult<T>;
  /** Serialize with Trip mutations; Result.err rolls back every write. */
  withTransaction: <T>(tripId: ObjectId, work: (scope: TripPostScope) => AsyncResult<T>) => AsyncResult<T>;
}
