import { MongoServerError, ObjectId as MongoObjectId, type ClientSession, type Db } from "mongodb";
import { createObjectId, err, JourneyConflictError, ok, TaggedError, TripNotFoundError, UnknownError, ValidationError,
  type AsyncResult, type ItineraryDay, type ObjectId, type Transport, type TripDestination, type TripJourneyPort } from "app-domain";

type DestinationDocument = Omit<TripDestination, "id" | "tripId"> & { _id: MongoObjectId; tripId: MongoObjectId };
type TransportDocument = Omit<Transport, "id" | "tripId" | "destinationId"> & {
  _id: MongoObjectId; tripId: MongoObjectId; destinationId: MongoObjectId;
};
type ItineraryDayDocument = Omit<ItineraryDay, "id" | "tripId" | "destinationId"> & {
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
const toTransport = (value: TransportDocument): Transport => {
  const { _id, ...fields } = value;
  return { ...fields, id: domainId(_id), tripId: domainId(value.tripId), destinationId: domainId(value.destinationId) } as Transport;
};
const transportDocument = (value: Transport): TransportDocument => ({
  _id: new MongoObjectId(value.id), tripId: new MongoObjectId(value.tripId), destinationId: new MongoObjectId(value.destinationId),
  direction: value.direction, type: value.type, departurePlace: value.departurePlace, departureAt: value.departureAt,
  arrivalPlace: value.arrivalPlace, arrivalAt: value.arrivalAt, costPerPerson: value.costPerPerson, details: value.details,
});
const failure = (error: unknown) => err(error instanceof TaggedError ? error :
  error instanceof MongoServerError && error.code === 11000 ? new JourneyConflictError() :
    new UnknownError("Trip journey database operation failed."));

export const createMongoTripJourneyRepository = (database: Db, session?: ClientSession): TripJourneyPort => {
  const trips = database.collection("trips");
  const destinations = database.collection<DestinationDocument>("destinations");
  const transports = database.collection<TransportDocument>("transports");
  const itineraryDays = database.collection<ItineraryDayDocument>("itineraryDays");
  const options = session ? { session } : {};
  const perform = async <T>(work: () => Promise<T>): AsyncResult<T> => {
    try { return ok(await work()); }
    catch (error) {
      // Keep driver error labels intact so withTransaction retries the full mutation.
      if (session) throw error;
      return failure(error);
    }
  };

  const repository: TripJourneyPort = {
    withTransaction: async (tripId, work) => {
      if (session) return work(repository);
      const transaction = database.client.startSession();
      try {
        const result = await transaction.withTransaction(async () => {
          const lock = await trips.updateOne({ _id: new MongoObjectId(tripId) }, { $inc: { destinationOrderRevision: 1 } }, { session: transaction });
          if (lock.matchedCount === 0) throw new TripNotFoundError();
          const result = await work(createMongoTripJourneyRepository(database, transaction));
          // Returning Result.err normally would commit the previous writes.
          if (!result.ok) throw result.error;
          return result;
        });
        return result ?? err(new UnknownError("Trip journey transaction returned no result."));
      } catch (error) { return failure(error); }
      finally { await transaction.endSession(); }
    },
    listDestinations: (tripId) => perform(async () => {
      const documents = await destinations.find({ tripId: new MongoObjectId(tripId) }, options).sort({ order: 1 }).toArray();
      return documents.map(toDestination);
    }),
    appendDestination: async (destination) => {
      if (!session) return repository.withTransaction(destination.tripId, (scoped) => scoped.appendDestination(destination));
      return perform(async () => {
        const tripId = new MongoObjectId(destination.tripId);
        const count = await destinations.countDocuments({ tripId }, options);
        const document: DestinationDocument = { _id: new MongoObjectId(destination.id), tripId, name: destination.name,
          order: count + 1, createdAt: destination.createdAt };
        await destinations.insertOne(document, options);
        return toDestination(document);
      });
    },
    findDestination: (tripId, destinationId) => perform(async () => {
      const document = await destinations.findOne({ _id: new MongoObjectId(destinationId), tripId: new MongoObjectId(tripId) }, options);
      return document === null ? undefined : toDestination(document);
    }),
    updateDestination: async (tripId, destinationId, update) => {
      if (!session) return repository.withTransaction(tripId, (scoped) => scoped.updateDestination(tripId, destinationId, update));
      return perform(async () => {
        const mongoTripId = new MongoObjectId(tripId);
        const documents = await destinations.find({ tripId: mongoTripId }, options).sort({ order: 1 }).toArray();
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
          await destinations.updateOne({ _id: item._id, tripId: mongoTripId }, { $set: { order: max + position + 1 } }, options);
        }
        for (const [position, item] of documents.entries()) {
          await destinations.updateOne({ _id: item._id, tripId: mongoTripId }, {
            $set: { order: position + 1, ...(item._id.equals(new MongoObjectId(destinationId)) && update.name !== undefined ? { name: update.name } : {}) },
          }, options);
        }
        return toDestination({ ...moved!, name: update.name ?? moved!.name, order: target });
      });
    },
    listTransports: (tripId, destinationId) => perform(async () => {
      const documents = await transports.find({ tripId: new MongoObjectId(tripId),
        ...(destinationId === undefined ? {} : { destinationId: new MongoObjectId(destinationId) }) }, options)
        .sort({ direction: 1, departureAt: 1 }).toArray();
      return documents.map(toTransport);
    }),
    findTransport: (tripId, destinationId, transportId) => perform(async () => {
      const document = await transports.findOne({ _id: new MongoObjectId(transportId), tripId: new MongoObjectId(tripId),
        destinationId: new MongoObjectId(destinationId) }, options);
      return document === null ? undefined : toTransport(document);
    }),
    insertTransport: async (transport) => {
      if (!session) return repository.withTransaction(transport.tripId, (scoped) => scoped.insertTransport(transport));
      return perform(async () => {
        const match = await destinations.findOne({ _id: new MongoObjectId(transport.destinationId), tripId: new MongoObjectId(transport.tripId) }, options);
        if (match === null) return undefined;
        await transports.insertOne(transportDocument(transport), options);
        return transport;
      });
    },
    replaceTransport: async (transport) => {
      if (!session) return repository.withTransaction(transport.tripId, (scoped) => scoped.replaceTransport(transport));
      return perform(async () => {
        const { _id, ...document } = transportDocument(transport);
        const result = await transports.findOneAndUpdate(
          { _id, tripId: document.tripId, destinationId: document.destinationId }, { $set: document }, { ...options, returnDocument: "after" },
        );
        return result === null ? undefined : toTransport(result);
      });
    },
    listItineraryDays: (tripId) => perform(async () => {
      const documents = await itineraryDays.find({ tripId: new MongoObjectId(tripId) }, options).sort({ order: 1 }).toArray();
      return documents.map(({ _id, ...day }) => ({ ...day, id: domainId(_id), tripId: domainId(day.tripId), destinationId: domainId(day.destinationId) }));
    }),
    listItineraryReferences: (tripId) => perform(async () => {
      const query = { tripId: new MongoObjectId(tripId) };
      const activities = await database.collection<{ dayId: MongoObjectId; scheduledAt: Date }>("activities")
        .find(query, { ...options, projection: { dayId: 1, scheduledAt: 1 } }).toArray();
      const posts = await database.collection<{ dayId: MongoObjectId }>("posts")
        .find(query, { ...options, projection: { dayId: 1 } }).toArray();
      return { activities: activities.map((item) => ({ dayId: domainId(item.dayId), scheduledAt: item.scheduledAt })),
        posts: posts.map((item) => ({ dayId: domainId(item.dayId) })) };
    }),
    replaceItineraryDays: async (tripId, days) => {
      if (!session) return repository.withTransaction(tripId, (scoped) => scoped.replaceItineraryDays(tripId, days));
      return perform(async () => {
        const mongoTripId = new MongoObjectId(tripId);
        const ids = days.map((day) => new MongoObjectId(day.id));
        if (days.length > 0) {
          await itineraryDays.bulkWrite(days.map((day) => ({ updateOne: {
            filter: { _id: new MongoObjectId(day.id), tripId: mongoTripId },
            update: { $set: { tripId: mongoTripId, destinationId: new MongoObjectId(day.destinationId), date: day.date,
              type: day.type, startsAt: day.startsAt, endsAt: day.endsAt, order: day.order } }, upsert: true,
          } })), options);
        }
        await itineraryDays.deleteMany({ tripId: mongoTripId, _id: { $nin: ids } }, options);
      });
    },
  };
  return repository;
};
