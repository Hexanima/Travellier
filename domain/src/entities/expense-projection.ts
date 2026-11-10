import { CURRENCIES, toCents } from "../value-objects/money.js";
import type { ObjectId } from "../value-objects/object-id.js";
import type { ItineraryExpense, ItineraryExpenseAttribution, ItineraryExpenseSummary } from "../types/trip-itinerary.js";

export interface ExpenseAttributionInput {
  expense: Pick<ItineraryExpense, "id" | "postId" | "totalAmount" | "currency">;
  post: { createdAt: Date };
  /** Root of the post's chain (the post itself when it has no valid chain). */
  rootPostId: ObjectId;
  /** Effective activity of the post's chain (own link first, else the root's), when it exists in the Trip. */
  activity: { id: ObjectId; dayId: ObjectId; scheduledAt: Date } | null;
  /** Publication slice of the post, null when it falls outside every slice. */
  publicationDayId: ObjectId | null;
}

/**
 * Pure attribution of one expense (PRD 3.6): to the effective root activity (its day and `scheduledAt`), else to the
 * post publication. It copies the UTC instants and never changes the post, the activity or the amounts.
 */
export const attributeExpense = ({ expense, post, rootPostId, activity, publicationDayId }: ExpenseAttributionInput): ItineraryExpenseAttribution => {
  const cents = toCents(expense.totalAmount);
  return {
    expenseId: expense.id, postId: expense.postId, rootPostId,
    source: activity === null ? "publication" : "activity", rootActivityId: activity?.id ?? null,
    occurredAt: new Date((activity?.scheduledAt ?? post.createdAt).getTime()), publishedAt: new Date(post.createdAt.getTime()),
    dayId: activity === null ? publicationDayId : activity.dayId, currency: expense.currency,
    amountCents: cents.ok ? cents.value : null,
  };
};

/**
 * Totals per currency in integer cents (no conversion, fixed order). Each attribution is one expense (1:1 with its post),
 * so a descendant's expense is never added to its parent's. Without a currency or a valid amount it counts but adds nothing.
 */
export const totalizeExpenses = (attributions: readonly ItineraryExpenseAttribution[]): ItineraryExpenseSummary => {
  const totals = new Map(CURRENCIES.map((currency) => [currency, { currency, totalCents: 0, expenseCount: 0 }]));
  let withoutCurrency = 0;
  for (const value of attributions) {
    const total = value.currency === null || value.amountCents === null ? undefined : totals.get(value.currency);
    if (total === undefined) { withoutCurrency++; continue; }
    total.totalCents += value.amountCents!;
    total.expenseCount++;
  }
  return { byCurrency: [...totals.values()].filter((total) => total.expenseCount > 0), withoutCurrency: { expenseCount: withoutCurrency },
    expenseCount: attributions.length };
};
