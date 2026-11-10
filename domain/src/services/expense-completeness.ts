import { err, ok, type Result } from "../types/result.js";
import { ValidationError, type ValidationIssue } from "../errors/validation-error.js";
import { createObjectId } from "../value-objects/object-id.js";
import { addDecimals, decimalCents, decimalFraction, roundDecimal, withinTolerance, type DecimalFraction } from "../value-objects/decimal-math.js";

const rowsComplete = (rows: unknown, totalCents: number | undefined, shares: boolean): boolean => {
  if (!Array.isArray(rows) || rows.length === 0) return false;
  const identities = new Set<string>();
  let amountCents = 0n;
  let roundedCoverage = 0n;
  let percent: DecimalFraction = { numerator: 0n, denominator: 1n };
  let hasRemainder = false;
  for (const row of rows) {
    if (row === null || typeof row !== "object" || typeof row.userId !== "string") return false;
    const identity = createObjectId(row.userId);
    if (!identity.ok || (shares && identities.has(identity.value))) return false;
    identities.add(identity.value);
    if (shares && (row.unit === "remainder" || row.unit === "excluded")) {
      if (row.value != null) return false;
      hasRemainder ||= row.unit === "remainder";
      continue;
    }
    if (typeof row.value !== "number" || !Number.isFinite(row.value) || row.value < 0) return false;
    if (row.unit === "amount") {
      const cents = decimalCents(row.value);
      if (cents === undefined) return false;
      amountCents += BigInt(cents);
      roundedCoverage += BigInt(cents);
    } else if (row.unit === "percent" && row.value <= 100) {
      percent = addDecimals(percent, decimalFraction(row.value));
      if (totalCents !== undefined) {
        const cents = roundDecimal(row.value, BigInt(totalCents), 100n);
        if (cents === undefined) return false;
        roundedCoverage += BigInt(cents);
      }
    } else return false;
  }
  const percentExcess = percent.numerator - 100n * percent.denominator;
  if (percentExcess > 0n && !withinTolerance(percentExcess, percent.denominator, Number.EPSILON * 100 * 8)) return false;
  if (totalCents === undefined) return true;
  // Validate coverage and rounded row totals without producing debts or changing agreements.
  // Require full coverage before rounding; only complete agreements may resolve cent residue.
  const total = BigInt(totalCents);
  if (amountCents > total) return false;
  const denominator = 100n * percent.denominator;
  const difference = (total - amountCents) * denominator - total * percent.numerator;
  // Fixed cents compare exactly. Fractional percentage noise is bounded below one whole cent.
  const tolerance = Math.min(0.25, Number.EPSILON * Math.max(1, totalCents) * 8);
  const fullyCovered = difference === 0n || (percent.numerator > 0n && withinTolerance(difference, denominator, tolerance));
  if (difference < 0n && !fullyCovered) return false;
  // A partial agreement cannot absorb rounded excess into a negative remainder.
  if (!fullyCovered && roundedCoverage > total) return false;
  return hasRemainder || fullyCovered;
};

/** Pure diagnostic: does not adapt paidBy, infer agreements, or calculate balances. */
export const checkExpenseCompleteness = (input: Record<string, unknown>): Result<void, ValidationError> => {
  const issues: ValidationIssue[] = [];
  const incomplete = (field: string) => issues.push({ field, code: "incomplete_or_invalid", message: `Expense ${field} is incomplete or invalid.` });
  const totalCents = decimalCents(input.totalAmount);
  if (totalCents === undefined) incomplete("totalAmount");
  if (input.currency !== "ARS" && input.currency !== "EUR" && input.currency !== "USD") incomplete("currency");
  if (!rowsComplete(input.payments, totalCents, false)) incomplete("payments");
  if (!rowsComplete(input.shares, totalCents, true)) incomplete("shares");
  return issues.length === 0 ? ok(undefined) : err(new ValidationError(issues));
};
