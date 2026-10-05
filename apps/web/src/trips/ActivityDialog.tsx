import { useEffect, useState, type ReactNode } from "react";
import type { ActivityStatus } from "app-domain";
import { Button, Feedback, LoadingState, Modal } from "../components/index.js";
import { ActivityForm } from "./ActivityForm.js";
import type { ActivityFormContext } from "./activity-form-state.js";
import type { ActivityResponse, TripActivityApi } from "./trip-activity-api.js";
import type { TripItineraryResponse } from "./trip-itinerary-api.js";
import type { TripFailure } from "./trip-management-api.js";
import { projectTripItinerary } from "./trip-itinerary-view.js";

export type ActivityDialogRequest = { kind: "create"; selection: ActivityFormContext["selection"] } | { kind: "detail"; activityId: string };
type Props = { request: ActivityDialogRequest; itinerary: TripItineraryResponse; timeZone: string; activities: TripActivityApi;
  onClose: () => void; onSaved: (activity: ActivityResponse) => void; participation?: ReactNode;
  voting?: (activity: ActivityResponse) => ReactNode; onStatus?: (activityId: string, status: ActivityStatus) => void };
type DetailState = { kind: "loading" } | { kind: "error"; error: TripFailure } | { kind: "detail" | "edit"; value: ActivityResponse };
const statusLabels = { proposed: "Propuesta", voting: "En votación", confirmed: "Confirmada" };

const safeMapsUrl = (value: string | null) => {
  if (!value) return undefined;
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined; }
  catch { return undefined; }
};

export function ActivityDialog({ request, itinerary, timeZone, activities, onClose, onSaved, participation, voting, onStatus }: Props) {
  const [state, setState] = useState<DetailState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (request.kind !== "detail") return;
    let cancelled = false;
    const load = async () => {
      setState({ kind: "loading" });
      try {
        const result = await activities.get(itinerary.tripId, request.activityId);
        if (!cancelled) {
          setState(result.ok ? { kind: "detail", value: result.value } : { kind: "error", error: result.error });
          if (result.ok) onStatus?.(result.value.id, result.value.status);
        }
      } catch { if (!cancelled) setState({ kind: "error", error: { kind: "network" } }); }
    };
    void load(); return () => { cancelled = true; };
  }, [request, activities, itinerary.tripId, attempt, onStatus]);

  const existing = state.kind === "detail" || state.kind === "edit" ? state.value : undefined;
  const rank = { proposed: 0, voting: 1, confirmed: 2 };
  const aggregateStatus = existing && itinerary.activities.find((a) => a.id === existing.id)?.status;
  const currentActivity = existing && aggregateStatus && rank[aggregateStatus] > rank[existing.status]
    ? { ...existing, status: aggregateStatus } : existing;
  // The detail may be newer than the aggregate. Project its confirmed instant before deriving edit context.
  const projected = existing ? projectTripItinerary({ ...itinerary,
    activities: [...itinerary.activities.filter((a) => a.id !== existing.id), { ...existing, postIds: [] }],
  }, timeZone) : [];
  const day = projected.find((d) => d.segments.some((s) => s.items.some((item) => item.kind === "activity" && item.id === existing?.id)));
  const segment = day?.segments.find((s) => s.items.some((item) => item.kind === "activity" && item.id === existing?.id));
  const selection = request.kind === "create" ? request.selection : day && segment ? { ...segment, date: day.date } : undefined;
  const context = selection ? { tripId: itinerary.tripId, days: itinerary.days, timeZone, selection } : undefined;
  const maps = safeMapsUrl(existing?.mapsUrl ?? null);
  const timestamp = new Intl.DateTimeFormat("es-AR", { timeZone, dateStyle: "full", timeStyle: "short" });
  return <div className="activity-dialog"><Modal isOpen title={request.kind === "create" ? "Nueva actividad" : state.kind === "edit" ? "Editar actividad" : "Detalle de actividad"}
    loading={saving} onClose={onClose}>
    {request.kind === "create" && context ? <ActivityForm context={context} activities={activities} onSaved={onSaved} onBusyChange={setSaving} /> : null}
    {request.kind === "detail" ? <>
      {state.kind === "loading" ? <LoadingState label="Cargando actividad…" /> : null}
      {state.kind === "error" ? <div className="activity-detail">
        <Feedback variant="error">{state.error.kind === "not-found" || state.error.kind === "forbidden" ? "Esta actividad no está disponible para tu cuenta."
          : state.error.kind === "unauthorized" ? "Tu sesión venció. Volvé a iniciar sesión."
          : "No pudimos cargar la actividad. Revisá tu conexión e intentá nuevamente."}</Feedback>
        {state.error.kind === "unauthorized" ? <a href="/login">Iniciar sesión</a>
          : !["not-found", "forbidden"].includes(state.error.kind) ? <Button onClick={() => setAttempt((value) => value + 1)}>Reintentar</Button> : null}
      </div> : null}
      {state.kind === "detail" ? <div className="activity-detail">
        <h3>{state.value.title}</h3>
        <p className="activity-context">{statusLabels[currentActivity?.status ?? state.value.status]}</p>
        {participation}
        {currentActivity ? voting?.(currentActivity) : null}
        <p><time dateTime={state.value.scheduledAt}>{timestamp.format(new Date(state.value.scheduledAt))}</time><br /><span className="activity-context">Horarios en {timeZone}</span></p>
        {state.value.description ? <p className="activity-description">{state.value.description}</p> : null}
        {maps ? <a className="activity-maps-link" href={maps} target="_blank" rel="noopener noreferrer">Ver vínculo de Maps</a>
          : state.value.mapsUrl ? <p className="activity-context">Vínculo de Maps no válido.</p> : null}
        {context ? <Button onClick={() => setState({ kind: "edit", value: state.value })}>Editar actividad</Button>
          : <Feedback variant="error">El día de esta actividad cambió. Cerrá el detalle y volvé a cargar el itinerario.</Feedback>}
      </div> : null}
      {state.kind === "edit" && context ? <ActivityForm context={context} activities={activities} existing={state.value} onSaved={onSaved} onBusyChange={setSaving} /> : null}
    </> : null}
  </Modal></div>;
}
