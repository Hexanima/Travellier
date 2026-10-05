import type { ActivityStatus, ActivityVoteValue } from "app-domain";
import { Button, Feedback, LoadingState } from "../components/index.js";
import type { VoteState } from "./use-activity-votes.js";

const labels: Record<ActivityVoteValue, string> = { up: "A favor", down: "En contra" };
type Props = { title: string; status: ActivityStatus; state?: VoteState;
  onChange: (value: ActivityVoteValue) => void; onRetry: () => void };

export function ActivityVoteControls({ title, status, state, onChange, onRetry }: Props) {
  const error = state && state.kind !== "loading" ? state.error : undefined;
  const unavailable = error && ["not-found", "forbidden", "unauthorized", "voting-closed", "voting-disabled"].includes(error.kind);
  const closed = status === "confirmed" || error?.kind === "voting-closed";
  return <fieldset className="activity-vote" aria-label={`Tu voto en ${title}`}>
    <legend>Tu voto</legend>
    {!state || state.kind === "loading" ? <LoadingState label="Cargando tu voto…" /> : null}
    {state?.kind === "ready" ? <>
      <p className="activity-vote-status">{state.vote ? labels[state.vote.value] : "Todavía no votaste."}</p>
      {!closed ? <div className="activity-vote-actions">
        {(Object.keys(labels) as ActivityVoteValue[]).map((value) => <Button key={value}
          aria-pressed={state.vote?.value === value} disabled={!!state.saving || !!unavailable || state.vote?.value === value}
          onClick={() => onChange(value)}>{labels[value]}</Button>)}
      </div> : <p className="itinerary-secondary">La actividad está confirmada. La votación está cerrada.</p>}
      {state.saving ? <LoadingState label="Guardando tu voto…" /> : null}
      {state.saved ? <Feedback variant="success">Tu voto se guardó.</Feedback> : null}
    </> : null}
    {error ? <>
      <Feedback variant="error">{error.kind === "unauthorized" ? "Tu sesión venció. Volvé a iniciar sesión."
        : error.kind === "voting-closed" ? "La actividad ya está confirmada y no admite cambios de voto."
        : unavailable ? "La votación en esta actividad no está disponible para tu cuenta."
        : state?.kind === "ready" ? "No pudimos guardar tu voto. Tu respuesta anterior se conserva. Intentá nuevamente."
        : "No pudimos cargar tu voto. Revisá tu conexión e intentá nuevamente."}</Feedback>
      {error.kind === "unauthorized" ? <a href="/login">Iniciar sesión</a>
        : !unavailable && error.kind !== "validation" && !(closed && state?.kind === "ready") ? <Button onClick={onRetry}>Reintentar</Button> : null}
    </> : null}
  </fieldset>;
}
