import { err, ok, type Result } from "../types/result.js";
import { ValidationError, type ValidationIssue } from "../errors/validation-error.js";
import { analyzeExpenseRows } from "../entities/expense.js";
import { decimalCents } from "../value-objects/decimal-math.js";

const rowsComplete = (rows: unknown, totalCents: number | undefined, shares: boolean): boolean => {
  const analysis = analyzeExpenseRows(rows, totalCents, shares);
  return analysis.kind === "ok" && (totalCents === undefined || analysis.hasRemainder || analysis.covered);
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
