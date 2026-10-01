import { MongoServerError, ObjectId as MongoObjectId, type Db } from "mongodb";
import { createObjectId, err, JourneyConflictError, ok, UnknownError, ValidationError,
  type ObjectId, type Transport, type TripDestination, type TripJourneyPort } from "app-domain";

type DestinationDocument = Omit<TripDestination, "id" | "tripId"> & { _id: MongoObjectId; tripId: MongoObjectId };
type TransportDocument = Omit<Transport, "id" | "tripId" | "destinationId"> & {
  _id: MongoObjectId; tripId: MongoObjectId; destinationId: MongoObjectId;
};

const domainId = (value: MongoObjectId): ObjectId => {
  const result = createObjectId(value.toHexString());
  if (!result.ok) throw result.error;
  return result.value;
};
const toDestination = (value: DestinationDocument): TripDestination => ({
  id: domainId(value._id), tripId: domainId(value.tripId), name: value.name, order: value.order, createdAt: value.createdAt,
});
const toTransport = (value: TransportDocument): Transport => ({ ...value,
  id: domainId(value._id), tripId: domainId(value.tripId), destinationId: domainId(value.destinationId),
} as Transport);
const transportDocument = (value: Transport): TransportDocument => ({
  _id: new MongoObjectId(value.id), tripId: new MongoObjectId(value.tripId), destinationId: new MongoObjectId(value.destinationId),
  direction: value.direction, type: value.type, departurePlace: value.departurePlace, departureAt: value.departureAt,
  arrivalPlace: value.arrivalPlace, arrivalAt: value.arrivalAt, costPerPerson: value.costPerPerson, details: value.details,
});
const failure = (error: unknown) => err(error instanceof ValidationError ? error :
  error instanceof MongoServerError && error.code === 11000 ? new JourneyConflictError() :
    new UnknownError("Trip journey database operation failed."));

export const createMongoTripJourneyRepository = (database: Db): TripJourneyPort => {
  const trips = database.collection("trips");
  const destinations = database.collection<DestinationDocument>("destinations");
  const transports = database.collection<TransportDocument>("transports");

  return {
    listDestinations: async (tripId) => {
      try {
        const documents = await destinations.find({ tripId: new MongoObjectId(tripId) }).sort({ order: 1 }).toArray();
        return ok(documents.map(toDestination));
      } catch (error) { return failure(error); }
    },
    appendDestination: async (destination) => {
      const session = database.client.startSession();
      try {
        const result = await session.withTransaction(async () => {
          const tripId = new MongoObjectId(destination.tripId);
          const lock = await trips.updateOne({ _id: tripId }, { $inc: { destinationOrderRevision: 1 } }, { session });
          if (lock.matchedCount === 0) return undefined;
          const count = await destinations.countDocuments({ tripId }, { session });
          const document: DestinationDocument = { _id: new MongoObjectId(destination.id), tripId, name: destination.name,
            order: count + 1, createdAt: destination.createdAt };
          await destinations.insertOne(document, { session });
          return toDestination(document);
        });
        return ok(result);
      } catch (error) { return failure(error); }
      finally { await session.endSession(); }
    },
    findDestination: async (tripId, destinationId) => {
      try {
        const document = await destinations.findOne({ _id: new MongoObjectId(destinationId), tripId: new MongoObjectId(tripId) });
        return ok(document === null ? undefined : toDestination(document));
      } catch (error) { return failure(error); }
    },
    updateDestination: async (tripId, destinationId, update) => {
      const session = database.client.startSession();
      try {
        const result = await session.withTransaction(async () => {
          const mongoTripId = new MongoObjectId(tripId);
          const lock = await trips.updateOne({ _id: mongoTripId }, { $inc: { destinationOrderRevision: 1 } }, { session });
          if (lock.matchedCount === 0) return undefined;
          const documents = await destinations.find({ tripId: mongoTripId }, { session }).sort({ order: 1 }).toArray();
          const index = documents.findIndex((item) => item._id.equals(new MongoObjectId(destinationId)));
          if (index < 0) return undefined;
          const target = update.order ?? documents[index]!.order;
          if (!Number.isSafeInteger(target) || target < 1 || target > documents.length) {
            throw new ValidationError([{ field: "order", code: "invalid", message: "Destination order is outside the Trip." }]);
          }
          const [moved] = documents.splice(index, 1);
          documents.splice(target - 1, 0, moved!);
          const max = Math.max(...documents.map((item) => item.order));
          for (const [position, item] of documents.entries()) {
            await destinations.updateOne({ _id: item._id, tripId: mongoTripId }, { $set: { order: max + position + 1 } }, { session });
          }
          for (const [position, item] of documents.entries()) {
            await destinations.updateOne({ _id: item._id, tripId: mongoTripId }, {
              $set: { order: position + 1, ...(item._id.equals(new MongoObjectId(destinationId)) && update.name !== undefined ? { name: update.name } : {}) },
            }, { session });
          }
          return toDestination({ ...moved!, name: update.name ?? moved!.name, order: target });
        });
        return ok(result);
      } catch (error) { return failure(error); }
      finally { await session.endSession(); }
    },
    listTransports: async (tripId, destinationId) => {
      try {
        const documents = await transports.find({ tripId: new MongoObjectId(tripId), destinationId: new MongoObjectId(destinationId) })
          .sort({ direction: 1, departureAt: 1 }).toArray();
        return ok(documents.map(toTransport));
      } catch (error) { return failure(error); }
    },
    insertTransport: async (transport) => {
      const session = database.client.startSession();
      try {
        const result = await session.withTransaction(async () => {
          const match = await destinations.findOne({ _id: new MongoObjectId(transport.destinationId), tripId: new MongoObjectId(transport.tripId) }, { session });
          if (match === null) return undefined;
          await transports.insertOne(transportDocument(transport), { session });
          return transport;
        });
        return ok(result);
      } catch (error) { return failure(error); }
      finally { await session.endSession(); }
    },
    replaceTransport: async (transport) => {
      try {
        const document = transportDocument(transport);
        const result = await transports.findOneAndUpdate(
          { _id: document._id, tripId: document.tripId, destinationId: document.destinationId },
          { $set: { direction: document.direction, type: document.type, departurePlace: document.departurePlace,
            departureAt: document.departureAt, arrivalPlace: document.arrivalPlace, arrivalAt: document.arrivalAt,
            costPerPerson: document.costPerPerson, details: document.details } },
          { returnDocument: "after" },
        );
        return ok(result === null ? undefined : toTransport(result));
      } catch (error) { return failure(error); }
    },
  };
};
