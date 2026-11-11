import { ObjectId as MongoObjectId, type Db } from "mongodb";
import { createObjectId, err, ok, TaggedError, TripNotFoundError, UnknownError, type TripMemberAdministrationPort, type TripRole } from "app-domain";

import { createOutboxStore } from "./outbox-store.js";

/** Aborts the transaction when a write expected to match does not (stale owner, membership removed meanwhile). */
class TripMemberAdministrationConflict extends TaggedError<"TripMemberAdministrationConflict"> {
  constructor() { super("TripMemberAdministrationConflict"); }
}

/**
 * Role changes, ownership transfers and member removals under the same Trip lock as deletion, journey and activity writers:
 * checks and writes see one serialized state. A rejection returned by `work` aborts the transaction, lock included.
 */
export const createMongoTripMemberAdministrationRepository = (database: Db): TripMemberAdministrationPort => ({
  withTransaction: async (tripId, work) => {
    const session = database.client.startSession();
    const mongoTripId = new MongoObjectId(tripId);
    const options = { session };
    const trips = database.collection<{ ownerId?: unknown }>("trips");
    const members = database.collection<{ role: TripRole }>("tripMembers");
    try {
      const result = await session.withTransaction(async () => {
        const lock = await trips.updateOne({ _id: mongoTripId }, { $inc: { destinationOrderRevision: 1 } }, options);
        if (lock.matchedCount === 0) throw new TripNotFoundError();
        const result = await work({
          findMember: async (userId) => {
            const member = await members.findOne({ tripId: mongoTripId, userId: new MongoObjectId(userId) }, options);
            if (member === null) return ok(undefined);
            const memberId = createObjectId(member._id.toHexString());
            if (!memberId.ok) throw memberId.error;
            return ok({ id: memberId.value, role: member.role });
          },
          findOwnerId: async () => {
            const trip = await trips.findOne({ _id: mongoTripId }, { ...options, projection: { ownerId: 1 } });
            if (!(trip?.ownerId instanceof MongoObjectId)) return ok(undefined);
            const ownerId = createObjectId(trip.ownerId.toHexString());
            return ownerId.ok ? ok(ownerId.value) : ok(undefined);
          },
          setRole: async (userId, role) => {
            const updated = await members.updateOne({ tripId: mongoTripId, userId: new MongoObjectId(userId) }, { $set: { role } }, options);
            if (updated.matchedCount !== 1) throw new TripMemberAdministrationConflict();
            return ok(undefined);
          },
          transferOwnership: async (fromUserId, toUserId) => {
            const moved = await trips.updateOne({ _id: mongoTripId, ownerId: new MongoObjectId(fromUserId) },
              { $set: { ownerId: new MongoObjectId(toUserId) } }, options);
            if (moved.matchedCount !== 1) throw new TripMemberAdministrationConflict();
            // The previous owner keeps admin: it is not touched.
            const promoted = await members.updateOne({ tripId: mongoTripId, userId: new MongoObjectId(toUserId) }, { $set: { role: "admin" } }, options);
            if (promoted.matchedCount !== 1) throw new TripMemberAdministrationConflict();
            return ok(undefined);
          },
          removeMember: async (membershipId, userId, notifications, at) => {
            const deleted = await members.deleteOne({ _id: new MongoObjectId(membershipId), tripId: mongoTripId, userId: new MongoObjectId(userId) }, options);
            if (deleted.deletedCount !== 1) return ok(false);
            // Only the start decides: an activity starting at `at` or before has started and its participation stays as record.
            const future = await database.collection("activities").find({ tripId: mongoTripId, scheduledAt: { $gt: at } }, { ...options, projection: { _id: 1 } }).toArray();
            if (future.length > 0) {
              await database.collection("activityParticipations").deleteMany(
                { tripId: mongoTripId, userId: new MongoObjectId(userId), activityId: { $in: future.map((activity) => activity._id) } }, options);
            }
            // Last write, same transaction: the notice exists only if the membership was really deleted.
            const appended = await createOutboxStore(database, tripId, session).appendNotifications(notifications);
            return appended.ok ? ok(true) : appended;
          },
        });
        if (!result.ok) throw result.error;
        return result;
      }, { readConcern: { level: "snapshot" }, readPreference: "primary" });
      return result ?? err(new UnknownError("Trip member administration transaction returned no result."));
    } catch (error) {
      return err(error instanceof TaggedError && !(error instanceof TripMemberAdministrationConflict) ? error : new UnknownError("Trip member administration database operation failed."));
    } finally { await session.endSession(); }
  },
});
