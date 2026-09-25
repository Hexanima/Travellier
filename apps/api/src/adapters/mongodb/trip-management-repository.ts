import { MongoServerError, ObjectId as MongoObjectId, type Db } from "mongodb";

import {
  createObjectId,
  err,
  InviteCodeConflictError,
  ok,
  UnknownError,
  type ObjectId,
  type Trip,
  type TripConfigurationUpdate,
  type TripCreationRecord,
  type TripDestination,
  type TripManagementPort,
  type TripView,
} from "app-domain";

type TripDocument = Omit<Trip, "id" | "createdBy"> & {
  _id: MongoObjectId;
  createdBy: MongoObjectId;
};
type DestinationDocument = Omit<TripDestination, "id" | "tripId"> & {
  _id: MongoObjectId;
  tripId: MongoObjectId;
};
type MembershipDocument = {
  _id: MongoObjectId;
  tripId: MongoObjectId;
  userId: MongoObjectId;
  role: "admin" | "participant";
  joinedAt: Date;
};

const domainId = (id: MongoObjectId): ObjectId => {
  const result = createObjectId(id.toHexString());
  if (!result.ok) throw result.error;
  return result.value;
};

const tripDocument = (trip: Trip): TripDocument => ({
  _id: new MongoObjectId(trip.id),
  name: trip.name,
  description: trip.description,
  visibility: trip.visibility,
  inviteCode: trip.inviteCode,
  votingEnabled: trip.votingEnabled,
  expenseMode: trip.expenseMode,
  createdBy: new MongoObjectId(trip.createdBy),
  createdAt: trip.createdAt,
});

const destinationDocument = (destination: TripDestination): DestinationDocument => ({
  _id: new MongoObjectId(destination.id),
  tripId: new MongoObjectId(destination.tripId),
  name: destination.name,
  order: destination.order,
  createdAt: destination.createdAt,
});

const toView = (trip: TripDocument, destination: DestinationDocument): TripView => ({
  id: domainId(trip._id),
  name: trip.name,
  description: trip.description,
  visibility: trip.visibility,
  inviteCode: trip.inviteCode,
  votingEnabled: trip.votingEnabled,
  expenseMode: trip.expenseMode,
  createdBy: domainId(trip.createdBy),
  createdAt: trip.createdAt,
  primaryDestination: {
    id: domainId(destination._id),
    tripId: domainId(destination.tripId),
    name: destination.name,
    order: destination.order,
    createdAt: destination.createdAt,
  },
});

const unknownError = () => new UnknownError("Trip database operation failed.");

export const createMongoTripManagementRepository = (database: Db): TripManagementPort => {
  const trips = database.collection<TripDocument>("trips");
  const members = database.collection<MembershipDocument>("tripMembers");
  const destinations = database.collection<DestinationDocument>("destinations");

  const findDestination = async (tripId: MongoObjectId): Promise<DestinationDocument> => {
    const destination = await destinations.findOne({ tripId, order: 1 });
    if (destination === null) throw new Error("Trip has no primary destination.");
    return destination;
  };

  return {
    createWithAdminAndDestination: async (record: TripCreationRecord) => {
      const session = database.client.startSession();
      try {
        await session.withTransaction(async () => {
          await trips.insertOne(tripDocument(record.trip), { session });
          await members.insertOne({
            _id: new MongoObjectId(record.creatorMembership.id),
            tripId: new MongoObjectId(record.creatorMembership.tripId),
            userId: new MongoObjectId(record.creatorMembership.userId),
            role: record.creatorMembership.role,
            joinedAt: record.creatorMembership.joinedAt,
          }, { session });
          await destinations.insertOne(destinationDocument(record.primaryDestination), { session });
        });
        return ok(undefined);
      } catch (error) {
        if (error instanceof MongoServerError && error.code === 11_000 && error.keyPattern?.inviteCode === 1) {
          return err(new InviteCodeConflictError());
        }
        return err(unknownError());
      } finally {
        await session.endSession();
      }
    },
    findByIdForMember: async (tripId, userId) => {
      try {
        const mongoTripId = new MongoObjectId(tripId);
        const member = await members.findOne({ tripId: mongoTripId, userId: new MongoObjectId(userId) }, { projection: { _id: 1 } });
        if (member === null) return ok(undefined);
        const trip = await trips.findOne({ _id: mongoTripId });
        if (trip === null) return ok(undefined);
        return ok(toView(trip, await findDestination(mongoTripId)));
      } catch {
        return err(unknownError());
      }
    },
    listForMember: async (userId) => {
      try {
        const memberships = await members.find({ userId: new MongoObjectId(userId) }, { projection: { tripId: 1 } }).toArray();
        if (memberships.length === 0) return ok([]);
        const tripIds = memberships.map((membership) => membership.tripId);
        const documents = await trips.find({ _id: { $in: tripIds } }).sort({ createdAt: -1, _id: -1 }).toArray();
        const views: TripView[] = [];
        for (const trip of documents) {
          views.push(toView(trip, await findDestination(trip._id)));
        }
        return ok(views);
      } catch {
        return err(unknownError());
      }
    },
    updateConfigurationForMember: async (tripId, userId, update: TripConfigurationUpdate) => {
      try {
        const mongoTripId = new MongoObjectId(tripId);
        const member = await members.findOne({ tripId: mongoTripId, userId: new MongoObjectId(userId) }, { projection: { _id: 1 } });
        if (member === null) return ok(undefined);
        const trip = await trips.findOneAndUpdate({ _id: mongoTripId }, { $set: update }, { returnDocument: "after" });
        if (trip === null) return ok(undefined);
        return ok(toView(trip, await findDestination(mongoTripId)));
      } catch {
        return err(unknownError());
      }
    },
  };
};
