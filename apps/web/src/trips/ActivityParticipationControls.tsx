import { useId, useState } from "react";
import { isTimeoutFailure, networkNotice, timeoutNotice } from "../api/index.js";
import { Button, Feedback, LoadingState } from "../components/index.js";
import type { DecisionRequired, PersonalParticipationStatus } from "./trip-participation-api.js";
import type { ParticipationState } from "./use-activity-participations.js";

const choices: { status: PersonalParticipationStatus; label: string }[] = [{ status: "going", label: "Voy" }, { status: "not_going", label: "No voy" }];
const statusLabels = { going: "Voy", not_going: "No voy", pending: "Sin responder" } as const;
export type ActivityParticipationControlsProps = {
  title: string; state?: ParticipationState; timeZone?: string;
  onChange: (status: PersonalParticipationStatus, trigger: HTMLElement) => void; onRetry: () => void;
};

const changeText = (fields: DecisionRequired["changedFields"]) => fields.length > 1 ? "El horario y la duración de esta actividad cambiaron."
  : fields[0] === "durationMinutes" ? "La duración de esta actividad cambió." : "El horario de esta actividad cambió.";

function DecisionNotice({ mark, timeZone }: { mark: DecisionRequired; timeZone?: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const when = new Intl.DateTimeFormat("es-AR", { ...(timeZone ? { timeZone } : {}), dateStyle: "medium", timeStyle: "short" });
  // Opening the explanation is local UI state: it never touches the persisted mark.
  return <div className="activity-participation-modified">
    <button type="button" className="ui-button activity-modified" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)}>Modificado</button>
    <div id={panelId} role="region" aria-live="polite" aria-label="Cambio en tu participación" hidden={!open}>
      <p>{changeText(mark.changedFields)} Entra en conflicto con otro plan tuyo. Elegí de nuevo si vas o no vas.</p>
      <p className="activity-participation-changed-at">Cambio registrado el <time dateTime={mark.changedAt}>{when.format(new Date(mark.changedAt))}</time>.</p>
    </div>
  </div>;
}

export function ActivityParticipationControls({ title, state, timeZone, onChange, onRetry }: ActivityParticipationControlsProps) {
  const error = state && state.kind !== "loading" ? state.error : undefined;
  const unavailable = error && ["not-found", "forbidden", "unauthorized"].includes(error.kind);
  return <fieldset className="activity-participation" aria-label={`Tu participación en ${title}`}>
    <legend>Tu participación</legend>
    {!state || state.kind === "loading" ? <LoadingState label="Cargando tu participación…" /> : null}
    {state?.kind === "ready" ? <>
      <p className="activity-participation-status">{statusLabels[state.status]}</p>
      {state.decisionRequired ? <DecisionNotice mark={state.decisionRequired} timeZone={timeZone} /> : null}
      <div className="activity-participation-actions">
        {choices.map(({ status, label }) => <Button key={status} aria-pressed={state.status === status}
          disabled={!!state.saving || !!unavailable} onClick={(event) => onChange(status, event.currentTarget)}>{label}</Button>)}
      </div>
      {state.saving ? <LoadingState label="Guardando tu participación…" /> : null}
      {state.saved ? <Feedback variant="success">Tu participación se guardó.</Feedback> : null}
    </> : null}
    {error ? <>
      <Feedback variant="error">{error.kind === "unauthorized" ? "Tu sesión venció. Volvé a iniciar sesión."
        : unavailable ? "La participación en esta actividad no está disponible para tu cuenta."
        : state?.kind === "ready" ? (isTimeoutFailure(error) ? `${timeoutNotice} Tu respuesta anterior se conserva.`
          : "No pudimos guardar tu participación. Tu respuesta anterior se conserva. Intentá nuevamente.")
        : networkNotice(error, "No pudimos cargar tu participación. Revisá tu conexión e intentá nuevamente.")}</Feedback>
      {error.kind === "unauthorized" ? <a href="/login">Iniciar sesión</a>
        : !unavailable && error.kind !== "validation" ? <Button onClick={onRetry}>Reintentar</Button> : null}
    </> : null}
  </fieldset>;
}
