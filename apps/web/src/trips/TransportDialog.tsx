import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Modal } from "../components/index.js";
import { formatActivityClock } from "./activity-time-format.js";
import { transportDaySlices, transportLabels, transportSteps } from "./transport-detail.js";
import type { ItineraryTransportResponse, TripItineraryResponse } from "./trip-itinerary-api.js";
import "./itinerary.css";

type Props = { transport: ItineraryTransportResponse; itinerary: TripItineraryResponse; timeZone: string; onClose: () => void;
  /** Recuerdos and Fotos of the transport (needs members); without it the dialog is just the detail. */
  memories?: ReactNode };

const filled = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

/**
 * Detail of one transport segment from the loaded itinerary (no request of its own). Instants keep their exact ISO value in `dateTime`;
 * the local days come from the itinerary projection and the intermediate ones carry no hour. The cost per person is not shown: it has no
 * currency yet (T119/T120).
 */
export function TransportDialog({ transport, itinerary, timeZone, onClose, memories }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  // Runs after Modal's own effect (it focuses the dialog): the reader lands on the heading.
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  const moment = useMemo(() => new Intl.DateTimeFormat("es-AR", { timeZone, dateStyle: "full", timeStyle: "short", hourCycle: "h23" }), [timeZone]);
  const dayLabel = useMemo(() => new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }), []);
  const slices = useMemo(() => transportDaySlices(itinerary, transport.id, timeZone), [itinerary, transport.id, timeZone]);
  const steps = useMemo(() => transportSteps(transport, timeZone), [transport, timeZone]);
  const details = transport.type === "flight"
    ? [["Aerolínea", transport.details.airline], ["Vuelo", transport.details.flightNumber]] as const
    : transport.type === "bus_long" ? [["Empresa", transport.details.company], ["Terminal", transport.details.terminal]] as const : [];
  const shown = details.filter(([, value]) => filled(value));
  return <div className="activity-dialog transport-dialog"><Modal isOpen title="Detalle de transporte" onClose={onClose}>
    <div className="activity-detail" data-transport-detail={transport.id}>
      <h3 ref={heading} tabIndex={-1}>{transportLabels[transport.type]}</h3>
      <p>{transport.departurePlace} → {transport.arrivalPlace}</p>
      <p>Salida: <time dateTime={transport.departureAt}>{moment.format(new Date(transport.departureAt))}</time><br />
        Llegada: <time dateTime={transport.arrivalAt}>{moment.format(new Date(transport.arrivalAt))}</time><br />
        <span className="activity-context">Horarios en {timeZone}</span></p>
      {shown.length > 0 ? <dl className="transport-facts">{shown.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : null}
      {steps.length > 0 ? <section aria-labelledby={`transport-steps-${transport.id}`}>
        <h4 id={`transport-steps-${transport.id}`}>Tramos</h4>
        <ol className="transport-steps">{steps.map((step, index) => <li key={index} data-transport-step={index}>
          <strong>Línea {step.line}</strong> · {step.fromStop} → {step.toStop}<br />
          {step.iso !== null ? <time dateTime={step.iso}>{step.clock}</time> : <span>{step.clock}</span>}
          {step.note ? <span className="activity-context"> ({step.note})</span> : null}
        </li>)}</ol>
      </section> : null}
      {slices.length > 0 ? <section aria-labelledby={`transport-days-${transport.id}`}>
        <h4 id={`transport-days-${transport.id}`}>Por día local</h4>
        <ul className="transport-days">{slices.map((slice) => <li key={slice.date} data-transport-day={slice.date}>
          <strong>{dayLabel.format(new Date(`${slice.date}T00:00:00Z`))}</strong> · {slice.kind}
          {slice.startsAt !== null ? <> · Sale <time dateTime={slice.startsAt}>{formatActivityClock(slice.startsAt, timeZone)}</time></> : null}
          {slice.endsAt !== null ? <> · Llega <time dateTime={slice.endsAt}>{formatActivityClock(slice.endsAt, timeZone)}</time></> : null}
        </li>)}</ul>
      </section> : null}
      {memories}
    </div>
  </Modal></div>;
}
