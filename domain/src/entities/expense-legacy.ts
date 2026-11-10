import { createObjectId } from "../value-objects/object-id.js";
import type { ExpensePayment } from "./expense.js";

/**
 * Adaptation of the legacy single payer (`paidBy`) to the payments model: a valid id becomes one payment of 100 percent by
 * that person; null, absent or invalid yields no payment. It never checks membership (a former member stays as historic
 * identity) and never touches currency, shares or total. Reads and the 0006 migration apply this same rule.
 */
export const adaptLegacyPaidBy = (paidBy: unknown): ExpensePayment[] => {
  const identity = typeof paidBy === "string" ? createObjectId(paidBy) : undefined;
  return identity?.ok ? [{ userId: identity.value, unit: "percent", value: 100 }] : [];
};

/**
 * Only a missing (or null) `payments` field is a legacy gap that `adaptLegacyPaidBy` may fill. A present list, even an empty one
 * the client cleared on purpose, is the truth and is never re-adapted (that would duplicate or resurrect the payment).
 */
export const hasLegacyPaymentsGap = (payments: unknown): boolean => payments === undefined || payments === null;
