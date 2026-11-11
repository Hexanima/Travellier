import { CURRENCIES, toCents } from "../value-objects/money.js";
import type { TransportCostTotals } from "../types/trip-itinerary.js";
import type { Transport } from "./transport.js";

/**
 * Cost per person of the Trip's transports, per currency in integer cents (fixed order, no conversion).
 * It is not multiplied by members and is independent of post expenses and balance. A cost without a usable
 * currency or amount counts apart and adds to no total; transports without cost are ignored.
 */
export const transportCostTotals = (transports: readonly Pick<Transport, "costPerPerson" | "costCurrency">[]): TransportCostTotals => {
  const totals = new Map(CURRENCIES.map((currency) => [currency, { currency, totalCents: 0, transportCount: 0 }]));
  let withoutCurrency = 0;
  for (const transport of transports) {
    if (transport.costPerPerson === null || transport.costPerPerson === undefined) continue;
    const cents = toCents(transport.costPerPerson);
    const total = cents.ok && transport.costCurrency ? totals.get(transport.costCurrency) : undefined;
    if (total === undefined || !cents.ok) { withoutCurrency++; continue; }
    total.totalCents += cents.value;
    total.transportCount++;
  }
  return { byCurrency: [...totals.values()].filter((total) => total.transportCount > 0), withoutCurrency: { transportCount: withoutCurrency } };
};
