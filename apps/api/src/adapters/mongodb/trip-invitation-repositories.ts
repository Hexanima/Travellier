import { MongoServerError, ObjectId as MongoObjectId, type Db } from "mongodb";

import {
  createObjectId,
  err,
  ok,
  UnknownError,
  type TripInvitationRepository,
  type TripMembershipRepository,
} from "app-domain";

const unknownError = () => new UnknownError("Trip invitation database operation failed.");

export const createMongoTripInvitationRepositories = (database: Db): {
  trips: TripInvitationRepository;
  members: TripMembershipRepository;
} => {
  const trips = database.collection<{ _id: MongoObjectId; inviteCode: string }>("trips");
  const members = database.collection<{
    _id: MongoObjectId;
    tripId: MongoObjectId;
    userId: MongoObjectId;
    role: "admin" | "participant";
    joinedAt: Date;
  }>("tripMembers");

  return {
    trips: {
      findByInviteCode: async (code) => {
        try {
          const trip = await trips.findOne({ inviteCode: code }, { projection: { _id: 1 } });
          if (trip === null) return ok(undefined);
          const id = createObjectId(trip._id.toHexString());
          return id.ok ? ok({ id: id.value }) : id;
        } catch {
          return err(unknownError());
        }
      },
    },
    members: {
      addParticipant: async (tripId, userId) => {
        try {
          const result = await members.updateOne(
            { tripId: new MongoObjectId(tripId), userId: new MongoObjectId(userId) },
            { $setOnInsert: { role: "participant", joinedAt: new Date() } },
            { upsert: true },
          );
          return ok(result.upsertedCount === 1);
        } catch (error) {
          if (error instanceof MongoServerError && error.code === 11_000) return ok(false);
          return err(unknownError());
        }
      },
    },
  };
};
