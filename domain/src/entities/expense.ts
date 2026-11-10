import { err, ok, type Result } from "../types/result.js";
import { ValidationError, type ValidationIssue } from "../errors/validation-error.js";
import { addDecimals, decimalCents, decimalFraction, roundDecimal, withinTolerance, type DecimalFraction } from "../value-objects/decimal-math.js";
import { createCurrency, toCents, type Currency } from "../value-objects/money.js";
import { createObjectId, type ObjectId } from "../value-objects/object-id.js";

export type ExpensePayment = { userId: ObjectId; unit: "amount" | "percent"; value: number };
export type ExpenseShare = { userId: ObjectId; unit: "amount" | "percent" | "remainder" | "excluded"; value: number | null };
export type ExpenseRules = { totalAmount: number; currency?: Currency; payments?: ExpensePayment[]; shares?: ExpenseShare[] };

export type ExpenseIncompleteReason =
  | "missing_currency"
  | "missing_payments"
  | "missing_shares"
  | "payments_not_covering_total"
  | "shares_not_covering_total"
  | "no_remainder_participant"
  | "invalid_rules";

export type ExpenseResolution =
  | { status: "complete"; currency: Currency; totalCents: number;
      payments: { userId: ObjectId; cents: number }[]; shares: { userId: ObjectId; cents: number }[] }
  | { status: "incomplete"; reasons: ExpenseIncompleteReason[]; totalCents?: number;
      payments?: { userId: ObjectId; cents: number }[]; shares?: { userId: ObjectId; cents: number }[] };

type RowsAnalysis = { kind: "empty" | "invalid" } | { kind: "ok"; hasRemainder: boolean; covered: boolean };

/**
 * Shared coverage criterion for payments and shares. `invalid` covers malformed rows and any excess
 * over the total; `covered` means fixed cents plus percentages cover the total exactly (the only case
 * that may absorb cent rounding residue). Used by both the resolver and the completeness diagnostic.
 */
export const analyzeExpenseRows = (rows: unknown, totalCents: number | undefined, shares: boolean): RowsAnalysis => {
  if (!Array.isArray(rows) || rows.length === 0) return { kind: rows === undefined || (Array.isArray(rows) && rows.length === 0) ? "empty" : "invalid" };
  const identities = new Set<string>();
  let amountCents = 0n;
  let roundedCoverage = 0n;
  let percent: DecimalFraction = { numerator: 0n, denominator: 1n };
  let hasRemainder = false;
  for (const row of rows) {
    if (row === null || typeof row !== "object" || typeof row.userId !== "string") return { kind: "invalid" };
    const identity = createObjectId(row.userId);
    if (!identity.ok || (shares && identities.has(identity.value))) return { kind: "invalid" };
    identities.add(identity.value);
    if (shares && (row.unit === "remainder" || row.unit === "excluded")) {
      if (row.value != null) return { kind: "invalid" };
      hasRemainder ||= row.unit === "remainder";
      continue;
    }
    if (typeof row.value !== "number" || !Number.isFinite(row.value) || row.value < 0) return { kind: "invalid" };
    if (row.unit === "amount") {
      const cents = decimalCents(row.value);
      if (cents === undefined) return { kind: "invalid" };
      amountCents += BigInt(cents);
      roundedCoverage += BigInt(cents);
    } else if (row.unit === "percent" && row.value <= 100) {
      percent = addDecimals(percent, decimalFraction(row.value));
      if (totalCents !== undefined) {
        const cents = roundDecimal(row.value, BigInt(totalCents), 100n);
        if (cents === undefined) return { kind: "invalid" };
        roundedCoverage += BigInt(cents);
      }
    } else return { kind: "invalid" };
  }
  const percentExcess = percent.numerator - 100n * percent.denominator;
  if (percentExcess > 0n && !withinTolerance(percentExcess, percent.denominator, Number.EPSILON * 100 * 8)) return { kind: "invalid" };
  if (totalCents === undefined) return { kind: "ok", hasRemainder, covered: false };
  // Validate coverage and rounded row totals without producing debts or changing agreements.
  // Require full coverage before rounding; only complete agreements may resolve cent residue.
  const total = BigInt(totalCents);
  if (amountCents > total) return { kind: "invalid" };
  const denominator = 100n * percent.denominator;
  const difference = (total - amountCents) * denominator - total * percent.numerator;
  // Fixed cents compare exactly. Fractional percentage noise is bounded below one whole cent.
  const tolerance = Math.min(0.25, Number.EPSILON * Math.max(1, totalCents) * 8);
  const covered = difference === 0n || (percent.numerator > 0n && withinTolerance(difference, denominator, tolerance));
  if (difference < 0n && !covered) return { kind: "invalid" };
  // A partial agreement cannot absorb rounded excess into a negative remainder.
  if (!covered && roundedCoverage > total) return { kind: "invalid" };
  return { kind: "ok", hasRemainder, covered };
};

const isPresent = (value: unknown) => value !== undefined && value !== null;

const validateRows = (name: "payments" | "shares", rows: unknown, issues: ValidationIssue[]) => {
  const issue = (field: string, code: string, message: string) => issues.push({ field, code, message });
  if (!isPresent(rows)) return undefined;
  if (!Array.isArray(rows)) {
    issue(name, "invalid_rows", `Expense ${name} must be a list.`);
    return undefined;
  }
  const isShares = name === "shares";
  const identities = new Set<string>();
  const normalized: { userId: ObjectId; unit: string; value: number | null }[] = [];
  let valid = true;
  rows.forEach((row: unknown, index) => {
    const at = `${name}[${index}]`;
    if (row === null || typeof row !== "object") {
      issue(at, "invalid_row", `Expense ${at} must be an object.`);
      valid = false;
      return;
    }
    const { userId, unit, value } = row as Record<string, unknown>;
    const identity = typeof userId === "string" ? createObjectId(userId) : undefined;
    let rowValid = true;
    if (identity === undefined || !identity.ok) {
      issue(`${at}.userId`, "invalid_user", `Expense ${at}.userId must be an ObjectId.`);
      rowValid = false;
    } else if (isShares) {
      if (identities.has(identity.value)) {
        issue(`${at}.userId`, "duplicate_user", `Expense ${at}.userId already has a share.`);
        rowValid = false;
      }
      identities.add(identity.value);
    }
    const unitAllowed = unit === "amount" || unit === "percent" || (isShares && (unit === "remainder" || unit === "excluded"));
    let normalizedValue: number | null = null;
    if (!unitAllowed) {
      issue(`${at}.unit`, "invalid_unit", `Expense ${at}.unit is not supported.`);
      rowValid = false;
    } else if (unit === "remainder" || unit === "excluded") {
      if (isPresent(value)) {
        issue(`${at}.value`, "unexpected_value", `Expense ${at}.value must be null for ${unit}.`);
        rowValid = false;
      }
    } else {
      const bounded = typeof value === "number" && Number.isFinite(value) && value >= 0
        && (unit === "amount" ? toCents(value).ok : value <= 100);
      if (!bounded) {
        issue(`${at}.value`, "invalid_value", `Expense ${at}.value is missing or out of range.`);
        rowValid = false;
      } else normalizedValue = value;
    }
    if (rowValid && identity?.ok) normalized.push({ userId: identity.value, unit: unit as string, value: normalizedValue });
    else valid = false;
  });
  return valid ? normalized : undefined;
};

export const validateExpenseRules = (input: unknown): Result<ExpenseRules, ValidationError> => {
  const issues: ValidationIssue[] = [];
  if (input === null || typeof input !== "object") {
    return err(new ValidationError([{ field: "expense", code: "invalid_expense", message: "Expense rules must be an object." }]));
  }
  const raw = input as Record<string, unknown>;
  const totalCents = typeof raw.totalAmount === "number" ? decimalCents(raw.totalAmount) : undefined;
  if (totalCents === undefined || totalCents <= 0) {
    issues.push({ field: "totalAmount", code: "invalid_total", message: "Expense totalAmount must be a positive, safe decimal." });
  }
  let currency: Currency | undefined;
  if (isPresent(raw.currency)) {
    const parsed = createCurrency(raw.currency);
    if (parsed.ok) currency = parsed.value;
    else issues.push(...parsed.error.issues);
  }
  const payments = validateRows("payments", raw.payments, issues);
  const shares = validateRows("shares", raw.shares, issues);
  const validTotal = totalCents !== undefined && totalCents > 0 ? totalCents : undefined;
  for (const [name, rows, source] of [["payments", payments, raw.payments], ["shares", shares, raw.shares]] as const) {
    if (rows === undefined || validTotal === undefined) continue;
    if (analyzeExpenseRows(source, validTotal, name === "shares").kind === "invalid") {
      issues.push({ field: name, code: "exceeds_total", message: `Expense ${name} exceed the total or their percentages.` });
    }
  }
  if (issues.length > 0) return err(new ValidationError(issues));
  const value: ExpenseRules = { totalAmount: raw.totalAmount as number };
  if (currency !== undefined) value.currency = currency;
  if (payments !== undefined) value.payments = payments as ExpensePayment[];
  if (shares !== undefined) value.shares = shares as ExpenseShare[];
  return ok(value);
};

type ResolvedRow = { userId: ObjectId; cents: number };

// Fixed rows use their cents; percent rows round half-up; when coverage is exact the residue goes to the
// last percent rows with a positive value (a positive delta all to the last, a negative one without going below 0).
const resolveCents = (rows: (ExpensePayment | ExpenseShare)[], totalCents: number, covered: boolean): number[] | undefined => {
  const cents = rows.map((row) => {
    if (row.unit === "amount") return decimalCents(row.value) ?? 0;
    if (row.unit === "percent") return roundDecimal(row.value, BigInt(totalCents), 100n) ?? 0;
    return 0;
  });
  if (!covered) return cents;
  let delta = BigInt(totalCents) - cents.reduce((sum, value) => sum + BigInt(value), 0n);
  for (let index = rows.length - 1; index >= 0 && delta !== 0n; index -= 1) {
    const row = rows[index];
    if (row.unit !== "percent" || !(row.value !== null && row.value > 0)) continue;
    if (delta > 0n) {
      cents[index] += Number(delta);
      delta = 0n;
    } else {
      const taken = Math.min(cents[index], Number(-delta));
      cents[index] -= taken;
      delta += BigInt(taken);
    }
  }
  return delta === 0n ? cents : undefined;
};

const pair = (rows: { userId: ObjectId }[], cents: number[]): ResolvedRow[] => rows.map((row, index) => ({ userId: row.userId, cents: cents[index] }));

const resolveShares = (shares: ExpenseShare[], totalCents: number, covered: boolean): number[] | undefined => {
  const cents = resolveCents(shares, totalCents, covered);
  if (cents === undefined) return undefined;
  const rest = BigInt(totalCents) - cents.reduce((sum, value) => sum + BigInt(value), 0n);
  if (rest < 0n) return undefined;
  const remainderIndexes = shares.flatMap((share, index) => (share.unit === "remainder" ? [index] : []));
  if (remainderIndexes.length === 0) return rest === 0n ? cents : undefined;
  const count = BigInt(remainderIndexes.length);
  remainderIndexes.forEach((shareIndex, position) => {
    cents[shareIndex] = Number(rest / count + (BigInt(position) < rest % count ? 1n : 0n));
  });
  return cents;
};

/** Pure and deterministic: resolves cents per row or reports what is missing, never inventing payers, debts or currency. */
export const resolveExpense = (rules: ExpenseRules): ExpenseResolution => {
  const validated = validateExpenseRules(rules);
  if (!validated.ok) return { status: "incomplete", reasons: ["invalid_rules"] };
  const { totalAmount, currency, payments = [], shares = [] } = validated.value;
  const totalCents = decimalCents(totalAmount) as number;
  const reasons: ExpenseIncompleteReason[] = [];
  if (currency === undefined) reasons.push("missing_currency");

  let resolvedPayments: ResolvedRow[] | undefined;
  const paymentRows = analyzeExpenseRows(payments, totalCents, false);
  if (paymentRows.kind !== "ok") reasons.push("missing_payments");
  else {
    const cents = paymentRows.covered ? resolveCents(payments, totalCents, true) : undefined;
    if (cents === undefined) reasons.push("payments_not_covering_total");
    else resolvedPayments = pair(payments, cents);
  }

  let resolvedShares: ResolvedRow[] | undefined;
  const shareRows = analyzeExpenseRows(shares, totalCents, true);
  if (shareRows.kind !== "ok") reasons.push("missing_shares");
  else {
    const cents = shareRows.covered || shareRows.hasRemainder ? resolveShares(shares, totalCents, shareRows.covered) : undefined;
    if (cents !== undefined) resolvedShares = pair(shares, cents);
    else reasons.push(shares.every((share) => share.unit === "excluded") ? "no_remainder_participant" : "shares_not_covering_total");
  }

  if (reasons.length === 0 && currency !== undefined && resolvedPayments && resolvedShares) {
    return { status: "complete", currency, totalCents, payments: resolvedPayments, shares: resolvedShares };
  }
  const incomplete: ExpenseResolution = { status: "incomplete", reasons, totalCents };
  if (resolvedPayments) incomplete.payments = resolvedPayments;
  if (resolvedShares) incomplete.shares = resolvedShares;
  return incomplete;
};
