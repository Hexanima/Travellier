import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Button, Feedback, LoadingState, Modal, TextAreaField, TextField } from "../components/index.js";
import { ParticipationConflictModal } from "./ParticipationConflictModal.js";
import { newActivityLabel, parseNewActivity, resolveNewActivity } from "./new-activity-draft.js";
import type { ParticipationConfirmation } from "./participation-conflict.js";
import { draftFromPost, emptyDraft, hasContent, isDraftDirty, prepareCreate, prepareUpdate, setNewActivity, setTransport, type PostDraft, type ResolvedNewActivity } from "./post-draft.js";
import { linkSummary } from "./post-link-options.js";
import type { TripItineraryApi, TripItineraryResponse } from "./trip-itinerary-api.js";
import type { TripFailure } from "./trip-management-api.js";
import type { PostInput, PostResponse, TripPostApi } from "./trip-post-api.js";
import { usePostDraft } from "./use-post-drafts.js";
import "./itinerary.css";

export type PostComposerProps = { posts: Pick<TripPostApi, "create" | "update" | "get">; itinerary: Pick<TripItineraryApi, "get">; timeZone?: string };
/** A conflict answer waits here for an explicit decision: the same entry is resent with the confirmation, or dropped on cancel. */
type PendingConfirmation = { input: PostInput; confirmation: ParticipationConfirmation; stale: boolean };
type Loaded = { kind: "loading" } | { kind: "ready"; post?: PostResponse } | { kind: "error"; error: TripFailure };
const missingContentMessage = "Escribí un texto o agregá una ubicación.";
const fieldMessages: Record<string, string> = { description: "Revisá el texto del recuerdo.", mapsUrl: "Revisá el link de la ubicación." };
const linkFields = ["parentPostId", "activityId", "transportId"];
const windowMessage = "Elegí un horario dentro de la franja de actividad del destino.";
const activityMessage = (field: string, code: string) => field === "title" ? "Ingresá un título para la actividad."
  : field === "durationMinutes" ? code === "outside_window" ? "La actividad terminaría después de la salida del destino. Acortá la duración o elegí otro horario." : "Revisá la duración estimada."
  : field === "scheduledAt" || field === "dayId" ? windowMessage : undefined;
const retryHint = "Revisá tus recuerdos antes de reintentar por si ya se publicó.";
const linkMessage = (code: string) => code === "cycle" || code === "self_reference" ? "Ese recuerdo no puede ser el vínculo: crearía un ciclo. Elegí otro."
  : code === "conflict" ? "Un recuerdo continuación no puede tener otro vínculo directo." : "No pudimos aplicar el vínculo. Elegí otro.";
const transportParam = (search: string) => { const value = new URLSearchParams(search).get("transportId"); return value !== null && /^[0-9a-f]{24}$/.test(value) ? value : null; };

export function PostComposer({ posts, itinerary, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone }: PostComposerProps) {
  const { tripId, postId } = useParams();
  return <Composer key={`${tripId}/${postId ?? "new"}`} tripId={tripId} postId={postId} posts={posts} itinerary={itinerary} timeZone={timeZone} />;
}

function Composer({ tripId, postId, posts, itinerary, timeZone }: Omit<PostComposerProps, "timeZone"> & { timeZone: string; tripId?: string; postId?: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const handle = usePostDraft(postId ? `edit:${postId}` : "new");
  // Set by the selector when returning: where to put the focus and what to announce (read once).
  // Back with `navigate(-1)` leaves it in the drafts context; a direct entry replaced by the composer leaves it in the location state.
  const [entry] = useState(() => handle.returned ?? location.state as { focus?: string; notice?: string } | null);
  const returnedPending = handle.returned !== undefined, clearReturned = handle.clearReturned;
  useEffect(() => { if (returnedPending) clearReturned(); }, [returnedPending, clearReturned]);
  const [notice, setNotice] = useState(entry?.notice ?? "");
  const focusLink = useRef(entry?.focus === "link");
  const linkRef = useRef<HTMLButtonElement>(null);
  const [loaded, setLoaded] = useState<Loaded>(postId ? { kind: "loading" } : { kind: "ready" });
  const [attempt, setAttempt] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<TripFailure>();
  const [message, setMessage] = useState("");
  const [missingContent, setMissingContent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [pending, setPending] = useState<PendingConfirmation>();
  const [loadedItinerary, setLoadedItinerary] = useState<TripItineraryResponse>();
  const itineraryRequest = useRef<Promise<TripItineraryResponse | undefined> | undefined>(undefined);
  const hadPending = useRef(false);
  const savingRef = useRef(false);
  const focusPending = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const listing = `/trips/${tripId}/memories`;
  const existing = loaded.kind === "ready" ? loaded.post : undefined;

  useEffect(() => {
    if (!postId) return;
    let cancelled = false;
    const load = async () => {
      if (!tripId) { setLoaded({ kind: "error", error: { kind: "not-found" } }); return; }
      setLoaded({ kind: "loading" });
      try {
        const result = await posts.get(tripId, postId);
        if (!cancelled) setLoaded(result.ok ? { kind: "ready", post: result.value.post } : { kind: "error", error: result.error });
      } catch {
        if (!cancelled) setLoaded({ kind: "error", error: { kind: "network" } });
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [tripId, postId, posts, attempt]);
  // Runs after Modal's own effect: the initial focus goes to the safe action.
  useEffect(() => { if (confirmingDiscard) keepRef.current?.focus(); }, [confirmingDiscard]);
  // Once the conflict modal closes and the save settles, the focus returns to the publish button (the busy modal had left it on <body>).
  // It must be declared before the next effect: both can run in the same commit (a 422 after confirming) and the error focus has to win.
  useEffect(() => {
    if (pending) { hadPending.current = true; return; }
    if (hadPending.current && !saving) {
      hadPending.current = false;
      formRef.current?.querySelector<HTMLButtonElement>('button[type="submit"]')?.focus();
    }
  }, [pending, saving]);
  // The fields are disabled while saving: focus the first one with an error once the save has settled.
  useEffect(() => {
    if (!focusPending.current || saving) return;
    const first = missingContent ? "description" : ["description", "mapsUrl", "link", "activity"].find((name) => errors[name]);
    if (first) formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
    focusPending.current = false;
  }, [errors, saving, missingContent]);
  // Back from the selector: the focus returns to the button that opened it.
  useEffect(() => {
    if (!focusLink.current || loaded.kind !== "ready") return;
    linkRef.current?.focus(); focusLink.current = false;
  }, [loaded.kind]);

  const saved: PostDraft = existing ? draftFromPost(existing) : emptyDraft();
  // A transport preloaded from its detail (creation only) is part of the base (it is not a change); a continuation memory keeps no transport.
  const preloaded = postId ? null : transportParam(location.search);
  const base: PostDraft = preloaded && saved.extras.transportId === null && saved.extras.link?.kind !== "post" ? setTransport(saved, preloaded) : saved;
  // An existing draft (for example after a subform or an error) always wins over the saved values.
  const draft: PostDraft = handle.draft ?? base;
  const dirty = isDraftDirty(draft, base);
  const newActivity = draft.extras.newActivity;
  /** Needed only with a new activity: to revalidate its schedule and to name the incompatible plans. A failure never blocks publishing. */
  const loadItinerary = () => {
    itineraryRequest.current ??= itinerary.get(tripId ?? "").then((result) => result.ok ? result.value : undefined, () => undefined).then((value) => {
      if (value) setLoadedItinerary(value); else itineraryRequest.current = undefined;
      return value;
    });
    return itineraryRequest.current;
  };
  const wantsItinerary = newActivity !== null;
  useEffect(() => { if (wantsItinerary && tripId) void loadItinerary(); }, [wantsItinerary, tripId]); // eslint-disable-line react-hooks/exhaustive-deps
  const update = (field: "description" | "mapsUrl", value: string) => {
    handle.setDraft({ ...draft, values: { ...draft.values, [field]: value } });
    setErrors((current) => { const next = { ...current }; delete next[field]; return next; });
    setFailure(undefined); setMessage(""); setMissingContent(false);
  };
  const fail = (error: TripFailure) => {
    setFailure(error);
    if (error.kind === "validation") {
      const mapped: Record<string, string> = {};
      for (const { field, code } of error.fields ?? []) {
        if (linkFields.includes(field)) mapped.link ??= linkMessage(code ?? "");
        else if (field in fieldMessages) mapped[field] = fieldMessages[field]!;
        else if (newActivity !== null && activityMessage(field, code ?? "")) mapped.activity ??= activityMessage(field, code ?? "")!;
      }
      setErrors(mapped); focusPending.current = Object.keys(mapped).length > 0;
    }
  };
  /** The entry is built once per attempt: a confirmed retry resends this very input. A new activity needs its instant resolved first. */
  const buildInput = (): PostInput | undefined => {
    let resolved: ResolvedNewActivity | undefined;
    if (newActivity !== null) {
      // With the itinerary loaded the schedule is validated here too; without it the server decides.
      const result = loadedItinerary ? resolveNewActivity(newActivity, { days: loadedItinerary.days, timeZone, tripId: tripId ?? "" }) : parseNewActivity(newActivity, timeZone);
      if (!result.ok) {
        setErrors({ activity: Object.values(result.errors)[0] ?? windowMessage }); focusPending.current = true;
        return undefined;
      }
      resolved = result.value;
    }
    return existing ? prepareUpdate(draft, existing, resolved) : prepareCreate(draft, resolved);
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingRef.current || !tripId) return;
    setMessage(""); setFailure(undefined); setErrors({}); setMissingContent(false); setNotice("");
    // Creating always needs text or a location; editing only when the text or the location changed and nothing is left
    // (an existing memory can be relinked without them).
    const textChanged = draft.values.description !== base.values.description || draft.values.mapsUrl !== base.values.mapsUrl;
    if (!hasContent(draft) && (!existing || textChanged)) { setMissingContent(true); focusPending.current = true; return; }
    const input = buildInput();
    if (!input) return;
    if (existing && Object.keys(input).length === 0) { setMessage("No hay cambios para guardar."); return; }
    await send(input, undefined);
  };
  /** Saves memory and activity together; a confirmation from a previous 409 is forwarded unchanged. Nothing is announced unless everything was saved. */
  const send = async (input: PostInput, confirmation: ParticipationConfirmation | undefined) => {
    if (!tripId) return;
    savingRef.current = true; setSaving(true);
    try {
      const withConfirmation = confirmation ? [confirmation] as const : [] as const;
      const result = existing ? await posts.update(tripId, existing.id, input, ...withConfirmation) : await posts.create(tripId, input, ...withConfirmation);
      if (result.ok && input.newActivity && !result.value.activity) { setPending(undefined); fail({ kind: "server" }); }
      else if (result.ok) {
        const { activity, participation, ...post } = result.value;
        setPending(undefined);
        handle.clear();
        navigate(listing, { state: { post, going: participation?.status === "going",
          notice: activity ? (existing ? "linked-activity" : "created-activity") : existing ? "updated" : "created" } });
      } else if (result.error.kind === "participation-conflict" && result.error.confirmation) {
        setPending({ input, confirmation: result.error.confirmation, stale: confirmation !== undefined });
      } else { setPending(undefined); fail(result.error); }
    } catch { setPending(undefined); fail({ kind: "network" }); }
    finally { savingRef.current = false; setSaving(false); }
  };
  const composerPath = `/trips/${tripId}/memories/${postId ? `${postId}/edit` : "new"}`;
  // The draft is materialized first: in an edit it does not exist until something changes, and the selector needs it.
  const openPicker = () => { handle.setDraft(draft); navigate(`${composerPath}/link${location.search}`, { state: { fromComposer: true } }); };
  const openActivity = () => { handle.setDraft(draft); navigate(`${composerPath}/activity${location.search}`, { state: { fromComposer: true } }); };
  const removeActivity = () => {
    handle.setDraft(setNewActivity(draft, null)); setNotice(""); setErrors((current) => { const next = { ...current }; delete next.activity; return next; });
    linkRef.current?.focus();
  };
  const removeTransport = () => { handle.setDraft(setTransport(draft, null)); setNotice(""); };
  const leave = () => { handle.clear(); navigate(listing); };
  const cancel = () => { if (dirty) setConfirmingDiscard(true); else leave(); };
  const unavailable = (kind: string) => kind === "not-found" || kind === "forbidden";
  const published = existing ? new Intl.DateTimeFormat("es-AR", { timeZone, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : undefined;

  const blocked = loaded.kind === "error" ? loaded.error : failure && (unavailable(failure.kind) || failure.kind === "unauthorized") ? failure : undefined;
  return <main className="app-shell trips-shell itinerary-shell">
    <div className="trips-panel">
      <header className="itinerary-header">
        <h1>{postId ? "Editar recuerdo" : "Nuevo recuerdo"}</h1>
        <p>Contá lo que viviste. La fecha de publicación la asigna la app.</p>
      </header>
      {loaded.kind === "loading" ? <LoadingState label="Cargando recuerdo…" /> : null}
      {blocked && unavailable(blocked.kind) ? <div className="trips-state">
        <Feedback variant="error">Este recuerdo ya no está disponible para tu cuenta.</Feedback>
        <Link to={listing}>Volver a recuerdos</Link>
      </div> : null}
      {blocked?.kind === "unauthorized" ? <div className="trips-state">
        <Feedback variant="error">Tu sesión venció. Volvé a iniciar sesión.</Feedback>
        <Link to="/login">Iniciar sesión</Link>
      </div> : null}
      {loaded.kind === "error" && !unavailable(loaded.error.kind) && loaded.error.kind !== "unauthorized" ? <div className="trips-state">
        <Feedback variant="error">No pudimos cargar el recuerdo. Revisá tu conexión e intentá nuevamente.</Feedback>
        <Button onClick={() => setAttempt((value) => value + 1)}>Reintentar</Button>
      </div> : null}
      {loaded.kind === "ready" && !blocked ? <form ref={formRef} className="auth-form post-composer" onSubmit={(event) => void submit(event)} noValidate>
        {existing && published ? <p className="itinerary-secondary">Publicado el <time dateTime={existing.createdAt}>{published.format(new Date(existing.createdAt))}</time></p> : null}
        <TextAreaField label="Texto (opcional)" name="description" rows={6} value={draft.values.description} loading={saving} error={missingContent ? missingContentMessage : errors.description}
          onChange={(event) => update("description", event.target.value)} />
        <TextField label="Ubicación (link de Google Maps, opcional)" name="mapsUrl" type="text" inputMode="url" value={draft.values.mapsUrl} loading={saving}
          error={errors.mapsUrl} onChange={(event) => update("mapsUrl", event.target.value)} />
        <section className="post-link-section" aria-label="Vínculo">
          {draft.extras.transportId ? <div className="post-link-transport">
            <p>Vinculado a un transporte</p>
            <Button disabled={saving} onClick={removeTransport}>Quitar transporte</Button>
          </div> : null}
          <p id="post-link-summary">{newActivity ? `Actividad nueva: ${newActivityLabel(newActivity)}` : linkSummary(draft.extras.link)}</p>
          {newActivity && existing?.activityId ? <p id="post-link-replace" className="itinerary-secondary">Reemplaza el vínculo con la actividad actual</p> : null}
          {newActivity ? <div className="post-link-new-activity">
            <button name="activity" type="button" className="ui-button" disabled={saving} onClick={openActivity}
              aria-describedby={errors.activity ? "post-activity-error" : undefined}>Editar actividad nueva</button>
            <Button disabled={saving} onClick={removeActivity}>Quitar actividad nueva</Button>
          </div> : null}
          {errors.activity ? <p className="ui-field__error" id="post-activity-error" role="alert">{errors.activity}</p> : null}
          <button ref={linkRef} name="link" type="button" className="ui-button" disabled={saving} onClick={openPicker}
            aria-describedby={[errors.link ? "post-link-summary post-link-error" : "post-link-summary", newActivity && existing?.activityId ? "post-link-replace" : ""].filter(Boolean).join(" ")}>Vincular a</button>
          {errors.link ? <p className="ui-field__error" id="post-link-error" role="alert">{errors.link}</p> : null}
          {notice ? <Feedback>{notice}</Feedback> : null}
        </section>
        {message ? <Feedback>{message}</Feedback> : null}
        {failure && failure.kind !== "validation" ? <Feedback variant="error">No pudimos guardar el recuerdo. Revisá tu conexión e intentá nuevamente.
          {newActivity && (failure.kind === "network" || failure.kind === "server") ? ` ${retryHint}` : ""}</Feedback> : null}
        {failure?.kind === "validation" && !errors.link && !errors.activity ? <Feedback variant="error">Revisá los datos del recuerdo.</Feedback> : null}
        <Button type="submit" loading={saving} loadingLabel={existing ? "Guardando…" : "Publicando…"}>
          {existing ? "Guardar cambios" : "Publicar recuerdo"}
        </Button>
        <Button disabled={saving} onClick={cancel}>Cancelar</Button>
      </form> : null}
      {pending ? createPortal(<div className="participation-conflict-layer"><ParticipationConflictModal conflicts={pending.confirmation.confirmedConflicts}
        activities={loadedItinerary?.activities ?? []} timeZone={timeZone} stale={pending.stale} saving={saving}
        onCancel={() => setPending(undefined)} onConfirm={() => { if (!savingRef.current) void send(pending.input, pending.confirmation); }} /></div>, document.body) : null}
      <Modal isOpen={confirmingDiscard} closeOnEscape title="Descartar cambios" onClose={() => setConfirmingDiscard(false)}>
        <p>Si salís ahora, vas a perder los cambios de este recuerdo.</p>
        <button ref={keepRef} className="ui-button" type="button" onClick={() => setConfirmingDiscard(false)}>Seguir editando</button>
        <Button onClick={() => { setConfirmingDiscard(false); leave(); }}>Descartar</Button>
      </Modal>
    </div>
  </main>;
}
