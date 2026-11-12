import { err, ok, type Result } from "../types/result.js";
import { ValidationError } from "../errors/validation-error.js";
import { decimalCents, decimalFraction } from "./decimal-math.js";

export const CURRENCIES = ["ARS", "EUR", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const createCurrency = (value: unknown): Result<Currency, ValidationError> => {
  const currency = CURRENCIES.find((candidate) => candidate === value);
  return currency
    ? ok(currency)
    : err(new ValidationError([{ field: "currency", code: "invalid_currency", message: "Currency must be ARS, EUR or USD." }]));
};

/** Decimal amount to integer cents, half-up and exact; rejects negative, non-finite and unsafe values. */
export const toCents = (decimal: number): Result<number, ValidationError> => {
  const cents = decimalCents(decimal);
  return cents === undefined
    ? err(new ValidationError([{ field: "amount", code: "invalid_amount", message: "Amount must be a finite, non-negative and safe decimal." }]))
    : ok(cents);
};

/** Largest writable amount (PRD): 999.999.999.999,99 as exact cents and as a decimal. */
export const MAX_AMOUNT_CENTS = 99_999_999_999_999;
export const MAX_AMOUNT = 999_999_999_999.99;

export type WritableAmountCheck = { ok: true } | { ok: false; code: "invalid" | "exceeds_max" };

/**
 * Write-side check of an amount: a finite number, not negative, with at most two decimals and up to MAX_AMOUNT
 * (`positive` also rejects 0). The limit is compared exactly in cents, never with floating point. Reads never use it.
 */
export const checkWritableAmount = (value: unknown, options: { positive: boolean }): WritableAmountCheck => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || Object.is(value, -0)) return { ok: false, code: "invalid" };
  if (options.positive && value === 0) return { ok: false, code: "invalid" };
  const { numerator, denominator } = decimalFraction(value);
  if (numerator * 100n > BigInt(MAX_AMOUNT_CENTS) * denominator) return { ok: false, code: "exceeds_max" };
  return (numerator * 100n) % denominator === 0n ? { ok: true } : { ok: false, code: "invalid" };
};
