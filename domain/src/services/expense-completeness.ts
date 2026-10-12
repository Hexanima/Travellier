import { err, ok, type Result } from "../types/result.js";
import { ValidationError, type ValidationIssue } from "../errors/validation-error.js";
import { createObjectId } from "../value-objects/object-id.js";

// Round a scaled decimal half-up without binary multiplication at a rounding boundary.
const roundDecimal = (value: unknown, multiplier: bigint, divisor: bigint): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  const [mantissa, exponent = "0"] = value.toString().split("e");
  const [whole, fraction = ""] = mantissa.split(".");
  const coefficient = BigInt(whole + fraction);
  const shift = Number(exponent) - fraction.length;
  const scale = 10n ** BigInt(Math.abs(shift));
  const numerator = coefficient * multiplier * (shift >= 0 ? scale : 1n);
  const denominator = divisor * (shift < 0 ? scale : 1n);
  const rounded = (numerator + denominator / 2n) / denominator;
  return rounded <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(rounded) : undefined;
};
const decimalCents = (value: unknown) => roundDecimal(value, 100n, 1n);

const rowsComplete = (rows: unknown, totalCents: number | undefined, shares: boolean): boolean => {
  if (!Array.isArray(rows) || rows.length === 0) return false;
  const identities = new Set<string>();
  let amountCents = 0;
  let roundedCoverage = 0n;
  let percent = 0;
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
      amountCents += cents;
      roundedCoverage += BigInt(cents);
    } else if (row.unit === "percent" && row.value <= 100) {
      percent += row.value;
      if (totalCents !== undefined) {
        const cents = roundDecimal(row.value, BigInt(totalCents), 100n);
        if (cents === undefined) return false;
        roundedCoverage += BigInt(cents);
      }
    } else return false;
  }
  if (percent - 100 > Number.EPSILON * 100 * 8) return false;
  if (totalCents === undefined) return true;
  // Validate coverage and rounded row totals without producing debts or changing agreements.
  // Require full coverage before rounding; only complete agreements may resolve cent residue.
  const rawCoverage = amountCents + totalCents * percent / 100;
  const tolerance = Number.EPSILON * Math.max(1, totalCents, rawCoverage) * 8;
  if (rawCoverage - totalCents > tolerance) return false;
  const fullyCovered = Math.abs(rawCoverage - totalCents) <= tolerance;
  // A partial agreement cannot absorb rounded excess into a negative remainder.
  if (!fullyCovered && roundedCoverage > BigInt(totalCents)) return false;
  return Number.isFinite(rawCoverage) && (hasRemainder || fullyCovered);
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
