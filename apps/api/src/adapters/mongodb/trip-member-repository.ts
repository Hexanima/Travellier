import { ObjectId as MongoObjectId, type Db } from "mongodb";

import {
  createObjectId,
  err,
  ok,
  UnknownError,
  type ObjectId,
  type TripMember,
  type TripMemberListingPort,
  type TripMemberManagementPort,
  type TripMemberSummary,
  type TripRole,
} from "app-domain";

type MembershipDocument = {
  _id: MongoObjectId;
  tripId: MongoObjectId;
  userId: MongoObjectId;
  role: TripRole;
  joinedAt: Date;
};

type UserNameDocument = { _id: MongoObjectId; name: string };

const domainId = (id: MongoObjectId): ObjectId => {
  const result = createObjectId(id.toHexString());
  if (!result.ok) throw result.error;
  return result.value;
};

const toMember = (document: MembershipDocument): TripMember => ({
  id: domainId(document._id),
  tripId: domainId(document.tripId),
  userId: domainId(document.userId),
  role: document.role,
  joinedAt: document.joinedAt,
});

const unknownError = () => new UnknownError("Trip member database operation failed.");

export const createMongoTripMemberRepository = (database: Db): TripMemberManagementPort & TripMemberListingPort => {
  const members = database.collection<MembershipDocument>("tripMembers");
  const users = database.collection<UserNameDocument>("users");

  return {
    findByTripAndUser: async (tripId, userId) => {
      try {
        const document = await members.findOne({ tripId: new MongoObjectId(tripId), userId: new MongoObjectId(userId) });
        return ok(document === null ? undefined : toMember(document));
      } catch {
        return err(unknownError());
      }
    },
    listByTrip: async (tripId) => {
      try {
        const documents = await members.find({ tripId: new MongoObjectId(tripId) })
          .sort({ joinedAt: 1, _id: 1 }).toArray();
        if (documents.length === 0) return ok([]);
        const userDocuments = await users.find(
          { _id: { $in: documents.map((member) => member.userId) } },
          { projection: { name: 1 } },
        ).toArray();
        const names = new Map(userDocuments.map((user) => [user._id.toHexString(), user.name]));
        const summaries: TripMemberSummary[] = documents.map((document) => {
          const name = names.get(document.userId.toHexString());
          if (name === undefined) throw new Error("Trip member user is missing.");
          return {
            id: domainId(document._id),
            userId: domainId(document.userId),
            name,
            role: document.role,
            joinedAt: document.joinedAt,
          };
        });
        return ok(summaries);
      } catch {
        return err(unknownError());
      }
    },
    removeParticipant: async (membershipId, tripId, userId) => {
      const session = database.client.startSession();
      try {
        const removed = await session.withTransaction(async () => {
          const mongoTripId = new MongoObjectId(tripId);
          // Share activity/itinerary/Trip-deletion coordination before revoking access.
          const lock = await database.collection("trips").updateOne({ _id: mongoTripId },
            { $inc: { destinationOrderRevision: 1 } }, { session });
          if (lock.matchedCount === 0) return false;
          const result = await members.deleteOne({
            _id: new MongoObjectId(membershipId),
            tripId: mongoTripId,
            userId: new MongoObjectId(userId),
            role: "participant",
          }, { session });
          return result.deletedCount === 1;
        }, { readConcern: { level: "snapshot" }, readPreference: "primary" });
        return removed === undefined ? err(unknownError()) : ok(removed);
      } catch {
        return err(unknownError());
      } finally {
        await session.endSession();
      }
    },
  };
};
