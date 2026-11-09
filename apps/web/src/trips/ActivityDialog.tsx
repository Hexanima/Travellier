import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Feedback, LoadingState, Modal } from "../components/index.js";
import { ActivityForm } from "./ActivityForm.js";
import type { ActivityFormContext } from "./activity-form-state.js";
import type { ActivityResponse, TripActivityApi } from "./trip-activity-api.js";
import type { TripItineraryResponse } from "./trip-itinerary-api.js";
import type { TripFailure } from "./trip-management-api.js";
import type { ParticipationResponse } from "./trip-participation-api.js";
import { formatDuration } from "./activity-duration.js";
import { formatActivityRange } from "./activity-time-format.js";
import { projectTripItinerary } from "./trip-itinerary-view.js";
import { safeMapsUrl } from "./safe-maps-url.js";

export type ActivityDialogRequest = { kind: "create"; selection: ActivityFormContext["selection"] } | { kind: "detail"; activityId: string };
type Props = { request: ActivityDialogRequest; itinerary: TripItineraryResponse; timeZone: string; activities: TripActivityApi;
  onClose: () => void; onSaved: (activity: ActivityResponse, participation: ParticipationResponse | null) => void;
  /** "removed": the server deleted it; "gone": it was already missing (404/403), so nothing is claimed as an own deletion. */
  onRemoved: (activityId: string, outcome: "removed" | "gone") => void;
  /** A participation write or conflict confirmation for this activity is pending: removal waits. */
  busy?: boolean; participation?: ReactNode };
type DetailState = { kind: "loading" } | { kind: "error"; error: TripFailure } | { kind: "detail" | "edit"; value: ActivityResponse };

export function ActivityDialog({ request, itinerary, timeZone, activities, onClose, onSaved, onRemoved, busy = false, participation }: Props) {
  const [state, setState] = useState<DetailState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [removal, setRemoval] = useState<"idle" | "confirming" | "deleting">("idle");
  const [removalError, setRemovalError] = useState<string>();
  // Synchronous guard: two clicks in the same tick must send a single DELETE (state would not be updated yet).
  const removingRef = useRef(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const removeTrigger = useRef<HTMLElement | null>(null);
  const wasConfirming = useRef(false);
  useEffect(() => {
    // Runs after Modal's own effect: initial focus on the safe action, and back to the trigger when cancelling.
    if (removal === "confirming") cancelRef.current?.focus();
    else if (removal === "idle" && wasConfirming.current && removeTrigger.current?.isConnected) removeTrigger.current.focus();
    wasConfirming.current = removal !== "idle";
  }, [removal]);
  useEffect(() => {
    if (request.kind !== "detail") return;
    let cancelled = false;
    const load = async () => {
      setState({ kind: "loading" });
      try {
        const result = await activities.get(itinerary.tripId, request.activityId);
        if (!cancelled) setState(result.ok ? { kind: "detail", value: result.value } : { kind: "error", error: result.error });
      } catch { if (!cancelled) setState({ kind: "error", error: { kind: "network" } }); }
    };
    void load(); return () => { cancelled = true; };
  }, [request, activities, itinerary.tripId, attempt]);

  const existing = state.kind === "detail" || state.kind === "edit" ? state.value : undefined;
  // The detail may be newer than the aggregate. Project its confirmed instant before deriving edit context.
  const projected = existing ? projectTripItinerary({ ...itinerary,
    activities: [...itinerary.activities.filter((a) => a.id !== existing.id), { ...existing, postIds: [] }],
  }, timeZone) : [];
  const day = projected.find((d) => d.segments.some((s) => s.items.some((item) => item.kind === "activity" && item.id === existing?.id)));
  const segment = day?.segments.find((s) => s.items.some((item) => item.kind === "activity" && item.id === existing?.id));
  const selection = request.kind === "create" ? request.selection : day && segment ? { ...segment, date: day.date } : undefined;
  const context = selection ? { tripId: itinerary.tripId, days: itinerary.days, timeZone, selection } : undefined;
  const maps = safeMapsUrl(existing?.mapsUrl ?? null);
  const range = state.kind === "detail" ? formatActivityRange(state.value, timeZone) : undefined;
  const timestamp = new Intl.DateTimeFormat("es-AR", { timeZone, dateStyle: "full", timeStyle: "short" });
  const confirmRemoval = async () => {
    if (removingRef.current || !existing) return;
    removingRef.current = true; setRemoval("deleting"); setRemovalError(undefined);
    try {
      let result: Awaited<ReturnType<TripActivityApi["remove"]>>;
      try { result = await activities.remove(itinerary.tripId, existing.id); } catch { result = { ok: false, error: { kind: "network" } }; }
      if (result.ok) { onRemoved(existing.id, "removed"); return; }
      if (result.error.kind === "not-found" || result.error.kind === "forbidden") { onRemoved(existing.id, "gone"); return; }
      setRemovalError(result.error.kind === "unauthorized" ? "Tu sesión venció. Volvé a iniciar sesión."
        : "No pudimos eliminar la actividad. Revisá tu conexión e intentá nuevamente.");
      setRemoval("confirming");
    } finally { removingRef.current = false; }
  };
  const cancelRemoval = () => { if (!removingRef.current) { setRemoval("idle"); setRemovalError(undefined); } };
  return <><div className="activity-dialog"><Modal isOpen title={request.kind === "create" ? "Nueva actividad" : state.kind === "edit" ? "Editar actividad" : "Detalle de actividad"}
    loading={saving || removal === "deleting"} onClose={onClose}>
    {request.kind === "create" && context ? <ActivityForm context={context} activities={activities} knownActivities={itinerary.activities} onSaved={onSaved} onBusyChange={setSaving} /> : null}
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
        {participation}
        <p><time dateTime={state.value.scheduledAt}>{timestamp.format(new Date(state.value.scheduledAt))}</time><br />{range?.endIso ? <>Hasta <time dateTime={range.endIso}>{range.end}</time>{range.endDateLabel ? ` del ${range.endDateLabel}` : ""}
          <br />Duración: {formatDuration(state.value.durationMinutes!)}<br /></> : null}<span className="activity-context">Horarios en {timeZone}</span></p>
        {state.value.description ? <p className="activity-description">{state.value.description}</p> : null}
        {maps ? <a className="activity-maps-link" href={maps} target="_blank" rel="noopener noreferrer">Ver vínculo de Maps</a>
          : state.value.mapsUrl ? <p className="activity-context">Vínculo de Maps no válido.</p> : null}
        {context ? <Button onClick={() => setState({ kind: "edit", value: state.value })}>Editar actividad</Button>
          : <Feedback variant="error">El día de esta actividad cambió. Cerrá el detalle y volvé a cargar el itinerario.</Feedback>}
        <Button error disabled={busy} onClick={(event) => { removeTrigger.current = event.currentTarget; setRemoval("confirming"); setRemovalError(undefined); }}>Eliminar actividad</Button>
      </div> : null}
      {state.kind === "edit" && context ? <ActivityForm context={context} activities={activities} existing={state.value} onSaved={onSaved} onBusyChange={setSaving} /> : null}
    </> : null}
  </Modal></div>
  {removal !== "idle" && existing ? <div className="activity-confirm-layer"><Modal isOpen closeOnEscape title="Eliminar actividad"
    loading={removal === "deleting"} error={removalError} onClose={cancelRemoval}>
    <div className="activity-detail">
      <p>¿Querés eliminar «{existing.title}»? Se quitarán las participaciones de esta actividad. Los recuerdos asociados se conservan. Esta acción no se puede deshacer.</p>
      <div className="activity-confirm-actions">
        <button ref={cancelRef} className="ui-button" type="button" onClick={cancelRemoval}>Cancelar</button>
        <Button error loading={removal === "deleting"} loadingLabel="Eliminando…" onClick={() => { void confirmRemoval(); }}>Eliminar definitivamente</Button>
      </div>
    </div>
  </Modal></div> : null}
  </>;
}
