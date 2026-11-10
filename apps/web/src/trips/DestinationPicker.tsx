import { Modal } from "../components/Modal.js";
import type { DestinationChoice, DestinationStatus } from "./trip-itinerary-destinations.js";

const reasons: Record<Exclude<DestinationStatus, "complete">, string> = {
  "missing-both": "Falta configurar los transportes",
  "missing-outbound": "Falta configurar la llegada",
  "missing-return": "Falta configurar la salida",
  inconsistent: "Revisá los horarios del transporte",
};

type Props = {
  choices: readonly DestinationChoice[]; current: string | undefined; timeZone: string;
  onSelect: (id: string) => void; onClose: () => void;
};

/** The stops of the Trip in order. Only a complete stop (arrival and departure known, consistent) can be chosen; the others say what is missing. */
export function DestinationPicker({ choices, current, timeZone, onSelect, onClose }: Props) {
  const format = new Intl.DateTimeFormat("es-AR", { timeZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const when = (label: string, instant: string | null) => instant === null ? null
    : <span className="destination-picker__when">{label} <time dateTime={instant}>{format.format(new Date(instant))}</time></span>;
  return <Modal isOpen title="Destinos del viaje" closeOnEscape onClose={onClose}>
    <ol className="destination-picker">
      {choices.map((choice) => <li key={choice.id}>
        <button type="button" className="ui-button destination-picker__stop" disabled={choice.status !== "complete"}
          aria-current={choice.id === current ? "true" : undefined}
          onClick={() => { if (choice.status === "complete") onSelect(choice.id); }}>
          <span className="destination-picker__order">{choice.order}</span>{" "}
          <strong className="destination-picker__name">{choice.name}</strong>
          {choice.status === "complete" ? null : <span className="destination-picker__reason"> {reasons[choice.status]}</span>}
          {when("Llegada", choice.arrivalAt)}{" "}{when("Salida", choice.departureAt)}
        </button>
      </li>)}
    </ol>
  </Modal>;
}
