import { err, ok, type Result } from "../types/result.js";
import { ValidationError } from "../errors/validation-error.js";
import { decimalCents } from "./decimal-math.js";

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
