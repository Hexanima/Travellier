import { ObjectId as MongoObjectId, type Db } from "mongodb";
import {
  createObjectId, err, ok, UnknownError,
  type ItineraryActivity, type ItineraryDay, type ItineraryExpense, type ItineraryPost, type ObjectId,
  type Transport, type TripDestination, type TripItineraryQueryPort, type TripItinerarySnapshot,
} from "app-domain";

type Stored<T extends { id: ObjectId }> = T extends { id: ObjectId } ? {
  [K in keyof Omit<T, "id">]: T[K] extends ObjectId ? MongoObjectId : T[K] extends ObjectId | null ? MongoObjectId | null : T[K];
} & { _id: MongoObjectId } : never;
const id = (value: MongoObjectId): ObjectId => {
  const result = createObjectId(value.toHexString());
  if (!result.ok) throw result.error;
  return result.value;
};
const optionalId = (value: MongoObjectId | null | undefined) => value == null ? null : id(value);

/** Independent of the mutation repository: a GET never acquires a Trip write lock. */
export const createMongoTripItineraryQueryRepository = (database: Db): TripItineraryQueryPort => ({
  read: async (tripId) => {
    const session = database.client.startSession();
    try {
      const snapshot = await session.withTransaction<TripItinerarySnapshot | undefined>(async () => {
        const query = { tripId: new MongoObjectId(tripId) }, options = { session };
        const trip = await database.collection<{ _id: MongoObjectId; expenseMode: "register" | "balance"; votingEnabled: boolean }>("trips")
          .findOne({ _id: query.tripId }, { ...options, projection: { expenseMode: 1, votingEnabled: 1 } });
        if (trip === null) return undefined;
        // Driver sessions do not support concurrent operations in a transaction.
        const destinations = await database.collection<Stored<TripDestination>>("destinations").find(query, options).sort({ order: 1, _id: 1 }).toArray();
        const days = await database.collection<Stored<ItineraryDay>>("itineraryDays").find(query, options).sort({ order: 1, _id: 1 }).toArray();
        const transports = await database.collection<Stored<Transport>>("transports").find(query, options).sort({ departureAt: 1, _id: 1 }).toArray();
        const activities = await database.collection<Stored<ItineraryActivity>>("activities").find(query, options).sort({ scheduledAt: 1, _id: 1 }).toArray();
        const posts = await database.collection<Stored<ItineraryPost>>("posts").find(query, options).sort({ createdAt: 1, _id: 1 }).toArray();
        const expenses = posts.length === 0 ? [] : await database.collection<Stored<ItineraryExpense>>("postExpenses")
          .find({ ...query, postId: { $in: posts.map((post) => post._id) } }, options).toArray();

        return {
          trip: { id: id(trip._id), expenseMode: trip.expenseMode, votingEnabled: trip.votingEnabled },
          destinations: destinations.map((value) => ({ id: id(value._id), tripId: id(value.tripId), name: value.name, order: value.order, createdAt: value.createdAt })),
          days: days.map((value) => ({ id: id(value._id), tripId: id(value.tripId), destinationId: id(value.destinationId), date: value.date,
            type: value.type, startsAt: value.startsAt, endsAt: value.endsAt, order: value.order })),
          transports: transports.map((value) => ({ id: id(value._id), tripId: id(value.tripId), destinationId: id(value.destinationId),
            direction: value.direction, type: value.type, departurePlace: value.departurePlace, departureAt: value.departureAt,
            arrivalPlace: value.arrivalPlace, arrivalAt: value.arrivalAt, costPerPerson: value.costPerPerson, details: value.details }) as Transport),
          activities: activities.map((value) => ({ id: id(value._id), tripId: id(value.tripId), dayId: id(value.dayId), title: value.title,
            description: value.description, scheduledAt: value.scheduledAt, mapsUrl: value.mapsUrl, status: value.status,
            createdBy: id(value.createdBy), createdAt: value.createdAt })),
          posts: posts.map((value) => ({ id: id(value._id), tripId: id(value.tripId), dayId: id(value.dayId), authorId: id(value.authorId),
            description: value.description, mapsUrl: value.mapsUrl, activityId: optionalId(value.activityId), parentPostId: optionalId(value.parentPostId),
            transportId: optionalId(value.transportId), createdAt: value.createdAt })),
          expenses: expenses.map((value) => ({ id: id(value._id), tripId: id(value.tripId), postId: id(value.postId), totalAmount: value.totalAmount,
            breakdown: value.breakdown, paidBy: optionalId(value.paidBy), createdAt: value.createdAt })),
        };
      }, { readConcern: { level: "snapshot" }, readPreference: "primary" });
      return ok(snapshot);
    } catch {
      return err(new UnknownError("Trip itinerary database operation failed."));
    } finally { await session.endSession(); }
  },
});
