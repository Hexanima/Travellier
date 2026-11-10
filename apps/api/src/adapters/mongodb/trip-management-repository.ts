import { MongoServerError, ObjectId as MongoObjectId, type Db } from "mongodb";

import {
  createObjectId,
  deriveTripBounds,
  err,
  InviteCodeConflictError,
  ok,
  UnknownError,
  type ObjectId,
  type Trip,
  type TripConfigurationUpdate,
  type TripCreationRecord,
  type TripDestination,
  type TripListItem,
  type PublicTripPreview,
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

const toPublicPreview = (trip: TripDocument, destination: DestinationDocument): PublicTripPreview => ({
  id: domainId(trip._id),
  name: trip.name,
  description: trip.description,
  visibility: "public",
  primaryDestination: { name: destination.name },
});

const unknownError = () => new UnknownError("Trip database operation failed.");

export const createMongoTripManagementRepository = (database: Db): TripManagementPort => {
  const trips = database.collection<TripDocument>("trips");
  const members = database.collection<MembershipDocument>("tripMembers");
  const destinations = database.collection<DestinationDocument>("destinations");
  const transports = database.collection("transports");

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
    findByIdForViewer: async (tripId, userId) => {
      try {
        const mongoTripId = new MongoObjectId(tripId);
        const member = await members.findOne({ tripId: mongoTripId, userId: new MongoObjectId(userId) }, { projection: { _id: 1 } });
        if (member === null) {
          const publicTrip = await trips.findOne(
            { _id: mongoTripId, visibility: "public" },
            { projection: { _id: 1, name: 1, description: 1, visibility: 1 } },
          );
          if (publicTrip === null) return ok(undefined);
          return ok(toPublicPreview(publicTrip, await findDestination(mongoTripId)));
        }
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
        // Una sola lectura agrupada: min/max de departureAt y arrivalAt (solo Date) por viaje.
        const bounds = await transports.aggregate<{ _id: MongoObjectId; startAt: Date; endAt: Date }>([
          { $match: { tripId: { $in: documents.map((trip) => trip._id) } } },
          { $project: { tripId: 1, instants: ["$departureAt", "$arrivalAt"] } },
          { $unwind: "$instants" },
          { $match: { instants: { $type: "date" } } },
          { $group: { _id: "$tripId", startAt: { $min: "$instants" }, endAt: { $max: "$instants" } } },
        ]).toArray();
        const boundsByTrip = new Map(bounds.map((entry) => [entry._id.toHexString(), entry]));
        const items: TripListItem[] = [];
        for (const trip of documents) {
          const entry = boundsByTrip.get(trip._id.toHexString());
          const derived = deriveTripBounds(entry === undefined ? [] : [{ departureAt: entry.startAt, arrivalAt: entry.endAt }]);
          items.push({ ...toView(trip, await findDestination(trip._id)), startAt: derived.startAt, endAt: derived.endAt });
        }
        return ok(items);
      } catch {
        return err(unknownError());
      }
    },
    listPublic: async () => {
      try {
        const documents = await trips.find(
          { visibility: "public" },
          { projection: { _id: 1, name: 1, description: 1, visibility: 1 } },
        ).sort({ createdAt: -1, _id: -1 }).toArray();
        if (documents.length === 0) return ok([]);
        const primaryDestinations = await destinations.find(
          { tripId: { $in: documents.map((trip) => trip._id) }, order: 1 },
          { projection: { tripId: 1, name: 1 } },
        ).toArray();
        const destinationByTrip = new Map(primaryDestinations.map((destination) => [destination.tripId.toHexString(), destination]));
        return ok(documents.map((trip) => {
          const destination = destinationByTrip.get(trip._id.toHexString());
          if (destination === undefined) throw new Error("Trip has no primary destination.");
          return toPublicPreview(trip, destination);
        }));
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
