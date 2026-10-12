import { err, ok, type Result } from "../types/result.js";
import { ValidationError, type ValidationIssue } from "../errors/validation-error.js";
import { createObjectId } from "../value-objects/object-id.js";

// Round the decimal representation half-up, without binary multiplication at the half-cent boundary.
const decimalCents = (value: unknown): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  const [mantissa, exponent = "0"] = value.toString().split("e");
  const [whole, fraction = ""] = mantissa.split(".");
  const coefficient = BigInt(whole + fraction);
  const shift = Number(exponent) + 2 - fraction.length;
  const scale = 10n ** BigInt(Math.abs(shift));
  const rounded = shift >= 0 ? coefficient * scale : (coefficient + scale / 2n) / scale;
  return rounded <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(rounded) : undefined;
};

const rowsComplete = (rows: unknown, totalCents: number | undefined, shares: boolean): boolean => {
  if (!Array.isArray(rows) || rows.length === 0) return false;
  const identities = new Set<string>();
  let amountCents = 0;
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
    } else if (row.unit === "percent" && row.value <= 100) {
      percent += row.value;
    } else return false;
  }
  if (percent - 100 > Number.EPSILON * 100 * 8) return false;
  if (totalCents === undefined) return true;
  // Check coverage only, without resolving per-person amounts or producing debts.
  // Require full coverage before rounding; only complete agreements may resolve cent residue.
  const rawCoverage = amountCents + totalCents * percent / 100;
  const tolerance = Number.EPSILON * Math.max(1, totalCents, rawCoverage) * 8;
  if (rawCoverage - totalCents > tolerance) return false;
  return Number.isFinite(rawCoverage) && (hasRemainder || Math.abs(rawCoverage - totalCents) <= tolerance);
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
