import type { HttpClient } from "../api/index.js";
import { interactionFailure, isId, isRecord, serverFailure } from "./api-failure.js";
import { expenseCurrencies, type ExpenseCurrency } from "./expense-draft.js";
import type { TripResult } from "./trip-management-api.js";

/** The seven reasons the server gives for leaving an expense out of the balance. Anything else is a contract failure: no text is invented. */
export const balanceReasons = ["missing_currency", "missing_payments", "missing_shares", "payments_not_covering_total", "shares_not_covering_total", "no_remainder_participant", "invalid_rules"] as const;
export type BalanceReason = (typeof balanceReasons)[number];
export type BalanceEntry = { userId: string; paidCents: number; shareCents: number; netCents: number; formerMember: boolean };
export type Settlement = { fromUserId: string; toUserId: string; cents: number };
export type CurrencyBalance = { currency: ExpenseCurrency; expenseCount: number; balances: BalanceEntry[]; settlements: Settlement[] };
export type ExcludedExpense = { expenseId: string; postId: string; currency: ExpenseCurrency | null; totalCents: number | null; reasons: BalanceReason[]; formerMemberIds: string[] };
export type TripBalance = { tripId: string; expenseMode: "register" | "balance"; currencies: CurrencyBalance[]; excludedExpenses: ExcludedExpense[]; includedExpenseCount: number };
export type TripBalanceApi = { get: (tripId: string) => Promise<TripResult<TripBalance>> };

const cents = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value);
const nonNegative = (value: unknown): value is number => cents(value) && value >= 0;
const currencyOf = (value: unknown): value is ExpenseCurrency => expenseCurrencies.includes(value as ExpenseCurrency);

const parseEntry = (value: unknown): BalanceEntry | undefined => isRecord(value) && isId(value.userId) && nonNegative(value.paidCents) && nonNegative(value.shareCents) &&
  cents(value.netCents) && value.netCents === value.paidCents - value.shareCents && typeof value.formerMember === "boolean"
  ? { userId: value.userId, paidCents: value.paidCents, shareCents: value.shareCents, netCents: value.netCents, formerMember: value.formerMember } : undefined;
const parseSettlement = (value: unknown): Settlement | undefined => isRecord(value) && isId(value.fromUserId) && isId(value.toUserId) && value.fromUserId !== value.toUserId &&
  cents(value.cents) && value.cents > 0 ? { fromUserId: value.fromUserId, toUserId: value.toUserId, cents: value.cents } : undefined;

const parseCurrency = (value: unknown): CurrencyBalance | undefined => {
  if (!isRecord(value) || !currencyOf(value.currency) || !nonNegative(value.expenseCount) || !Array.isArray(value.balances) || !Array.isArray(value.settlements)) return undefined;
  const balances = value.balances.map(parseEntry), settlements = value.settlements.map(parseSettlement);
  if (balances.some((entry) => !entry) || settlements.some((entry) => !entry)) return undefined;
  const checkedBalances = balances as BalanceEntry[], checkedSettlements = settlements as Settlement[];
  const ids = new Set(checkedBalances.map((entry) => entry.userId));
  // Integrity only: the figures are the server's and are neither recalculated nor reordered.
  if (ids.size !== checkedBalances.length || checkedBalances.reduce((sum, entry) => sum + entry.netCents, 0) !== 0 ||
    checkedSettlements.some(({ fromUserId, toUserId }) => !ids.has(fromUserId) || !ids.has(toUserId))) return undefined;
  return { currency: value.currency, expenseCount: value.expenseCount, balances: checkedBalances, settlements: checkedSettlements };
};

const parseExcluded = (value: unknown): ExcludedExpense | undefined => {
  if (!isRecord(value) || !isId(value.expenseId) || !isId(value.postId) || !(value.currency === null || currencyOf(value.currency)) ||
    !(value.totalCents === null || nonNegative(value.totalCents)) || !Array.isArray(value.reasons) || value.reasons.length === 0 ||
    !value.reasons.every((reason) => balanceReasons.includes(reason as BalanceReason)) || new Set(value.reasons).size !== value.reasons.length ||
    !Array.isArray(value.formerMemberIds) || !value.formerMemberIds.every(isId)) return undefined;
  return { expenseId: value.expenseId, postId: value.postId, currency: value.currency, totalCents: value.totalCents,
    reasons: [...value.reasons] as BalanceReason[], formerMemberIds: [...value.formerMemberIds] as string[] };
};

const parseBalance = (value: unknown, tripId: string): TripBalance | undefined => {
  if (!isRecord(value) || typeof value.tripId !== "string" || value.tripId.toLowerCase() !== tripId.toLowerCase() || (value.expenseMode !== "register" && value.expenseMode !== "balance") || !nonNegative(value.includedExpenseCount) ||
    !Array.isArray(value.currencies) || !Array.isArray(value.excludedExpenses)) return undefined;
  if (value.expenseMode === "register" && (value.currencies.length > 0 || value.excludedExpenses.length > 0 || value.includedExpenseCount !== 0)) return undefined;
  const currencies = value.currencies.map(parseCurrency), excludedExpenses = value.excludedExpenses.map(parseExcluded);
  if (currencies.some((entry) => !entry) || excludedExpenses.some((entry) => !entry)) return undefined;
  const checked = currencies as CurrencyBalance[];
  // Strictly increasing in the ARS, EUR, USD order: no repeats and no reordering by the client.
  const order = checked.map(({ currency }) => expenseCurrencies.indexOf(currency));
  if (order.some((index, position) => position > 0 && index <= order[position - 1])) return undefined;
  return { tripId: value.tripId, expenseMode: value.expenseMode, currencies: checked, excludedExpenses: excludedExpenses as ExcludedExpense[], includedExpenseCount: value.includedExpenseCount };
};

export const createTripBalanceApi = (client: Pick<HttpClient, "get">): TripBalanceApi => ({
  get: async (tripId) => {
    const result = await client.get<unknown>(`/trips/${encodeURIComponent(tripId)}/balance`);
    if (!result.ok) return interactionFailure(result.error);
    const balance = isRecord(result.value) ? parseBalance(result.value.balance, tripId) : undefined;
    return balance ? { ok: true, value: balance } : serverFailure;
  },
});
