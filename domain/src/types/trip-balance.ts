import type { ExpenseIncompleteReason } from "../entities/expense.js";
import type { PostExpense } from "../entities/post-expense.js";
import type { Currency } from "../value-objects/money.js";
import type { ObjectId } from "../value-objects/object-id.js";

/** One consistent read for the balance: the Trip, its current members and the expenses of posts that exist in the Trip. */
export interface TripBalanceSnapshot {
  trip: { id: ObjectId; expenseMode: "register" | "balance" };
  memberIds: ObjectId[];
  expenses: PostExpense[];
}

/** `netCents` > 0: the user is owed that amount; < 0: the user owes it. Identities that are no longer members carry `formerMember`. */
export interface CurrencyBalanceEntry { userId: ObjectId; paidCents: number; shareCents: number; netCents: number; formerMember: boolean }
export interface BalanceSettlement { fromUserId: ObjectId; toUserId: ObjectId; cents: number }
export interface CurrencyBalance {
  currency: Currency;
  expenseCount: number;
  balances: CurrencyBalanceEntry[];
  settlements: BalanceSettlement[];
}
/** An expense left out of the balance. `totalCents`/`currency` are informational only: no debt is derived from it. */
export interface ExcludedExpense {
  expenseId: ObjectId;
  postId: ObjectId;
  currency: Currency | null;
  totalCents: number | null;
  reasons: ExpenseIncompleteReason[];
  formerMemberIds: ObjectId[];
}
export interface TripBalance {
  tripId: ObjectId;
  expenseMode: "register" | "balance";
  currencies: CurrencyBalance[];
  excludedExpenses: ExcludedExpense[];
  includedExpenseCount: number;
}
