import { err, ok, type Result } from "../types/result.js";
import { ValidationError, type ValidationIssue } from "../errors/validation-error.js";
import { createObjectId } from "../value-objects/object-id.js";

type DecimalFraction = { numerator: bigint; denominator: bigint };

const decimalFraction = (value: number): DecimalFraction => {
  const [mantissa, exponent = "0"] = value.toString().split("e");
  const [whole, fraction = ""] = mantissa.split(".");
  const coefficient = BigInt(whole + fraction);
  const shift = Number(exponent) - fraction.length;
  const scale = 10n ** BigInt(Math.abs(shift));
  return { numerator: coefficient * (shift >= 0 ? scale : 1n), denominator: shift < 0 ? scale : 1n };
};

const addDecimals = (left: DecimalFraction, right: DecimalFraction): DecimalFraction => {
  // Decimal denominators are powers of ten, so the larger is a common denominator.
  const denominator = left.denominator > right.denominator ? left.denominator : right.denominator;
  return { numerator: left.numerator * (denominator / left.denominator) + right.numerator * (denominator / right.denominator), denominator };
};

const withinTolerance = (difference: bigint, denominator: bigint, tolerance: number): boolean => {
  const margin = decimalFraction(tolerance);
  const magnitude = difference < 0n ? -difference : difference;
  return magnitude * margin.denominator <= margin.numerator * denominator;
};

// Round a scaled decimal half-up without binary multiplication at a rounding boundary.
const roundDecimal = (value: unknown, multiplier: bigint, divisor: bigint): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  const fraction = decimalFraction(value);
  const numerator = fraction.numerator * multiplier;
  const denominator = fraction.denominator * divisor;
  const rounded = (numerator + denominator / 2n) / denominator;
  return rounded <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(rounded) : undefined;
};
const decimalCents = (value: unknown) => roundDecimal(value, 100n, 1n);

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
