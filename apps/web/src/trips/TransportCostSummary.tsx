import { Feedback } from "../components/index.js";
import { formatCents } from "./expense-format.js";
import { Heading } from "./Heading.js";
import { unindicatedCostLines, type CostTransport } from "./transport-cost-summary.js";
import type { TripItineraryResponse } from "./trip-itinerary-api.js";

type Props = { totals: TripItineraryResponse["transportCostTotals"]; transports: readonly CostTransport[];
  destinations: readonly { id: string; name: string }[]; headingLevel?: 1 | 2 | 3 | 4 | 5 | 6; id?: string };

/**
 * Transport cost per person, by currency exactly as the server totalled it (the client never adds across currencies nor converts).
 * It is not a post expense and is not part of the balance. A cost without currency is listed apart and added to no total.
 */
export function TransportCostSummary({ totals, transports, destinations, headingLevel = 2, id = "transport-cost-summary" }: Props) {
  const unindicated = unindicatedCostLines(transports, destinations);
  if (totals.byCurrency.length === 0 && totals.withoutCurrency.transportCount === 0 && unindicated.length === 0) return null;
  return <section className="transport-cost-summary" aria-labelledby={id} data-transport-costs>
    <Heading level={headingLevel} id={id}>Total del viaje</Heading>
    <p>Costo de transporte por persona</p>
    {totals.byCurrency.map((entry) => <p className="itinerary-expense-total" key={entry.currency} data-transport-currency={entry.currency}>
      <strong>{formatCents(entry.totalCents, entry.currency)}</strong> · <span>{entry.transportCount === 1 ? "1 transporte" : `${entry.transportCount} transportes`}</span></p>)}
    {unindicated.length > 0 || totals.withoutCurrency.transportCount > 0 ? <div data-transport-cost-unindicated>
      <Feedback variant="error" role="status">Moneda sin indicar: {totals.withoutCurrency.transportCount === 1 ? "1 transporte tiene" : `${totals.withoutCurrency.transportCount} transportes tienen`} costo sin moneda y no se suma. Editá cada transporte para elegirla.</Feedback>
      <ul>{unindicated.map((line) => <li key={line.id} data-transport-cost-line={line.id}>
        {line.destination ? `${line.destination} · ` : ""}{line.route}: {line.amount}</li>)}</ul>
    </div> : null}
    <p>No es un gasto ni entra en el balance. No se convierten monedas.</p>
  </section>;
}
