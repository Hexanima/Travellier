import { ObjectId as MongoObjectId, type ClientSession, type Db } from "mongodb";
import { ActivityNotFoundError, createObjectId, err, ok, TaggedError, TripNotFoundError, UnknownError,
  type Activity, type AsyncResult, type ObjectId, type TripActivityPort, type TripActivityScope, type TripRole } from "app-domain";
import { createMongoTripJourneyRepository } from "./trip-journey-repository.js";

type ActivityDocument = Omit<Activity, "id" | "tripId" | "dayId" | "createdBy"> & {
  _id: MongoObjectId; tripId: MongoObjectId; dayId: MongoObjectId; createdBy: MongoObjectId;
};
const domainId = (value: MongoObjectId): ObjectId => {
  const parsed = createObjectId(value.toHexString());
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};
const toActivity = (value: ActivityDocument): Activity => ({ id: domainId(value._id), tripId: domainId(value.tripId),
  dayId: domainId(value.dayId), title: value.title, description: value.description, scheduledAt: value.scheduledAt,
  mapsUrl: value.mapsUrl, status: value.status, createdBy: domainId(value.createdBy), createdAt: value.createdAt });
const document = (value: Activity): ActivityDocument => ({ _id: new MongoObjectId(value.id), tripId: new MongoObjectId(value.tripId),
  dayId: new MongoObjectId(value.dayId), title: value.title, description: value.description, scheduledAt: value.scheduledAt,
  mapsUrl: value.mapsUrl, status: value.status, createdBy: new MongoObjectId(value.createdBy), createdAt: value.createdAt });

const createScope = (database: Db, tripId: ObjectId, session: ClientSession): TripActivityScope => {
  const mongoTripId = new MongoObjectId(tripId), query = { tripId: mongoTripId }, options = { session };
  const activities = database.collection<ActivityDocument>("activities");
  return {
    findMemberRole: async (userId) => {
      const member = await database.collection<{ role: TripRole }>("tripMembers")
        .findOne({ ...query, userId: new MongoObjectId(userId) }, options);
      return ok(member?.role);
    },
    findTrip: async () => {
      const trip = await database.collection<{ votingEnabled: boolean }>("trips")
        .findOne({ _id: mongoTripId }, { ...options, projection: { votingEnabled: 1 } });
      return ok(trip === null ? undefined : { id: tripId, votingEnabled: trip.votingEnabled });
    },
    listDays: () => createMongoTripJourneyRepository(database, session).listItineraryDays(tripId),
    list: async () => ok((await activities.find(query, options).sort({ scheduledAt: 1, _id: 1 }).toArray()).map(toActivity)),
    find: async (activityId) => {
      const activity = await activities.findOne({ ...query, _id: new MongoObjectId(activityId) }, options);
      return ok(activity === null ? undefined : toActivity(activity));
    },
    insert: async (activity) => {
      if (activity.tripId !== tripId) throw new TripNotFoundError();
      await activities.insertOne(document(activity), options);
      return ok(undefined);
    },
    replace: async (activity) => {
      if (activity.tripId !== tripId) throw new ActivityNotFoundError();
      const result = await activities.updateOne({ ...query, _id: new MongoObjectId(activity.id) }, { $set: {
        dayId: new MongoObjectId(activity.dayId), title: activity.title, description: activity.description,
        scheduledAt: activity.scheduledAt, mapsUrl: activity.mapsUrl,
      } }, options);
      if (result.matchedCount !== 1) throw new ActivityNotFoundError();
      return ok(undefined);
    },
    remove: async (activityId) => {
      const linked = { ...query, activityId: new MongoObjectId(activityId) };
      await database.collection("posts").updateMany(linked, { $set: { activityId: null } }, options);
      await database.collection("activityVotes").deleteMany(linked, options);
      await database.collection("activityParticipations").deleteMany(linked, options);
      const result = await activities.deleteOne({ ...query, _id: linked.activityId }, options);
      if (result.deletedCount !== 1) throw new ActivityNotFoundError();
      return ok(undefined);
    },
  };
};

export const createMongoTripActivityRepository = (database: Db): TripActivityPort => {
  const perform = async <T>(tripId: ObjectId, write: boolean, work: (scope: TripActivityScope) => AsyncResult<T>): AsyncResult<T> => {
    const session = database.client.startSession();
    try {
      const result = await session.withTransaction(async () => {
        if (write) {
          // Use the same Trip coordination document as transport regeneration and Trip deletion.
          const lock = await database.collection("trips").updateOne({ _id: new MongoObjectId(tripId) },
            { $inc: { destinationOrderRevision: 1 } }, { session });
          if (lock.matchedCount !== 1) throw new TripNotFoundError();
        }
        const result = await work(createScope(database, tripId, session));
        // Preserve driver error labels for full transaction retries and abort domain errors.
        if (!result.ok) throw result.error;
        return result;
      }, { readConcern: { level: "snapshot" }, readPreference: "primary" });
      return result ?? err(new UnknownError("Activity transaction returned no result."));
    } catch (error) {
      return err(error instanceof TaggedError ? error : new UnknownError("Activity database operation failed."));
    } finally { await session.endSession(); }
  };
  return {
    withReadSnapshot: (tripId, work) => perform(tripId, false, work),
    withTransaction: (tripId, work) => perform(tripId, true, work),
  };
};
