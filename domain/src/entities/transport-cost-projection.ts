import { CURRENCIES, toCents, type Currency } from "../value-objects/money.js";
import type { TransportCostTotals } from "../types/trip-itinerary.js";
import type { Transport } from "./transport.js";

/**
 * Cost per person of the Trip's transports, per currency in integer cents (fixed order, no conversion).
 * It is not multiplied by members and is independent of post expenses and balance. A cost without a usable
 * currency or amount counts apart and adds to no total; transports without cost are ignored.
 */
export const transportCostTotals = (transports: readonly Pick<Transport, "costPerPerson" | "costCurrency">[]): TransportCostTotals => {
  const totals = new Map(CURRENCIES.map((currency) => [currency, { currency, totalCents: 0, transportCount: 0 }]));
  const sums = new Map<Currency, bigint>(CURRENCIES.map((currency) => [currency, 0n]));
  let withoutCurrency = 0;
  for (const transport of transports) {
    if (transport.costPerPerson === null || transport.costPerPerson === undefined) continue;
    const cents = toCents(transport.costPerPerson);
    const total = cents.ok && transport.costCurrency ? totals.get(transport.costCurrency) : undefined;
    if (total === undefined || !cents.ok) { withoutCurrency++; continue; }
    // A total beyond the safe integer range would lose precision: that cost counts apart (the balance excludes instead of throwing).
    const sum = (sums.get(total.currency) ?? 0n) + BigInt(cents.value);
    if (sum > BigInt(Number.MAX_SAFE_INTEGER)) { withoutCurrency++; continue; }
    sums.set(total.currency, sum);
    total.totalCents = Number(sum);
    total.transportCount++;
  }
  return { byCurrency: [...totals.values()].filter((total) => total.transportCount > 0), withoutCurrency: { transportCount: withoutCurrency } };
};
