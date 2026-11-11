import { toCents } from "app-domain";
import { formatCents, formatPlainCents } from "./expense-format.js";
import type { ExpenseCurrency } from "./expense-draft.js";

export type CostTransport = { id: string; destinationId: string; direction: string; departurePlace: string; arrivalPlace: string;
  costPerPerson: number | null; costCurrency?: ExpenseCurrency | null };

/** The amount of a transport cost: with its currency when there is one, the plain number when it was never indicated. */
export const formatTransportCost = (costPerPerson: number, currency: ExpenseCurrency | null | undefined): string => {
  const cents = toCents(costPerPerson);
  if (!cents.ok) return currency ? `${currency} ${costPerPerson}` : String(costPerPerson);
  return currency ? formatCents(cents.value, currency) : formatPlainCents(cents.value);
};

/** Transports with a cost and no currency: listed one by one, never summed. */
export const unindicatedCostLines = (transports: readonly CostTransport[], destinations: readonly { id: string; name: string }[]) =>
  transports.filter((transport) => transport.costPerPerson !== null && (transport.costCurrency ?? null) === null)
    .map((transport) => ({ id: transport.id,
      destination: destinations.find((destination) => destination.id === transport.destinationId)?.name ?? "",
      direction: transport.direction, route: `${transport.departurePlace} → ${transport.arrivalPlace}`,
      amount: formatTransportCost(transport.costPerPerson!, null) }));
