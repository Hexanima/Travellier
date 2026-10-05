import type { ActivityParticipationStatus } from "app-domain";
import { Button, Feedback, LoadingState } from "../components/index.js";
import type { ParticipationState } from "./use-activity-participations.js";

const labels: Record<ActivityParticipationStatus, string> = { going: "Voy", not_going: "No voy", pending: "Sin responder" };
export type ActivityParticipationControlsProps = {
  title: string; state?: ParticipationState;
  onChange: (status: ActivityParticipationStatus) => void; onRetry: () => void;
};

export function ActivityParticipationControls({ title, state, onChange, onRetry }: ActivityParticipationControlsProps) {
  const error = state && state.kind !== "loading" ? state.error : undefined;
  const unavailable = error && ["not-found", "forbidden", "unauthorized"].includes(error.kind);
  return <fieldset className="activity-participation" aria-label={`Tu participación en ${title}`}>
    <legend>Tu participación</legend>
    {!state || state.kind === "loading" ? <LoadingState label="Cargando tu participación…" /> : null}
    {state?.kind === "ready" ? <>
      <p className="activity-participation-status">{labels[state.status]}</p>
      <div className="activity-participation-actions">
        {(Object.keys(labels) as ActivityParticipationStatus[]).map((status) => <Button key={status}
          aria-pressed={state.status === status} disabled={!!state.saving || !!unavailable || state.status === status}
          onClick={() => onChange(status)}>{labels[status]}</Button>)}
      </div>
      {state.saving ? <LoadingState label="Guardando tu participación…" /> : null}
      {state.saved ? <Feedback variant="success">Tu participación se guardó.</Feedback> : null}
    </> : null}
    {error ? <>
      <Feedback variant="error">{error.kind === "unauthorized" ? "Tu sesión venció. Volvé a iniciar sesión."
        : unavailable ? "La participación en esta actividad no está disponible para tu cuenta."
        : state?.kind === "ready" ? "No pudimos guardar tu participación. Tu respuesta anterior se conserva. Intentá nuevamente."
        : "No pudimos cargar tu participación. Revisá tu conexión e intentá nuevamente."}</Feedback>
      {error.kind === "unauthorized" ? <a href="/login">Iniciar sesión</a>
        : !unavailable && error.kind !== "validation" ? <Button onClick={onRetry}>Reintentar</Button> : null}
    </> : null}
  </fieldset>;
}
