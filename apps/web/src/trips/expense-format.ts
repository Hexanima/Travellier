import { toCents } from "app-domain";
import { expenseCurrencies, type ExpenseCurrency } from "./expense-draft.js";

export type CurrencyTotal = { currency: ExpenseCurrency; totalCents: number; expenseCount: number };
/** Totals kept apart by currency: amounts without a (representable) currency are counted, never summed. */
export type ExpenseTotals = { byCurrency: CurrencyTotal[]; withoutCurrency: { expenseCount: number };
  /** A currency but an amount that cannot be represented (legacy negative or unsafe): counted, never summed. */ invalidAmount: { expenseCount: number }; expenseCount: number };
type WithExpense = { expense: { totalAmount: number; currency: ExpenseCurrency | null } | null };

const plain = (cents: number): string => `${String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${String(cents % 100).padStart(2, "0")}`;
/** The amount alone, for a currency that was never indicated. */
export const formatPlainCents = plain;
/** Integer arithmetic only: the currency code goes first and the decimals are a comma (es-AR), independent of the device ICU data. */
export const formatCents = (cents: number, currency: ExpenseCurrency): string => `${currency} ${plain(cents)}`;

/** An amount with its currency, or flagged when the currency is missing (never assumed). */
export const formatExpenseAmount = (expense: { totalAmount: number; currency: ExpenseCurrency | null }): string => {
  const cents = toCents(expense.totalAmount);
  if (!cents.ok) return expense.currency === null ? `${expense.totalAmount} (moneda sin indicar)` : `importe no válido (${expense.currency})`;
  return expense.currency === null ? `${plain(cents.value)} (moneda sin indicar)` : formatCents(cents.value, expense.currency);
};

export const totalsOf = (posts: readonly WithExpense[]): ExpenseTotals => {
  const byCurrency = new Map<ExpenseCurrency, CurrencyTotal>();
  let without = 0, invalid = 0, count = 0;
  for (const { expense } of posts) {
    if (expense === null) continue;
    count += 1;
    const cents = toCents(expense.totalAmount);
    if (expense.currency === null) { without += 1; continue; }
    if (!cents.ok) { invalid += 1; continue; }
    const entry = byCurrency.get(expense.currency) ?? { currency: expense.currency, totalCents: 0, expenseCount: 0 };
    entry.totalCents += cents.value; entry.expenseCount += 1;
    byCurrency.set(expense.currency, entry);
  }
  return { byCurrency: expenseCurrencies.flatMap((currency) => byCurrency.get(currency) ?? []), withoutCurrency: { expenseCount: without }, invalidAmount: { expenseCount: invalid }, expenseCount: count };
};

/** Local calendar day (`YYYY-MM-DD`) of an instant in the given zone, to compare dates the way the person sees them. */
export const localDayKey = (instant: string, timeZone: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instant));
export const formatLocalDate = (instant: string, timeZone: string): string =>
  new Intl.DateTimeFormat("es-AR", { timeZone, day: "numeric", month: "short", year: "numeric" }).format(new Date(instant));
