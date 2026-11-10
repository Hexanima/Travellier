import { ObjectId as MongoObjectId, type Db } from "mongodb";
import { createObjectId, err, ok, UnknownError, type ObjectId, type TripBalanceQueryPort, type TripBalanceSnapshot } from "app-domain";
import { toPostExpense, type PostExpenseDocument } from "./post-expense-store.js";

const id = (value: MongoObjectId): ObjectId => {
  const result = createObjectId(value.toHexString());
  if (!result.ok) throw result.error;
  return result.value;
};

/**
 * Independent of the mutation repositories: a GET never acquires a Trip write lock and never writes. Expenses whose post is not
 * a post of the Trip (orphans) are discarded: they cannot be attributed to the Trip, same rule as the itinerary projection.
 */
export const createMongoTripBalanceQueryRepository = (database: Db): TripBalanceQueryPort => ({
  read: async (tripId) => {
    const session = database.client.startSession();
    try {
      const snapshot = await session.withTransaction<TripBalanceSnapshot | undefined>(async () => {
        const mongoTripId = new MongoObjectId(tripId), options = { session };
        const trip = await database.collection<{ _id: MongoObjectId; expenseMode: "register" | "balance" }>("trips")
          .findOne({ _id: mongoTripId }, { ...options, projection: { expenseMode: 1 } });
        if (trip === null) return undefined;
        // Driver sessions do not support concurrent operations in a transaction.
        const members = await database.collection<{ tripId: MongoObjectId; userId: MongoObjectId }>("tripMembers")
          .find({ tripId: mongoTripId }, { ...options, projection: { userId: 1 } }).toArray();
        const posts = await database.collection<{ _id: MongoObjectId; tripId: MongoObjectId }>("posts")
          .find({ tripId: mongoTripId }, { ...options, projection: { _id: 1 } }).toArray();
        const expenses = posts.length === 0 ? [] : await database.collection<PostExpenseDocument>("postExpenses")
          .find({ tripId: mongoTripId, postId: { $in: posts.map((post) => post._id) } }, options).toArray();
        return { trip: { id: id(trip._id), expenseMode: trip.expenseMode === "balance" ? "balance" : "register" },
          memberIds: members.map((member) => id(member.userId)), expenses: expenses.map(toPostExpense) };
      }, { readConcern: { level: "snapshot" }, readPreference: "primary" });
      return ok(snapshot);
    } catch {
      return err(new UnknownError("Trip balance database operation failed."));
    } finally { await session.endSession(); }
  },
});
