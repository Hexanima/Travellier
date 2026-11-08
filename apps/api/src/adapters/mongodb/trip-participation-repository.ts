import { ObjectId as MongoObjectId, type ClientSession, type Db } from "mongodb";
import { err, ok, TaggedError, TripNotFoundError, UnknownError,
  type AsyncResult, type ObjectId, type TripParticipationPort,
  type TripParticipationScope, type TripRole } from "app-domain";

import { createParticipationStore, domainId, type ParticipationDocument } from "./activity-participation-store.js";

const createScope = (database: Db, tripId: ObjectId, session: ClientSession): TripParticipationScope => {
  const mongoTripId = new MongoObjectId(tripId), query = { tripId: mongoTripId }, options = { session };
  const records = database.collection<ParticipationDocument>("activityParticipations");
  const store = createParticipationStore(records, tripId, session);
  return {
    findMemberRole: async (userId) => {
      const member = await database.collection<{ role: TripRole }>("tripMembers")
        .findOne({ ...query, userId: new MongoObjectId(userId) }, options);
      return ok(member?.role);
    },
    findTrip: async () => {
      const trip = await database.collection("trips").findOne({ _id: mongoTripId }, { ...options, projection: { _id: 1 } });
      return ok(trip === null ? undefined : { id: tripId });
    },
    findActivity: async (activityId) => {
      const activity = await database.collection("activities").findOne({ ...query, _id: new MongoObjectId(activityId) },
        { ...options, projection: { _id: 1, tripId: 1, scheduledAt: 1, durationMinutes: 1 } });
      return ok(activity === null ? undefined : { id: activityId, tripId, scheduledAt: activity.scheduledAt,
        durationMinutes: activity.durationMinutes ?? null });
    },
    listActivities: async () => {
      const found = await database.collection<{ _id: MongoObjectId; scheduledAt: Date; durationMinutes?: number | null }>("activities")
        .find(query, { ...options, projection: { _id: 1, scheduledAt: 1, durationMinutes: 1 } }).toArray();
      return ok(found.map((activity) => ({ id: domainId(activity._id), tripId, scheduledAt: activity.scheduledAt,
        durationMinutes: activity.durationMinutes ?? null })));
    },
    listUserParticipations: store.listUserParticipations,
    findParticipation: store.findParticipation,
    save: store.save,
  };
};

export const createMongoTripParticipationRepository = (database: Db): TripParticipationPort => {
  const perform = async <T>(tripId: ObjectId, write: boolean, work: (scope: TripParticipationScope) => AsyncResult<T>): AsyncResult<T> => {
    const session = database.client.startSession();
    try {
      const result = await session.withTransaction(async () => {
        if (write) {
          // Coordinate with activity/Trip deletion, itinerary changes and expulsion before authorizing.
          const lock = await database.collection("trips").updateOne({ _id: new MongoObjectId(tripId) },
            { $inc: { destinationOrderRevision: 1 } }, { session });
          if (lock.matchedCount !== 1) throw new TripNotFoundError();
        }
        const result = await work(createScope(database, tripId, session));
        // Driver errors retain their labels until withTransaction has retried conflicts.
        if (!result.ok) throw result.error;
        return result;
      }, { readConcern: { level: "snapshot" }, readPreference: "primary" });
      return result ?? err(new UnknownError("Participation transaction returned no result."));
    } catch (error) {
      return err(error instanceof TaggedError ? error : new UnknownError("Participation database operation failed."));
    } finally { await session.endSession(); }
  };
  return {
    withReadSnapshot: (tripId, work) => perform(tripId, false, work),
    withTransaction: (tripId, work) => perform(tripId, true, work),
  };
};
