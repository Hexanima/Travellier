import { MongoServerError, ObjectId as MongoObjectId, type ClientSession, type Db } from "mongodb";

import {
  createObjectId,
  err,
  ok,
  UnknownError,
  TaggedError,
  TripNotFoundError,
  type TripInvitationRepository,
  type TripMembershipRepository,
} from "app-domain";

const unknownError = () => new UnknownError("Trip invitation database operation failed.");

export const createMongoTripInvitationRepositories = (database: Db): {
  trips: TripInvitationRepository;
  members: TripMembershipRepository;
} => {
  const trips = database.collection<{
    _id: MongoObjectId;
    inviteCode: string;
    visibility?: "private" | "public";
    publicJoinLockId?: MongoObjectId;
  }>("trips");
  const members = database.collection<{
    _id: MongoObjectId;
    tripId: MongoObjectId;
    userId: MongoObjectId;
    role: "admin" | "participant";
    joinedAt: Date;
  }>("tripMembers");

  const upsertParticipant = async (tripId: MongoObjectId, userId: MongoObjectId, session?: ClientSession): Promise<boolean> => {
    const result = await members.updateOne(
      { tripId, userId },
      { $setOnInsert: { role: "participant", joinedAt: new Date() } },
      { upsert: true, ...(session === undefined ? {} : { session }) },
    );
    return result.upsertedCount === 1;
  };

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
        const session = database.client.startSession();
        try {
          const joined = await session.withTransaction(async () => {
            // Serialize invitation joins with group deletion; a stale invitation must not create an orphan.
            const lock = await trips.findOneAndUpdate({ _id: new MongoObjectId(tripId) },
              { $set: { publicJoinLockId: new MongoObjectId() } }, { session, projection: { _id: 1 } });
            if (lock === null) throw new TripNotFoundError();
            return upsertParticipant(new MongoObjectId(tripId), new MongoObjectId(userId), session);
          });
          return ok(joined ?? false);
        } catch (error) {
          if (error instanceof MongoServerError && error.code === 11_000) return ok(false);
          if (error instanceof TaggedError) return err(error);
          return err(unknownError());
        } finally { await session.endSession(); }
      },
      addPublicParticipant: async (tripId, userId) => {
        const session = database.client.startSession();
        try {
          const joined = await session.withTransaction(async () => {
            // Change the Trip document to lock visibility until the membership transaction commits.
            const publicTrip = await trips.findOneAndUpdate(
              { _id: new MongoObjectId(tripId), visibility: "public" },
              { $set: { publicJoinLockId: new MongoObjectId() } },
              { session, projection: { _id: 1 } },
            );
            if (publicTrip === null) return undefined;

            return upsertParticipant(new MongoObjectId(tripId), new MongoObjectId(userId), session);
          });
          return ok(joined);
        } catch (error) {
          if (error instanceof MongoServerError && error.code === 11_000) return ok(false);
          return err(unknownError());
        } finally {
          await session.endSession();
        }
      },
    },
  };
};
