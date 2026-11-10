import type { ActivityParticipation } from "../entities/activity-participation.js";
import type { Activity } from "../entities/activity.js";
import type { ItineraryDay } from "../entities/itinerary-day.js";
import type { TripRole } from "../entities/trip-member.js";
import type { Trip } from "../entities/trip.js";
import type { AsyncResult } from "../types/result.js";
import type { ObjectId } from "../value-objects/object-id.js";
import type { NotificationScope } from "./trip-notification-port.js";

/** Every operation uses the same Trip and persistence snapshot. */
export interface TripActivityReadScope {
  findMemberRole: (userId: ObjectId) => AsyncResult<TripRole | undefined>;
  findTrip: () => AsyncResult<Pick<Trip, "id"> | undefined>;
  listDays: () => AsyncResult<ItineraryDay[]>;
  list: () => AsyncResult<Activity[]>;
  find: (activityId: ObjectId) => AsyncResult<Activity | undefined>;
}

/** `appendNotifications` is the last write of a create or edit that saved something (T91). */
export interface TripActivityScope extends TripActivityReadScope, NotificationScope {
  /** Every participation of this user in the Trip. */
  listUserParticipations: (userId: ObjectId) => AsyncResult<ActivityParticipation[]>;
  /** `going` participations of the activity whose user is a current Trip member (former members keep theirs as a record). */
  listGoingParticipants: (activityId: ObjectId) => AsyncResult<ActivityParticipation[]>;
  /** `going` participations of these users in the Trip (batch, avoids one query per user). */
  listGoingParticipationsByUsers: (userIds: ObjectId[]) => AsyncResult<ActivityParticipation[]>;
  /** Upsert only this activity/user pair in the same transaction; going/not_going clears decisionRequired atomically and pending persists the given marker. */
  saveParticipation: (participation: ActivityParticipation) => AsyncResult<ActivityParticipation>;
  insert: (activity: Activity) => AsyncResult<void>;
  replace: (activity: Activity) => AsyncResult<void>;
  /** Atomically detach posts and delete the activity and participations. Preserve historical votes. */
  remove: (activityId: ObjectId) => AsyncResult<void>;
}

export interface TripActivityPort {
  withReadSnapshot: <T>(tripId: ObjectId, work: (scope: TripActivityReadScope) => AsyncResult<T>) => AsyncResult<T>;
  /** Serialize with itinerary/Trip mutations; Result.err aborts every write. */
  withTransaction: <T>(tripId: ObjectId, work: (scope: TripActivityScope) => AsyncResult<T>) => AsyncResult<T>;
}
