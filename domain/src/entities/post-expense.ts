import { err, ok, type Result } from "../types/result.js";
import { ValidationError, type ValidationIssue } from "../errors/validation-error.js";
import { checkWritableAmount, createCurrency, toCents, type Currency } from "../value-objects/money.js";
import { createObjectId, type ObjectId } from "../value-objects/object-id.js";
import { resolveExpense, validateExpenseRules, type ExpenseIncompleteReason, type ExpensePayment, type ExpenseShare } from "./expense.js";

/**
 * Expense of a post (`postExpenses`, 1:1 by `postId`). `currency` is null only when reading a legacy record that
 * predates the field: it is never inferred. `payments` and `shares` are what the client agreed and saved: the server never
 * proposes or invents a split or a payer (a proposed draft lives in the client until it is sent). A legacy `paidBy` reads
 * as one payment of 100 percent (see `adaptLegacyPaidBy`); `shares` stay empty until someone sends them.
 */
export interface PostExpense { id: ObjectId; tripId: ObjectId; postId: ObjectId; totalAmount: number; currency: Currency | null; breakdown: string | null;
  payments: ExpensePayment[]; shares: ExpenseShare[]; createdAt: Date }
/**
 * Merge-patch by key: an absent key is untouched; `breakdown: null` clears it; `payments`/`shares` replace the whole list
 * (an empty list clears it explicitly).
 */
export interface PostExpenseInput { totalAmount?: number; currency?: Currency; breakdown?: string | null; payments?: ExpensePayment[]; shares?: ExpenseShare[] }
export type PostExpenseField = "totalAmount" | "currency" | "breakdown" | "payments" | "shares";
export interface PostExpensePlan { expense: PostExpense; mode: "insert" | "update"; changed: PostExpenseField[] }
/**
 * The expense as answered after a save. `completeness` is derived on every answer and never persisted; `formerMemberIds` lists
 * the users of `payments`/`shares` that are not current members (former members, identified by absence from the member list),
 * apart from the rows so they can be resent as they came.
 */
export interface PostExpenseView extends PostExpense {
  completeness: { status: "complete" | "incomplete"; reasons: ExpenseIncompleteReason[] };
  formerMemberIds: ObjectId[];
}

/** Maximum breakdown length in Unicode code points, measured on the raw text. */
export const MAX_EXPENSE_BREAKDOWN_LENGTH = 2000;
const FIELDS: readonly PostExpenseField[] = ["totalAmount", "currency", "breakdown", "payments", "shares"];
const ROW_KEYS: Record<"payments" | "shares", readonly string[]> = { payments: ["userId", "unit", "value"], shares: ["userId", "unit", "value"] };
const MAX_AMOUNT_TEXT = "999999999999.99";
const issue = (field: string, code: string, message: string): ValidationIssue => ({ field: `expense.${field}`, code, message });
/** New input: positive, up to the PRD limit and with at most 2 decimals (rounding a third decimal silently would store a different amount). */
const validTotal = (value: unknown) => {
  const writable = checkWritableAmount(value, { positive: true });
  if (!writable.ok) return writable;
  return validateExpenseRules({ totalAmount: value }).ok ? writable : { ok: false as const, code: "invalid" as const };
};
/** Merged expense: positive, safe and with at most 2 decimals; the limit applies only to new input, so stored totals keep working. */
const storedTotalValid = (value: unknown) => {
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
    const total = validTotal(record.totalAmount);
    if (total.ok) input.totalAmount = record.totalAmount as number;
    else if (total.code === "exceeds_max") issues.push(issue("totalAmount", "exceeds_max", `Expense totalAmount must be at most ${MAX_AMOUNT_TEXT}.`));
    else issues.push(issue("totalAmount", "invalid", "Expense totalAmount must be a positive decimal with at most 2 decimals."));
  }
  if (record.currency !== undefined) {
    const currency = createCurrency(record.currency);
    if (currency.ok) input.currency = currency.value;
    else issues.push(issue("currency", "invalid", "Expense currency must be ARS, EUR or USD."));
  }
  if (record.breakdown !== undefined) {
    if (typeof record.breakdown === "string" && [...record.breakdown].length > MAX_EXPENSE_BREAKDOWN_LENGTH) {
      issues.push(issue("breakdown", "too_long", `Expense breakdown must have at most ${MAX_EXPENSE_BREAKDOWN_LENGTH} characters.`));
    } else if (record.breakdown === null || typeof record.breakdown === "string") input.breakdown = record.breakdown;
    else issues.push(issue("breakdown", "invalid", "Expense breakdown must be text or null."));
  }
  for (const name of ["payments", "shares"] as const) {
    const rows = record[name];
    if (rows === undefined) continue;
    // `null` is not "absent": the rules would skip it, so it is rejected here.
    if (!Array.isArray(rows)) {
      issues.push(issue(name, "invalid", `Expense ${name} must be a list.`));
      continue;
    }
    rows.forEach((row: unknown, index) => {
      if (row === null || typeof row !== "object" || Array.isArray(row)) return; // reported by the rules with the row path
      const { unit, value } = row as { unit?: unknown; value?: unknown };
      if (unit === "amount" && typeof value === "number" && value >= 0) { // negatives and non-finite values are reported by the rules
        const amount = checkWritableAmount(value, { positive: false });
        if (!amount.ok) {
          issues.push(issue(`${name}[${index}].value`, amount.code, amount.code === "exceeds_max"
            ? `Expense ${name}[${index}].value must be at most ${MAX_AMOUNT_TEXT}.` : `Expense ${name}[${index}].value must have at most 2 decimals.`));
        }
      }
      for (const key of Object.keys(row)) {
        if (!ROW_KEYS[name].includes(key)) issues.push(issue(`${name}[${index}].${key}`, "unsupported", `Expense ${name}[${index}].${key} is not supported.`));
      }
    });
    (input as Record<string, unknown>)[name] = rows;
  }
  return issues.length > 0 ? err(new ValidationError(issues)) : ok(input);
};

const rowUserIds = (rows: readonly { userId: ObjectId }[]) => rows.map((row) => row.userId);
const normalizedId = (value: unknown) => {
  const parsed = typeof value === "string" ? createObjectId(value) : undefined;
  return parsed?.ok ? parsed.value : undefined;
};

/**
 * Merges the input into the stored expense (or builds a new one) and validates the result; never writes and never invents a
 * currency, payer or split. An update keeps `id` and `createdAt`; `changed` lists the fields the input carried. Rules over the
 * merged rows run when the input carries `totalAmount`, `payments` or `shares`. `memberIds` are the current members among the users
 * referenced by the input or the stored expense (read in the same snapshot as the write): a NEW row (a user not already named
 * by the stored payments or shares) must be a current member; a user already stored is kept even after leaving the Trip.
 * An incomplete expense is valid; only invalid rules, an excess or a new non-member are rejected.
 */
export const applyPostExpense = (input: { existing: PostExpense | undefined; input: PostExpenseInput; tripId: ObjectId; postId: ObjectId;
  id: ObjectId; createdAt: Date; memberIds: readonly ObjectId[] }): Result<PostExpensePlan, ValidationError> => {
  const { existing, input: patch } = input;
  const totalAmount = patch.totalAmount ?? existing?.totalAmount;
  const currency = patch.currency ?? existing?.currency ?? undefined;
  const issues: ValidationIssue[] = [];
  if (totalAmount === undefined) issues.push(issue("totalAmount", "required", "Expense totalAmount is required."));
  if (currency === undefined) issues.push(issue("currency", "required", "Expense currency is required."));
  const revalidate = patch.totalAmount !== undefined || patch.payments !== undefined || patch.shares !== undefined;
  let payments = patch.payments === undefined ? existing?.payments ?? [] : patch.payments;
  let shares = patch.shares === undefined ? existing?.shares ?? [] : patch.shares;
  if (totalAmount !== undefined && currency !== undefined) {
    const rules = validateExpenseRules(revalidate ? { totalAmount, currency, payments, shares } : { totalAmount, currency });
    if (!rules.ok) {
      issues.push(...rules.error.issues.map((found) => /^(payments|shares)\b/.test(found.field) ? issue(found.field, found.code, found.message)
        : issue(found.field, "invalid", found.message)));
    } else {
      if (!storedTotalValid(totalAmount)) issues.push(issue("totalAmount", "invalid", "Expense totalAmount must have at most 2 decimals."));
      // Normalized rows (lowercase ids, null values) are what gets stored when the key travelled in this save.
      if (revalidate) {
        if (patch.payments !== undefined) payments = rules.value.payments ?? [];
        if (patch.shares !== undefined) shares = rules.value.shares ?? [];
      }
    }
  }
  const named = new Set<ObjectId>([...rowUserIds(existing?.payments ?? []), ...rowUserIds(existing?.shares ?? [])]);
  const members = new Set(input.memberIds);
  for (const name of ["payments", "shares"] as const) {
    (patch[name] ?? []).forEach((row: { userId: unknown }, index: number) => {
      const userId = normalizedId(row?.userId);
      if (userId !== undefined && !named.has(userId) && !members.has(userId)) {
        issues.push(issue(`${name}[${index}].userId`, "not_member", `Expense ${name}[${index}].userId must be a current member of the Trip.`));
      }
    });
  }
  if (issues.length > 0 || totalAmount === undefined || currency === undefined) return err(new ValidationError(issues));
  const breakdown = patch.breakdown === undefined ? existing?.breakdown ?? null
    : patch.breakdown === null || patch.breakdown.trim() === "" ? null : patch.breakdown;
  const expense: PostExpense = existing
    ? { ...existing, totalAmount, currency, breakdown, payments, shares }
    : { id: input.id, tripId: input.tripId, postId: input.postId, totalAmount, currency, breakdown, payments, shares, createdAt: input.createdAt };
  const changed = existing ? FIELDS.filter((field) => patch[field] !== undefined) : [...FIELDS];
  return ok({ expense, mode: existing ? "update" : "insert", changed });
};

/**
 * Adds the derived `completeness` (what is missing to enter a balance; centavos are not exposed) and `formerMemberIds` to the
 * expense; pure, so the same answer is recomputed from what is persisted every time.
 */
export const describePostExpense = (expense: PostExpense, memberIds: readonly ObjectId[]): PostExpenseView => {
  const resolution = resolveExpense({ totalAmount: expense.totalAmount, ...(expense.currency === null ? {} : { currency: expense.currency }),
    payments: expense.payments, shares: expense.shares });
  const members = new Set(memberIds);
  const referenced = [...rowUserIds(expense.payments), ...rowUserIds(expense.shares)];
  return { ...expense,
    completeness: { status: resolution.status, reasons: resolution.status === "complete" ? [] : resolution.reasons },
    formerMemberIds: [...new Set(referenced.filter((userId) => !members.has(userId)))] };
};
