import { MongoServerError, ObjectId as MongoObjectId, type Db } from "mongodb";

import {
  createObjectId,
  deriveTripSchedule,
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

type TripDocument = Omit<Trip, "id" | "createdBy" | "ownerId"> & {
  _id: MongoObjectId;
  /** Ausente solo en viajes anteriores a la migración 0010. */
  ownerId?: MongoObjectId;
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
  ownerId: new MongoObjectId(trip.ownerId),
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

const toDestination = (destination: DestinationDocument): TripDestination => ({
  id: domainId(destination._id),
  tripId: domainId(destination.tripId),
  name: destination.name,
  order: destination.order,
  createdAt: destination.createdAt,
});

const toBaseView = (trip: TripDocument): Trip => ({
  id: domainId(trip._id),
  name: trip.name,
  description: trip.description,
  visibility: trip.visibility,
  inviteCode: trip.inviteCode,
  expenseMode: trip.expenseMode,
  // Solo lectura: un viaje sin migrar muestra createdBy; la autorización de baja no usa este respaldo.
  ownerId: domainId(trip.ownerId ?? trip.createdBy),
  createdBy: domainId(trip.createdBy),
  createdAt: trip.createdAt,
});

const toView = (trip: TripDocument, destination: DestinationDocument): TripView => ({
  ...toBaseView(trip),
  primaryDestination: toDestination(destination),
});

type TransportEntry = { destinationId?: unknown; direction?: unknown; departureAt?: unknown; arrivalAt?: unknown };

/** Como toView, pero tolera un viaje sin destino primario (datos incompletos). */
const toListView = (trip: TripDocument, destination: DestinationDocument | undefined): Omit<TripListItem, "startAt" | "endAt"> => ({
  ...toBaseView(trip),
  primaryDestination: destination === undefined ? null : toDestination(destination),
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
        const tripObjectIds = documents.map((trip) => trip._id);
        // Un solo find para todos los destinos y una sola aggregate para los transportes.
        const allDestinations = await destinations.find({ tripId: { $in: tripObjectIds } }, { projection: { tripId: 1, name: 1, order: 1, createdAt: 1 } }).toArray();
        const destinationsByTrip = new Map<string, DestinationDocument[]>();
        for (const destination of allDestinations) {
          const key = destination.tripId.toHexString();
          destinationsByTrip.set(key, [...(destinationsByTrip.get(key) ?? []), destination]);
        }
        const grouped = await transports.aggregate<{ _id: MongoObjectId; transports: TransportEntry[] }>([
          { $match: { tripId: { $in: tripObjectIds } } },
          { $group: { _id: "$tripId", transports: { $push: { destinationId: "$destinationId", direction: "$direction", departureAt: "$departureAt", arrivalAt: "$arrivalAt" } } } },
        ]).toArray();
        const transportsByTrip = new Map(grouped.map((entry) => [entry._id.toHexString(), entry.transports]));
        const items: TripListItem[] = documents.map((trip) => {
          const tripDestinations = destinationsByTrip.get(trip._id.toHexString()) ?? [];
          const primary = tripDestinations.find((destination) => destination.order === 1);
          const derived = deriveTripSchedule(
            primary === undefined ? [] : tripDestinations.map((destination) => destination._id.toHexString()),
            (transportsByTrip.get(trip._id.toHexString()) ?? []).map((entry) => ({
              destinationId: entry.destinationId instanceof MongoObjectId ? entry.destinationId.toHexString() : "",
              direction: typeof entry.direction === "string" ? entry.direction : "",
              departureAt: entry.departureAt,
              arrivalAt: entry.arrivalAt,
            })),
          );
          return { ...toListView(trip, primary), startAt: derived.startAt, endAt: derived.endAt };
        });
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
