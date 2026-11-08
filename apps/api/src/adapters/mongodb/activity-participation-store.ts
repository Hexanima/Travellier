import { ObjectId as MongoObjectId, type ClientSession, type Collection } from "mongodb";
import { createObjectId, ok, TripNotFoundError, UnknownError,
  type ActivityParticipation, type AsyncResult, type ObjectId } from "app-domain";

export type ParticipationDocument = Omit<ActivityParticipation, "id" | "tripId" | "activityId" | "userId"> & {
  _id: MongoObjectId; tripId: MongoObjectId; activityId: MongoObjectId; userId: MongoObjectId;
};
export const domainId = (value: MongoObjectId): ObjectId => {
  const parsed = createObjectId(value.toHexString());
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};
export const toParticipation = (value: ParticipationDocument): ActivityParticipation => ({ id: domainId(value._id),
  tripId: domainId(value.tripId), activityId: domainId(value.activityId), userId: domainId(value.userId),
  status: value.status, updatedAt: value.updatedAt, decisionRequired: value.decisionRequired ?? null });

/** Participation reads/writes shared by every transactional scope; always pass the transaction session. */
export const createParticipationStore = (records: Collection<ParticipationDocument>, tripId: ObjectId, session: ClientSession) => {
  const mongoTripId = new MongoObjectId(tripId), options = { session };
  const pair = (activityId: ObjectId, userId: ObjectId) => ({ tripId: mongoTripId, activityId: new MongoObjectId(activityId), userId: new MongoObjectId(userId) });
  return {
    listUserParticipations: async (userId: ObjectId): AsyncResult<ActivityParticipation[]> => {
      const found = await records.find({ tripId: mongoTripId, userId: new MongoObjectId(userId) }, options).toArray();
      return ok(found.map(toParticipation));
    },
    findParticipation: async (activityId: ObjectId, userId: ObjectId): AsyncResult<ActivityParticipation | undefined> => {
      const current = await records.findOne(pair(activityId, userId), options);
      return ok(current === null ? undefined : toParticipation(current));
    },
    listGoingOfActivity: async (activityId: ObjectId): AsyncResult<ActivityParticipation[]> => {
      const found = await records.find({ tripId: mongoTripId, activityId: new MongoObjectId(activityId), status: "going" }, options)
        .sort({ _id: 1 }).toArray();
      return ok(found.map(toParticipation));
    },
    listGoingByUsers: async (userIds: ObjectId[]): AsyncResult<ActivityParticipation[]> => {
      const found = await records.find({ tripId: mongoTripId, status: "going", userId: { $in: userIds.map((u) => new MongoObjectId(u)) } }, options).toArray();
      return ok(found.map(toParticipation));
    },
    save: async (value: ActivityParticipation): AsyncResult<ActivityParticipation> => {
      if (value.tripId !== tripId) throw new TripNotFoundError();
      const current = await records.findOneAndUpdate(pair(value.activityId, value.userId), {
        // An explicit response (going/not_going) clears the decision marker in the same atomic write.
        // pending keeps the stored marker unless a new one is provided (schedule edits); going/not_going always clear it.
        $set: { status: value.status, updatedAt: value.updatedAt, ...(value.status !== "pending" ? { decisionRequired: null }
          : value.decisionRequired ? { decisionRequired: { reason: value.decisionRequired.reason,
            changedFields: [...value.decisionRequired.changedFields], changedAt: value.decisionRequired.changedAt } } : {}) },
        $setOnInsert: { _id: new MongoObjectId(value.id), ...pair(value.activityId, value.userId) },
      }, { ...options, upsert: true, returnDocument: "after", includeResultMetadata: false });
      if (current === null) throw new UnknownError("Participation upsert returned no result.");
      return ok(toParticipation(current));
    },
  };
};
