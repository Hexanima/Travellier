import { MongoServerError, ObjectId as MongoObjectId, type ClientSession, type Collection } from "mongodb";
import { adaptLegacyPaidBy, createCurrency, createObjectId, err, ExpenseConflictError, hasLegacyPaymentsGap, ok, TripNotFoundError, UnknownError,
  type AsyncResult, type ExpensePayment, type ExpenseShare, type ObjectId, type PostExpense, type PostExpenseField } from "app-domain";

interface StoredRow { userId: MongoObjectId; unit: string; value: number | null }
/**
 * `postExpenses` record (1:1 by `postId`). Legacy records lack `currency`/`breakdown`/`payments`/`shares` and carry `paidBy`; when
 * `payments` is missing (or null) it reads as the legacy payer at 100 percent (see `adaptLegacyPaidBy`), without writing.
 * A present `payments` list, even an empty one, is the truth. `paidBy` is never written or removed here.
 */
export interface PostExpenseDocument {
  _id: MongoObjectId; postId: MongoObjectId; tripId: MongoObjectId; totalAmount: number;
  currency?: string | null; breakdown?: string | null; paidBy?: MongoObjectId | null;
  payments?: StoredRow[] | null; shares?: StoredRow[] | null; createdAt: Date;
}
const domainId = (value: MongoObjectId): ObjectId => {
  const parsed = createObjectId(value.toHexString());
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};
const readRows = <T extends { userId: ObjectId }>(rows: unknown): T[] => Array.isArray(rows)
  ? rows.filter((row): row is StoredRow => row?.userId instanceof MongoObjectId)
    .map((row) => ({ userId: domainId(row.userId), unit: row.unit, value: row.value ?? null }) as unknown as T)
  : [];
const writeRows = (rows: readonly { userId: ObjectId; unit: string; value: number | null }[]): StoredRow[] =>
  rows.map((row) => ({ userId: new MongoObjectId(row.userId), unit: row.unit, value: row.value }));
/** A missing or unknown stored currency reads as null: it is never inferred. */
export const toPostExpense = (value: PostExpenseDocument): PostExpense => {
  const currency = createCurrency(value.currency);
  const paidBy = value.paidBy instanceof MongoObjectId ? value.paidBy.toHexString() : undefined;
  const payments = hasLegacyPaymentsGap(value.payments) ? adaptLegacyPaidBy(paidBy)
    : readRows<ExpensePayment>(value.payments).map(({ userId, unit, value: amount }) => ({ userId, unit, value: amount as number }));
  return { id: domainId(value._id), tripId: domainId(value.tripId), postId: domainId(value.postId), totalAmount: value.totalAmount,
    currency: currency.ok ? currency.value : null, breakdown: value.breakdown ?? null, payments, shares: readRows<ExpenseShare>(value.shares),
    createdAt: value.createdAt };
};

/** Expense reads/writes of a Trip scope; always pass the transaction session (every write joins the same transaction). */
export const createPostExpenseStore = (records: Collection<PostExpenseDocument>, tripId: ObjectId, session: ClientSession) => {
  const mongoTripId = new MongoObjectId(tripId), options = { session };
  return {
    findExpense: async (postId: ObjectId): AsyncResult<PostExpense | undefined> => {
      const found = await records.findOne({ postId: new MongoObjectId(postId), tripId: mongoTripId }, options);
      return ok(found === null ? undefined : toPostExpense(found));
    },
    /** Always writes `payments` and `shares` (empty by default): an explicit empty list is never re-adapted from a legacy `paidBy`. */
    insertExpense: async (expense: PostExpense): AsyncResult<void> => {
      if (expense.tripId !== tripId) throw new TripNotFoundError();
      if (expense.currency === null) return err(new UnknownError("A new expense needs a currency."));
      try {
        await records.insertOne({ _id: new MongoObjectId(expense.id), postId: new MongoObjectId(expense.postId), tripId: mongoTripId,
          totalAmount: expense.totalAmount, currency: expense.currency, breakdown: expense.breakdown,
          payments: writeRows(expense.payments), shares: writeRows(expense.shares), createdAt: expense.createdAt }, options);
      } catch (error) {
        if (error instanceof MongoServerError && error.code === 11000) return err(new ExpenseConflictError());
        throw error;
      }
      return ok(undefined);
    },
    /** `$set` of only the listed fields, never a replacement: `paidBy`, `createdAt` and the lists not listed stay untouched. */
    updateExpenseFields: async (expense: PostExpense, fields: readonly PostExpenseField[]): AsyncResult<void> => {
      if (expense.tripId !== tripId) throw new TripNotFoundError();
      if (fields.length === 0) return ok(undefined);
      const changes = Object.fromEntries(fields.map((field) => [field, field === "payments" || field === "shares" ? writeRows(expense[field]) : expense[field]]));
      const result = await records.updateOne({ postId: new MongoObjectId(expense.postId), tripId: mongoTripId }, { $set: changes }, options);
      return result.matchedCount === 1 ? ok(undefined) : err(new UnknownError("The expense to update was not found."));
    },
  };
};
