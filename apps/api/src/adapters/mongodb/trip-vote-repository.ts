import { ObjectId as MongoObjectId, type ClientSession, type Db } from "mongodb";
import { ActivityNotFoundError, createObjectId, err, ok, TaggedError, TripNotFoundError, UnknownError,
  type ActivityStatus, type ActivityVote, type AsyncResult, type ObjectId, type TripVotePort,
  type TripVoteScope, type TripRole } from "app-domain";

type VoteDocument = Omit<ActivityVote, "id" | "tripId" | "activityId" | "userId"> & {
  _id: MongoObjectId; tripId: MongoObjectId; activityId: MongoObjectId; userId: MongoObjectId;
};
const domainId = (value: MongoObjectId): ObjectId => {
  const parsed = createObjectId(value.toHexString());
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};
const vote = (value: VoteDocument): ActivityVote => ({ id: domainId(value._id),
  tripId: domainId(value.tripId), activityId: domainId(value.activityId), userId: domainId(value.userId),
  value: value.value, createdAt: value.createdAt });

const createScope = (database: Db, tripId: ObjectId, session: ClientSession): TripVoteScope => {
  const mongoTripId = new MongoObjectId(tripId), query = { tripId: mongoTripId }, options = { session };
  const records = database.collection<VoteDocument>("activityVotes");
  const pair = (activityId: ObjectId, userId: ObjectId) => ({ ...query, activityId: new MongoObjectId(activityId), userId: new MongoObjectId(userId) });
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
    findActivity: async (activityId) => {
      const activity = await database.collection<{ status: ActivityStatus }>("activities")
        .findOne({ ...query, _id: new MongoObjectId(activityId) }, { ...options, projection: { status: 1 } });
      return ok(activity === null ? undefined : { id: activityId, tripId, status: activity.status });
    },
    findVote: async (activityId, userId) => {
      const current = await records.findOne(pair(activityId, userId), options);
      return ok(current === null ? undefined : vote(current));
    },
    save: async (value) => {
      if (value.tripId !== tripId) throw new TripNotFoundError();
      const current = await records.findOneAndUpdate(pair(value.activityId, value.userId), {
        $set: { value: value.value },
        $setOnInsert: { _id: new MongoObjectId(value.id), ...pair(value.activityId, value.userId), createdAt: value.createdAt },
      }, { ...options, upsert: true, returnDocument: "after", includeResultMetadata: false });
      if (current === null) throw new UnknownError("Vote upsert returned no result.");
      return ok(vote(current));
    },
    setActivityStatus: async (activityId, status) => {
      const updated = await database.collection("activities").updateOne({ ...query, _id: new MongoObjectId(activityId) },
        { $set: { status } }, options);
      if (updated.matchedCount !== 1) throw new ActivityNotFoundError();
      return ok(undefined);
    },
  };
};

export const createMongoTripVoteRepository = (database: Db): TripVotePort => {
  const perform = async <T>(tripId: ObjectId, write: boolean, work: (scope: TripVoteScope) => AsyncResult<T>): AsyncResult<T> => {
    const session = database.client.startSession();
    try {
      const result = await session.withTransaction(async () => {
        if (write) {
          // Coordinate with activity/Trip deletion, configuration, itinerary changes and expulsion before authorizing.
          const lock = await database.collection("trips").updateOne({ _id: new MongoObjectId(tripId) },
            { $inc: { destinationOrderRevision: 1 } }, { session });
          if (lock.matchedCount !== 1) throw new TripNotFoundError();
        }
        const result = await work(createScope(database, tripId, session));
        // Keep driver error labels until withTransaction has retried conflicts; domain errors abort all writes.
        if (!result.ok) throw result.error;
        return result;
      }, { readConcern: { level: "snapshot" }, readPreference: "primary" });
      return result ?? err(new UnknownError("Vote transaction returned no result."));
    } catch (error) {
      return err(error instanceof TaggedError ? error : new UnknownError("Vote database operation failed."));
    } finally { await session.endSession(); }
  };
  return {
    withReadSnapshot: (tripId, work) => perform(tripId, false, work),
    withTransaction: (tripId, work) => perform(tripId, true, work),
  };
};
