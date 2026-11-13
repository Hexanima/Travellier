import { useEffect, useRef, useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { Button, Feedback, LoadingState, TextField } from "../components/index.js";
import { initialNewActivity, newActivityWhen, resolveNewActivity } from "./new-activity-draft.js";
import { draftKeyFor, setNewActivity, type NewActivityDraft, type PostDraft } from "./post-draft.js";
import type { ItineraryDayResponse, TripItineraryApi } from "./trip-itinerary-api.js";
import { inheritNoBack } from "./post-origin.js";
import { usePostDraft, type PostDraftHandle } from "./use-post-drafts.js";
import { DiscardChangesModal } from "./DiscardChangesModal.js";
import "./itinerary.css";

export type SpontaneousActivityFormProps = { itinerary: Pick<TripItineraryApi, "get">; timeZone?: string };
type Days = { kind: "loading" } | { kind: "error" } | { kind: "ready"; days: ItineraryDayResponse[] };
/** Order in which the first error is shown and focused; `scheduledAt` is reported on the time field. */
const errorOrder = ["title", "date", "time", "scheduledAt", "durationHours", "durationMinutes"];

export function SpontaneousActivityForm(props: SpontaneousActivityFormProps) {
  const { tripId, postId } = useParams();
  const location = useLocation();
  const { search } = location;
  const handle = usePostDraft(draftKeyFor({ postId, search }));
  const composer = `/trips/${tripId}/memories/${postId ? `${postId}/edit` : "new"}${search}`;
  // Opened by URL without a draft (or after a discard): the composer is the only entry point.
  if (!handle.draft) return <Navigate to={composer} replace {...inheritNoBack(location)} />;
  return <Form {...props} tripId={tripId} draft={handle.draft} commit={handle.setDraft} setReturned={handle.setReturned} composer={composer} />;
}

type FormInnerProps = SpontaneousActivityFormProps & { tripId?: string; draft: PostDraft; commit: (draft: PostDraft) => void; setReturned: PostDraftHandle["setReturned"]; composer: string };

/** Nothing is saved here: the activity travels in the draft and is created together with the memory when the composer publishes. */
function Form({ itinerary, timeZone: zone, tripId, draft, commit, setReturned, composer }: FormInnerProps) {
  const navigate = useNavigate();
  const [timeZone] = useState(() => zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [values, setValues] = useState<NewActivityDraft>(() => draft.extras.newActivity ?? initialNewActivity(timeZone));
  // Snapshot of what was loaded (the draft or the preloaded now): a change is measured against it, never against an empty form.
  const [initial] = useState(values);
  const [error, setError] = useState<{ field: string; message: string }>();
  const [loaded, setLoaded] = useState<Days>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // With a real history `navigate(-1)` resolves later (popstate): repeated taps after the first must not leave twice.
  const leaving = useRef(false);
  const fromComposer = (useLocation().state as { fromComposer?: boolean } | null)?.fromComposer === true;
  useEffect(() => { leaving.current = false; headingRef.current?.focus(); }, []);
  useEffect(() => {
    let cancelled = false;
    setLoaded({ kind: "loading" });
    const settle = (next: Days) => { if (!cancelled) setLoaded(next); };
    itinerary.get(tripId ?? "").then((result) => settle(result.ok ? { kind: "ready", days: result.value.days } : { kind: "error" }), () => settle({ kind: "error" }));
    return () => { cancelled = true; };
  }, [itinerary, tripId, attempt]);
  useEffect(() => {
    if (error) formRef.current?.querySelector<HTMLElement>(`[name="${error.field === "scheduledAt" ? "time" : error.field}"]`)?.focus();
  }, [error]);

  const update = (field: keyof NewActivityDraft, value: string) => { setValues((current) => ({ ...current, [field]: value })); setError(undefined); };
  const back = (notice?: string) => {
    if (leaving.current) return;
    leaving.current = true;
    const result = { focus: "link" as const, ...(notice ? { notice } : {}) };
    if (fromComposer) { setReturned(result); navigate(-1); } else navigate(composer, { replace: true, state: result });
  };
  const accept = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (leaving.current || loaded.kind !== "ready") return;
    const resolved = resolveNewActivity(values, { days: loaded.days, timeZone, tripId: tripId ?? "" });
    if (!resolved.ok) {
      // One alert at a time: the first invalid field in form order.
      const field = errorOrder.find((name) => resolved.errors[name]);
      if (field) setError({ field, message: resolved.errors[field]! });
      return;
    }
    const replaced = draft.extras.link !== null;
    commit(setNewActivity(draft, values));
    back(`Actividad nueva: ${values.title.trim()}, ${newActivityWhen(values)}. Se creará al publicar.${replaced ? " Se quitó el vínculo anterior." : ""}`);
  };
  const shown = (...names: string[]) => { const hit = names.find((name) => error?.field === name); return hit ? error?.message : undefined; };

  return <main className="app-shell trips-shell itinerary-shell">
    <div className="trips-panel">
      <header className="itinerary-header">
        <h1 ref={headingRef} tabIndex={-1}>Crear actividad espontánea</h1>
        <p>Se crea al publicar el recuerdo y quedás como «Voy». Horarios en {timeZone}.</p>
      </header>
      <form ref={formRef} className="activity-form" onSubmit={accept} noValidate>
        <TextField label="Título" name="title" value={values.title} required error={shown("title")} onChange={(event) => update("title", event.target.value)} />
        <div className="activity-date-time">
          <TextField label="Fecha" name="date" type="date" value={values.date} required error={shown("date")} onChange={(event) => update("date", event.target.value)} />
          <TextField label="Hora prevista" name="time" type="time" value={values.time} required error={shown("time", "scheduledAt")}
            onChange={(event) => update("time", event.target.value)} />
        </div>
        <fieldset className="activity-duration">
          <legend>Duración estimada · opcional</legend>
          <div className="activity-date-time">
            <TextField label="Horas" name="durationHours" type="text" inputMode="numeric" value={values.durationHours} error={shown("durationHours")}
              onChange={(event) => update("durationHours", event.target.value)} />
            <TextField label="Minutos de duración" name="durationMinutes" type="text" inputMode="numeric" value={values.durationMinutes} error={shown("durationMinutes")}
              onChange={(event) => update("durationMinutes", event.target.value)} />
          </div>
        </fieldset>
        {loaded.kind === "loading" ? <LoadingState label="Cargando itinerario…" /> : null}
        {loaded.kind === "error" ? <div className="trips-state">
          <Feedback variant="error">No pudimos cargar el itinerario para validar el horario. Revisá tu conexión e intentá nuevamente.</Feedback>
          <Button onClick={() => setAttempt((value) => value + 1)}>Reintentar</Button>
        </div> : null}
        <Button type="submit" disabled={loaded.kind !== "ready"}>Aceptar</Button>
        <Button onClick={() => back()}>Cancelar</Button>
        {/* The native back press is the same exit as «Cancelar»: with changes it asks before losing them. */}
        <DiscardChangesModal dirty={JSON.stringify(values) !== JSON.stringify(initial)}
          message="Si salís ahora, vas a perder los cambios de esta actividad." onDiscard={() => back()} />
      </form>
    </div>
  </main>;
}
