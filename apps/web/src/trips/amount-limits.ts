import { MAX_AMOUNT_CENTS as DOMAIN_MAX_AMOUNT_CENTS } from "app-domain";

/** Largest writable amount in cents (PRD, same constant as the backend): 999.999.999.999,99. */
export const MAX_AMOUNT_CENTS: bigint = BigInt(DOMAIN_MAX_AMOUNT_CENTS);

const grouped = (value: bigint): string => value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
/** The limit as shown to people, derived from the constant. */
export const MAX_AMOUNT_TEXT = `${grouped(MAX_AMOUNT_CENTS / 100n)},${String(MAX_AMOUNT_CENTS % 100n).padStart(2, "0")}`;

export const exceedsMaxAmount = (cents: bigint): boolean => cents > MAX_AMOUNT_CENTS;
