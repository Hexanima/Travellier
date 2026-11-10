import { err, ok, type Result } from "../types/result.js";
import { ValidationError, type ValidationIssue } from "../errors/validation-error.js";
import { createCurrency, toCents, type Currency } from "../value-objects/money.js";
import type { ObjectId } from "../value-objects/object-id.js";
import { validateExpenseRules } from "./expense.js";

/**
 * Expense of a post (`postExpenses`, 1:1 by `postId`). `currency` is null only when reading a legacy record that
 * predates the field: it is never inferred. Payments and shares are not part of this record's T79 view.
 */
export interface PostExpense { id: ObjectId; tripId: ObjectId; postId: ObjectId; totalAmount: number; currency: Currency | null; breakdown: string | null; createdAt: Date }
/** Merge-patch over the scalar fields: an absent key is untouched; `breakdown: null` clears it. */
export interface PostExpenseInput { totalAmount?: number; currency?: Currency; breakdown?: string | null }
export type PostExpenseField = "totalAmount" | "currency" | "breakdown";
export interface PostExpensePlan { expense: PostExpense; mode: "insert" | "update"; changed: PostExpenseField[] }

const FIELDS: readonly PostExpenseField[] = ["totalAmount", "currency", "breakdown"];
const issue = (field: string, code: string, message: string): ValidationIssue => ({ field: `expense.${field}`, code, message });
/** Positive, safe and with at most 2 decimals (rounding a third decimal silently would store a different amount). */
const validTotal = (value: unknown) => {
  const rules = validateExpenseRules({ totalAmount: value });
  if (!rules.ok || typeof value !== "number") return false;
  const cents = toCents(value);
  return cents.ok && cents.value / 100 === value;
};

/** Checks the shape of the `expense` of a save; the merge with the stored expense is validated by `applyPostExpense`. */
export const parsePostExpenseInput = (raw: unknown): Result<PostExpenseInput, ValidationError> => {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length === 0) {
    return err(new ValidationError([{ field: "expense", code: "invalid", message: "Expense must be a non-empty object." }]));
  }
  const record = raw as Record<string, unknown>;
  const issues: ValidationIssue[] = [];
  const input: PostExpenseInput = {};
  for (const key of Object.keys(record)) {
    if (!(FIELDS as readonly string[]).includes(key)) issues.push(issue(key, "unsupported", `Expense ${key} is not supported.`));
  }
  if (record.totalAmount !== undefined) {
    if (validTotal(record.totalAmount)) input.totalAmount = record.totalAmount as number;
    else issues.push(issue("totalAmount", "invalid", "Expense totalAmount must be a positive decimal with at most 2 decimals."));
  }
  if (record.currency !== undefined) {
    const currency = createCurrency(record.currency);
    if (currency.ok) input.currency = currency.value;
    else issues.push(issue("currency", "invalid", "Expense currency must be ARS, EUR or USD."));
  }
  if (record.breakdown !== undefined) {
    if (record.breakdown === null || typeof record.breakdown === "string") input.breakdown = record.breakdown;
    else issues.push(issue("breakdown", "invalid", "Expense breakdown must be text or null."));
  }
  return issues.length > 0 ? err(new ValidationError(issues)) : ok(input);
};

/**
 * Merges the input into the stored expense (or builds a new one) and validates the result; never writes and never invents a
 * currency. An update keeps `id` and `createdAt`; `changed` lists the fields the input carried.
 */
export const applyPostExpense = (input: { existing: PostExpense | undefined; input: PostExpenseInput; tripId: ObjectId; postId: ObjectId;
  id: ObjectId; createdAt: Date }): Result<PostExpensePlan, ValidationError> => {
  const { existing, input: patch } = input;
  const totalAmount = patch.totalAmount ?? existing?.totalAmount;
  const currency = patch.currency ?? existing?.currency ?? undefined;
  const issues: ValidationIssue[] = [];
  if (totalAmount === undefined) issues.push(issue("totalAmount", "required", "Expense totalAmount is required."));
  if (currency === undefined) issues.push(issue("currency", "required", "Expense currency is required."));
  if (totalAmount !== undefined && currency !== undefined) {
    const rules = validateExpenseRules({ totalAmount, currency });
    if (!rules.ok) issues.push(...rules.error.issues.map((found) => issue(found.field, "invalid", found.message)));
    else if (!validTotal(totalAmount)) issues.push(issue("totalAmount", "invalid", "Expense totalAmount must have at most 2 decimals."));
  }
  if (issues.length > 0 || totalAmount === undefined || currency === undefined) return err(new ValidationError(issues));
  const breakdown = patch.breakdown === undefined ? existing?.breakdown ?? null
    : patch.breakdown === null || patch.breakdown.trim() === "" ? null : patch.breakdown;
  const expense: PostExpense = existing
    ? { ...existing, totalAmount, currency, breakdown }
    : { id: input.id, tripId: input.tripId, postId: input.postId, totalAmount, currency, breakdown, createdAt: input.createdAt };
  const changed = existing ? FIELDS.filter((field) => patch[field] !== undefined) : [...FIELDS];
  return ok({ expense, mode: existing ? "update" : "insert", changed });
};
