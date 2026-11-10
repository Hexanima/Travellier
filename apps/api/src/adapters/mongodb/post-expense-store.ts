import { MongoServerError, ObjectId as MongoObjectId, type ClientSession, type Collection } from "mongodb";
import { createCurrency, createObjectId, err, ExpenseConflictError, ok, TripNotFoundError, UnknownError,
  type AsyncResult, type ObjectId, type PostExpense, type PostExpenseField } from "app-domain";

/**
 * `postExpenses` record (1:1 by `postId`). Legacy records lack `currency`/`breakdown` and carry `paidBy`; `payments` and `shares`
 * belong to T80: this store never reads or writes them, so they survive every T79 update.
 */
export interface PostExpenseDocument {
  _id: MongoObjectId; postId: MongoObjectId; tripId: MongoObjectId; totalAmount: number;
  currency?: string | null; breakdown?: string | null; createdAt: Date;
}
const domainId = (value: MongoObjectId): ObjectId => {
  const parsed = createObjectId(value.toHexString());
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};
/** A missing or unknown stored currency reads as null: it is never inferred. */
export const toPostExpense = (value: PostExpenseDocument): PostExpense => {
  const currency = createCurrency(value.currency);
  return { id: domainId(value._id), tripId: domainId(value.tripId), postId: domainId(value.postId), totalAmount: value.totalAmount,
    currency: currency.ok ? currency.value : null, breakdown: value.breakdown ?? null, createdAt: value.createdAt };
};

/** Expense reads/writes of a Trip scope; always pass the transaction session. */
export const createPostExpenseStore = (records: Collection<PostExpenseDocument>, tripId: ObjectId, session: ClientSession) => {
  const mongoTripId = new MongoObjectId(tripId), options = { session };
  return {
    findExpense: async (postId: ObjectId): AsyncResult<PostExpense | undefined> => {
      const found = await records.findOne({ postId: new MongoObjectId(postId), tripId: mongoTripId }, options);
      return ok(found === null ? undefined : toPostExpense(found));
    },
    insertExpense: async (expense: PostExpense): AsyncResult<void> => {
      if (expense.tripId !== tripId) throw new TripNotFoundError();
      if (expense.currency === null) return err(new UnknownError("A new expense needs a currency."));
      try {
        await records.insertOne({ _id: new MongoObjectId(expense.id), postId: new MongoObjectId(expense.postId), tripId: mongoTripId,
          totalAmount: expense.totalAmount, currency: expense.currency, breakdown: expense.breakdown, createdAt: expense.createdAt }, options);
      } catch (error) {
        if (error instanceof MongoServerError && error.code === 11000) return err(new ExpenseConflictError());
        throw error;
      }
      return ok(undefined);
    },
    /** `$set` of only the listed fields, never a replacement: `paidBy`, `payments`, `shares` and `createdAt` stay untouched. */
    updateExpenseFields: async (expense: PostExpense, fields: readonly PostExpenseField[]): AsyncResult<void> => {
      if (expense.tripId !== tripId) throw new TripNotFoundError();
      if (fields.length === 0) return ok(undefined);
      const changes = Object.fromEntries(fields.map((field) => [field, expense[field]]));
      const result = await records.updateOne({ postId: new MongoObjectId(expense.postId), tripId: mongoTripId }, { $set: changes }, options);
      return result.matchedCount === 1 ? ok(undefined) : err(new UnknownError("The expense to update was not found."));
    },
  };
};
