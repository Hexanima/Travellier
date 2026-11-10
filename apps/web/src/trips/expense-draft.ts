import { toCents } from "app-domain";
import type { ExpenseInput } from "./trip-post-api.js";

export type ExpenseCurrency = "ARS" | "EUR" | "USD";
export const expenseCurrencies: readonly ExpenseCurrency[] = ["ARS", "EUR", "USD"];
/** Form strings of the expense of a memory. In the draft, `null` means «no expense» when creating and «untouched» when editing. */
export type ExpenseDraft = { amount: string; currency: "" | ExpenseCurrency; breakdown: string };
/** The expense already stored for the post, as read from the itinerary (the currency can be missing in legacy data). */
export type SavedExpense = { totalAmount: number; currency: ExpenseCurrency | null; breakdown: string | null };
export type AmountError = "required" | "invalid" | "precision";
export type ParsedAmount = { ok: true; cents: number; amount: number } | { ok: false; code: AmountError };
export type ExpenseErrors = { amount?: AmountError; currency?: "required" };
export type ValidExpense = { totalAmount: number; currency: ExpenseCurrency; breakdown: string | null };

/**
 * Parses a typed amount without floating point: up to two decimals with `,` or `.`; thousand separators are not accepted.
 * More than two decimals is a `precision` error (nothing is rounded for the person); zero, negatives and non-numbers are `invalid`.
 */
export const parseAmount = (raw: string): ParsedAmount => {
  const text = raw.trim();
  if (text === "") return { ok: false, code: "required" };
  const match = /^(\d+)(?:[.,](\d*))?$/.exec(text);
  if (!match || (match[2] === "" && text.length > match[1]!.length)) return { ok: false, code: "invalid" };
  const fraction = match[2] ?? "";
  if (fraction.length > 2) return { ok: false, code: "precision" };
  // Exact cents from the text (never from a float), and the number that travels must give them back: otherwise it would silently be another amount.
  const exact = BigInt(match[1]!) * 100n + BigInt(fraction.padEnd(2, "0") || "0");
  if (exact <= 0n || exact > BigInt(Number.MAX_SAFE_INTEGER)) return { ok: false, code: "invalid" };
  const cents = Number(exact);
  const amount = Number(`${match[1]}.${fraction.padEnd(2, "0")}`);
  const converted = toCents(amount);
  if (!converted.ok || converted.value !== cents || amount !== cents / 100) return { ok: false, code: "invalid" };
  return { ok: true, cents, amount };
};

export const validateExpense = (draft: ExpenseDraft):
  { ok: true; value: ValidExpense; cents: number } | { ok: false; errors: ExpenseErrors } => {
  const amount = parseAmount(draft.amount);
  const errors: ExpenseErrors = {};
  if (!amount.ok) errors.amount = amount.code;
  if (draft.currency === "") errors.currency = "required";
  if (!amount.ok || draft.currency === "") return { ok: false, errors };
  const breakdown = draft.breakdown.trim();
  return { ok: true, cents: amount.cents, value: { totalAmount: amount.amount, currency: draft.currency, breakdown: breakdown === "" ? null : breakdown } };
};

export const sameExpense = (a: ExpenseDraft | null, b: ExpenseDraft | null): boolean => a === b ||
  (a !== null && b !== null && a.amount === b.amount && a.currency === b.currency && a.breakdown === b.breakdown);

/** Exact text of an amount for the form (no float noise); empty when it cannot be represented. */
export const expenseDraftFromSaved = (saved: SavedExpense): ExpenseDraft => {
  const cents = toCents(saved.totalAmount);
  const amount = !cents.ok ? "" : cents.value % 100 === 0 ? String(cents.value / 100)
    : `${Math.floor(cents.value / 100)},${String(cents.value % 100).padStart(2, "0")}`;
  return { amount, currency: saved.currency ?? "", breakdown: saved.breakdown ?? "" };
};

/**
 * Merge-patch of the expense: only the keys that change. Without a saved expense it is the whole creation (breakdown only when written).
 * Payments and shares never travel, so the server keeps them. The currency is always sent when the saved one is missing (legacy).
 * `{}` means there is nothing to send. An invalid draft sends nothing (the subform only commits valid ones).
 */
export const diffExpense = (draft: ExpenseDraft, saved?: SavedExpense): ExpenseInput => {
  const checked = validateExpense(draft);
  if (!checked.ok) return {};
  const { totalAmount, currency, breakdown } = checked.value;
  if (!saved) return { totalAmount, currency, ...(breakdown !== null ? { breakdown } : {}) };
  const savedCents = toCents(saved.totalAmount);
  const savedBreakdown = (saved.breakdown ?? "").trim();
  return { ...(!savedCents.ok || savedCents.value !== checked.cents ? { totalAmount } : {}),
    ...(saved.currency === null || saved.currency !== currency ? { currency } : {}),
    ...((breakdown ?? "") !== savedBreakdown ? { breakdown } : {}) };
};
