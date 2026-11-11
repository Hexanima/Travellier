import type { TripRole } from "../entities/trip-member.js";
import type { TripNotificationDraft } from "../entities/trip-notification.js";
import type { AsyncResult } from "../types/result.js";
import type { ObjectId } from "../value-objects/object-id.js";

/** All operations are scoped to the Trip locked by withTransaction. */
export interface TripMemberAdministrationScope {
  findMember: (userId: ObjectId) => AsyncResult<{ id: ObjectId; role: TripRole } | undefined>;
  /** Titular actual (`trips.ownerId`); `undefined` si el viaje todavía no lo tiene. */
  findOwnerId: () => AsyncResult<ObjectId | undefined>;
  setRole: (userId: ObjectId, role: TripRole) => AsyncResult<void>;
  /** `trips.ownerId = toUserId`, el destino queda admin y el anterior titular conserva admin. */
  transferOwnership: (fromUserId: ObjectId, toUserId: ObjectId) => AsyncResult<void>;
  /**
   * Single path for leaving and expulsion. Deletes the membership (any role) and, only if it was deleted and in the same
   * transaction, the user's participations in activities of the Trip that start after `at` (decisionRequired marks included;
   * those already started are kept as record) and writes `notifications`.
   */
  removeMember: (membershipId: ObjectId, userId: ObjectId, notifications: readonly TripNotificationDraft[], at: Date) => AsyncResult<boolean>;
}

export interface TripMemberAdministrationPort {
  withTransaction: <T>(tripId: ObjectId, work: (scope: TripMemberAdministrationScope) => AsyncResult<T>) => AsyncResult<T>;
}
