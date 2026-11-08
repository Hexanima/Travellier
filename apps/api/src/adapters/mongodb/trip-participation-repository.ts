import { ObjectId as MongoObjectId, type ClientSession, type Db } from "mongodb";
import { createObjectId, err, ok, TaggedError, TripNotFoundError, UnknownError,
  type ActivityParticipation, type AsyncResult, type ObjectId, type TripParticipationPort,
  type TripParticipationScope, type TripRole } from "app-domain";

type ParticipationDocument = Omit<ActivityParticipation, "id" | "tripId" | "activityId" | "userId"> & {
  _id: MongoObjectId; tripId: MongoObjectId; activityId: MongoObjectId; userId: MongoObjectId;
};
const domainId = (value: MongoObjectId): ObjectId => {
  const parsed = createObjectId(value.toHexString());
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};
const participation = (value: ParticipationDocument): ActivityParticipation => ({ id: domainId(value._id),
  tripId: domainId(value.tripId), activityId: domainId(value.activityId), userId: domainId(value.userId),
  status: value.status, updatedAt: value.updatedAt, decisionRequired: value.decisionRequired ?? null });

const createScope = (database: Db, tripId: ObjectId, session: ClientSession): TripParticipationScope => {
  const mongoTripId = new MongoObjectId(tripId), query = { tripId: mongoTripId }, options = { session };
  const records = database.collection<ParticipationDocument>("activityParticipations");
  const pair = (activityId: ObjectId, userId: ObjectId) => ({ ...query, activityId: new MongoObjectId(activityId), userId: new MongoObjectId(userId) });
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
    listUserParticipations: async (userId) => {
      const found = await records.find({ ...query, userId: new MongoObjectId(userId) }, options).toArray();
      return ok(found.map(participation));
    },
    findParticipation: async (activityId, userId) => {
      const current = await records.findOne(pair(activityId, userId), options);
      return ok(current === null ? undefined : participation(current));
    },
    save: async (value) => {
      if (value.tripId !== tripId) throw new TripNotFoundError();
      const current = await records.findOneAndUpdate(pair(value.activityId, value.userId), {
        // An explicit response (going/not_going) clears the decision marker in the same atomic write.
        $set: { status: value.status, updatedAt: value.updatedAt, ...(value.status === "pending" ? {} : { decisionRequired: null }) },
        $setOnInsert: { _id: new MongoObjectId(value.id), ...pair(value.activityId, value.userId) },
      }, { ...options, upsert: true, returnDocument: "after", includeResultMetadata: false });
      if (current === null) throw new UnknownError("Participation upsert returned no result.");
      return ok(participation(current));
    },
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
