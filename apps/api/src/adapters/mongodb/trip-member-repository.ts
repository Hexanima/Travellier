import { ObjectId as MongoObjectId, type Db } from "mongodb";

import {
  createObjectId,
  err,
  ok,
  UnknownError,
  type ObjectId,
  type TripMember,
  type TripMemberListingPort,
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

type UserNameDocument = { _id: MongoObjectId; name?: string | null };

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

export const createMongoTripMemberRepository = (database: Db): TripMemberListingPort => {
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
        const trip = await database.collection<{ ownerId?: unknown }>("trips")
          .findOne({ _id: new MongoObjectId(tripId) }, { projection: { ownerId: 1 } });
        const ownerHex = trip?.ownerId instanceof MongoObjectId ? trip.ownerId.toHexString() : undefined;
        const userDocuments = await users.find(
          { _id: { $in: documents.map((member) => member.userId) } },
          { projection: { name: 1 } },
        ).toArray();
        const names = new Map(userDocuments.map((user) => [
          user._id.toHexString(),
          typeof user.name === "string" && user.name.trim() !== "" ? user.name : null,
        ]));
        const summaries: TripMemberSummary[] = documents.map((document) => {
          const userId = document.userId.toHexString();
          if (!names.has(userId)) throw new Error("Trip member user is missing.");
          const name = names.get(userId) ?? null;
          return {
            id: domainId(document._id),
            userId: domainId(document.userId),
            name,
            role: document.role,
            isOwner: userId === ownerHex,
            joinedAt: document.joinedAt,
          };
        });
        return ok(summaries);
      } catch {
        return err(unknownError());
      }
    },
  };
};
