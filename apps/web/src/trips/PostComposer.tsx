import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Button, Feedback, LoadingState, Modal, TextAreaField, TextField } from "../components/index.js";
import { ParticipationConflictModal } from "./ParticipationConflictModal.js";
import { PostPhotosSection } from "./PostPhotosSection.js";
import { newActivityLabel, parseNewActivity, resolveNewActivity } from "./new-activity-draft.js";
import type { ParticipationConfirmation } from "./participation-conflict.js";
import { canGoBack, readOrigin, originHref, withNoBack } from "./post-origin.js";
import { activityParam, draftFromPost, draftKeyFor, emptyDraft, hasContent, isDraftDirty, prepareCreate, prepareUpdate, setLink, setNewActivity, setTransport, type PostDraft, type ResolvedNewActivity } from "./post-draft.js";
import { linkSummary } from "./post-link-options.js";
import type { TripItineraryApi, TripItineraryResponse } from "./trip-itinerary-api.js";
import type { TripFailure } from "./trip-management-api.js";
import type { PostInput, PostResponse, TripPostApi } from "./trip-post-api.js";
import { usePostDraft } from "./use-post-drafts.js";
import { usePostPhotos, type PostPhotoDeps, type UploadOutcome } from "./use-post-photos.js";
import "./itinerary.css";

/** `photos` is optional: without it the composer shows no photo section (nothing about photos reaches the form). */
export type PostComposerProps = { posts: Pick<TripPostApi, "create" | "update" | "get">; itinerary: Pick<TripItineraryApi, "get">; timeZone?: string; photos?: PostPhotoDeps };
/** A conflict answer waits here for an explicit decision: the same entry is resent with the confirmation, or dropped on cancel. */
type PendingConfirmation = { input: PostInput; confirmation: ParticipationConfirmation; stale: boolean };
type Loaded = { kind: "loading" } | { kind: "ready"; post?: PostResponse } | { kind: "error"; error: TripFailure };
const missingContentMessage = "Escribí un texto o agregá una ubicación.";
const missingContentWithPhotosMessage = "Escribí un texto, agregá una ubicación o elegí una foto.";
const fieldMessages: Record<string, string> = { description: "Revisá el texto del recuerdo.", mapsUrl: "Revisá el link de la ubicación." };
const linkFields = ["parentPostId", "activityId", "transportId"];
const windowMessage = "Elegí un horario dentro de la franja de actividad del destino.";
const activityMessage = (field: string, code: string) => field === "title" ? "Ingresá un título para la actividad."
  : field === "durationMinutes" ? code === "outside_window" ? "La actividad terminaría después de la salida del destino. Acortá la duración o elegí otro horario." : "Revisá la duración estimada."
  : field === "scheduledAt" || field === "dayId" ? windowMessage : undefined;
const retryHint = "Revisá tus recuerdos antes de reintentar por si ya se publicó.";
const badPhotoMessage = "Una foto no es válida. Reintentá subirla o quitala.";
const invalidReservedMessage = "Alguna foto no es válida. Revisá las fotos marcadas, quitalas o reemplazalas.";
const photosFieldMessage = "Revisá las fotos: un recuerdo admite hasta 10, en formato JPEG, PNG o WebP.";
const linkMessage = (code: string) => code === "cycle" || code === "self_reference" ? "Ese recuerdo no puede ser el vínculo: crearía un ciclo. Elegí otro."
  : code === "conflict" ? "Un recuerdo continuación no puede tener otro vínculo directo." : "No pudimos aplicar el vínculo. Elegí otro.";
const queryId = (search: string, name: string) => { const value = new URLSearchParams(search).get(name); return value !== null && /^[0-9a-f]{24}$/.test(value) ? value : null; };
const transportParam = (search: string) => queryId(search, "transportId");
const parentParam = (search: string) => queryId(search, "parentPostId");
/** Presentation only: the excerpt of the parent sent by its detail (the id is what travels). */
const parentLabelOf = (state: unknown) => { const label = typeof state === "object" && state !== null ? (state as { parentLabel?: unknown }).parentLabel : undefined; return typeof label === "string" && label.trim() !== "" ? label : undefined; };
/** Presentation only: the title of the activity sent by its dialog (the id is what travels). */
const activityLabelOf = (state: unknown) => { const label = typeof state === "object" && state !== null ? (state as { activityLabel?: unknown }).activityLabel : undefined; return typeof label === "string" && label.trim() !== "" ? label : undefined; };

export function PostComposer({ posts, itinerary, photos, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone }: PostComposerProps) {
  const { tripId, postId } = useParams();
  return <Composer key={`${tripId}/${postId ?? "new"}`} tripId={tripId} postId={postId} posts={posts} itinerary={itinerary} photos={photos} timeZone={timeZone} />;
}

function Composer({ tripId, postId, posts, itinerary, photos, timeZone }: Omit<PostComposerProps, "timeZone"> & { timeZone: string; tripId?: string; postId?: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const handle = usePostDraft(draftKeyFor({ postId, search: location.search }));
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
  const [photoError, setPhotoError] = useState<string>();
  const [focusRetry, setFocusRetry] = useState(0);
  const itineraryRequest = useRef<Promise<TripItineraryResponse | undefined> | undefined>(undefined);
  const hadPending = useRef(false);
  const savingRef = useRef(false);
  /** The photo ids behind the `photos` of the input last sent, by position. */
  const sentPhotoIds = useRef<readonly string[]>([]);
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
  // A continuation opened from a detail preloads its parent (creation only); the parent wins over a transport and is not a change either.
  const preloadedParent = postId ? null : parentParam(location.search);
  // A memory shared from an activity preloads it (creation only); precedence parent > activity > transport, so no relation is mixed (a child keeps none other).
  const preloadedActivity = postId ? undefined : activityParam(location.search);
  const base: PostDraft = preloadedParent ? setLink(saved, { kind: "post", id: preloadedParent, label: parentLabelOf(location.state) })
    : preloadedActivity ? setLink(saved, { kind: "activity", id: preloadedActivity, label: activityLabelOf(location.state) })
    : preloaded &&saved.extras.transportId === null && saved.extras.link?.kind !== "post" ? setTransport(saved, preloaded) : saved;
  // An existing draft (for example after a subform or an error) always wins over the saved values.
  const draft: PostDraft = handle.draft ?? base;
  const dirty = isDraftDirty(draft, base);
  const newActivity = draft.extras.newActivity;
  // Async photo work (selection, uploads) changes the draft long after the render that started it: it reads and writes the latest one here.
  const draftRef = useRef(draft);
  const setDraftRef = useRef(handle.setDraft);
  useEffect(() => { draftRef.current = draft; setDraftRef.current = handle.setDraft; });
  const applyDraft = useCallback((change: (current: PostDraft) => PostDraft) => {
    const next = change(draftRef.current);
    draftRef.current = next; setDraftRef.current(next);
  }, []);
  const photosCtl = usePostPhotos({ deps: photos, tripId, blobs: handle.blobs, getDraft: () => draftRef.current, applyDraft, isSaving: () => savingRef.current });
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
        const photoField = /^photos\[(\d+)\]/.exec(field);
        if (photoField) {
          // The index is the position in what was sent; it is resolved through the ids kept when the input was built (not the current draft order).
          const sent = sentPhotoIds.current[Number(photoField[1])];
          if (sent !== undefined) photosCtl.markFailed(sent, code ?? "invalid");
          mapped.photos = badPhotoMessage; setFocusRetry((value) => value + 1);
        } else if (field === "photos") mapped.photos ??= photosFieldMessage;
        else if (linkFields.includes(field)) mapped.link ??= linkMessage(code ?? "");
        else if (field in fieldMessages) mapped[field] = fieldMessages[field]!;
        else if (newActivity !== null && activityMessage(field, code ?? "")) mapped.activity ??= activityMessage(field, code ?? "")!;
      }
      setErrors(mapped); focusPending.current = Object.keys(mapped).some((name) => name !== "photos");
    }
  };
  const unavailable = (kind: string) => kind === "not-found" || kind === "forbidden";
  /** What the person is told when the photos did not finish uploading; true means every photo is ready to be sent. */
  const settleUpload = (outcome: UploadOutcome, publishing: boolean): boolean => {
    if (outcome.kind === "ready") return true;
    if (outcome.kind === "aborted") return false;
    const unsaved = !publishing ? "" : existing ? " El recuerdo no cambió." : " El recuerdo no se publicó.";
    if (outcome.kind === "error") {
      if (unavailable(outcome.error.kind) || outcome.error.kind === "unauthorized") fail(outcome.error);
      // A validation failure of the reservation already marked each photo it names (by its place in the reserved batch): point to them.
      else if (outcome.error.kind === "validation" && (outcome.error.fields?.length ?? 0) > 0) setPhotoError(`${invalidReservedMessage}${unsaved}`);
      else setPhotoError(`No pudimos subir las fotos. Revisá tu conexión e intentá nuevamente.${unsaved}`);
      if (outcome.failed > 0) setFocusRetry((value) => value + 1);
      return false;
    }
    const many = outcome.failed > 1;
    setPhotoError(`${many ? `${outcome.failed} fotos no se subieron` : "Una foto no se subió"}. Reintentá o quitá ${many ? "esas fotos" : "esa foto"}.${unsaved}`);
    setFocusRetry((value) => value + 1);
    return false;
  };
  /** The schedule of a new activity resolved once per attempt; `"invalid"` means the form already shows why. */
  const resolveActivity = (): ResolvedNewActivity | undefined | "invalid" => {
    if (newActivity === null) return undefined;
    // With the itinerary loaded the schedule is validated here too; without it the server decides.
    const result = loadedItinerary ? resolveNewActivity(newActivity, { days: loadedItinerary.days, timeZone, tripId: tripId ?? "" }) : parseNewActivity(newActivity, timeZone);
    if (!result.ok) {
      setErrors({ activity: Object.values(result.errors)[0] ?? windowMessage }); focusPending.current = true;
      return "invalid";
    }
    return result.value;
  };
  /** Built once per attempt, from the draft as it is after the uploads: a confirmed retry resends this very input. */
  const buildInput = (source: PostDraft, resolved?: ResolvedNewActivity): PostInput => {
    // Same selection as the input's `photos` (uploaded ones, in order): index i of a 422 `photos[i]` is the photo with this id.
    sentPhotoIds.current = source.extras.photos.filter((item) => item.status === "uploaded" && item.key !== undefined).map((item) => item.localId);
    return existing ? prepareUpdate(source, existing, resolved) : prepareCreate(source, resolved);
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingRef.current || photosCtl.isBusy() || !tripId) return;
    setMessage(""); setFailure(undefined); setErrors({}); setMissingContent(false); setNotice(""); setPhotoError(undefined);
    // Creating always needs text, a location or a photo; editing only when the text or the location changed and nothing is left
    // (an existing memory can be relinked without them).
    const textChanged = draft.values.description !== base.values.description || draft.values.mapsUrl !== base.values.mapsUrl;
    if (!hasContent(draft) && (!existing || textChanged)) { setMissingContent(true); focusPending.current = true; return; }
    const resolved = resolveActivity();
    if (resolved === "invalid") return;
    if (!photos || draft.extras.photos.length === 0) {
      const input = buildInput(draft, resolved);
      if (existing && Object.keys(input).length === 0) { setMessage("No hay cambios para guardar."); return; }
      await send(input, undefined);
      return;
    }
    // Photos first, straight to storage; the post is only sent when every one is uploaded (nothing is published without a photo in silence).
    savingRef.current = true; setSaving(true);
    try {
      if (!settleUpload(await photosCtl.ensureUploaded(), true)) return;
      await send(buildInput(draftRef.current, resolved), undefined);
    } finally { savingRef.current = false; setSaving(false); }
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
  // Leaving a continuation goes back to the detail it came from when that origin is valid for this Trip; otherwise to the diary.
  // From the detail with app history, `-1` returns to that exact entry (its state and root origin intact); otherwise the entry is replaced so Back never reopens the composer.
  // The same applies to a memory shared from the activity dialog: `-1` returns to its entry (URL with `?activity&tab`). `history.go` is asynchronous, so a second
  // Cancelar/Descartar while the first is pending is ignored (the mark is cleared if the location changes without leaving).
  const leaving = useRef(false);
  useEffect(() => { leaving.current = false; }, [location.key]);
  const leave = () => {
    if (leaving.current) return;
    handle.clear();
    const origin = readOrigin(location.state, tripId ?? "");
    if (postId && origin.label !== "recuerdo") { navigate(listing); return; }
    if ((origin.label === "recuerdo" || origin.label === "actividad") && canGoBack(location)) { leaving.current = true; navigate(-1); }
    else navigate(originHref(origin), { replace: true, state: withNoBack() });
  };
  const cancel = () => { if (dirty) setConfirmingDiscard(true); else leave(); };
  const published = existing ? new Intl.DateTimeFormat("es-AR", { timeZone, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : undefined;

  const blocked = loaded.kind === "error" ? loaded.error : failure && (unavailable(failure.kind) || failure.kind === "unauthorized") ? failure : undefined;
  const photoConflict = failure?.code === "PhotoConflictError";
  const conflictAlert: ReactNode = photoConflict ? <>Revisá tus recuerdos antes de reintentar; puede que ya esté publicado. <Link to={listing}>Ver recuerdos</Link></> : undefined;
  const photoAlert: ReactNode = photoError || errors.photos || conflictAlert || photosCtl.message || undefined;
  const hasText = draft.values.description.trim() !== "" || draft.values.mapsUrl.trim() !== "";
  return <main className="app-shell trips-shell itinerary-shell">
    <div className="trips-panel">
      <header className="itinerary-header">
        <h1>{postId ? "Editar recuerdo" : "Nuevo recuerdo"}</h1>
        <p>Contá lo que viviste. La fecha de publicación la asigna la app.</p>
      </header>
      {loaded.kind === "loading" ? <LoadingState label="Cargando recuerdo…" /> : null}
      {blocked && unavailable(blocked.kind) ? <div className="trips-state">
        <Feedback variant="error">Este recuerdo ya no está disponible para tu cuenta.</Feedback>
        {hasText ? <div className="post-unsaved">
          <p>{existing ? "Ya no podés editar este recuerdo. Tu texto sigue acá para que lo copies." : "Tu recuerdo no se publicó. Copiá tu texto antes de salir."}</p>
          {draft.values.description.trim() !== "" ? <textarea readOnly rows={6} aria-label="Texto de tu recuerdo, solo lectura" value={draft.values.description} /> : null}
          {draft.values.mapsUrl.trim() !== "" ? <input readOnly type="text" aria-label="Ubicación de tu recuerdo, solo lectura" value={draft.values.mapsUrl} /> : null}
        </div> : null}
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
        <TextAreaField label="Texto (opcional)" name="description" rows={6} value={draft.values.description} loading={saving} error={missingContent ? photos ? missingContentWithPhotosMessage : missingContentMessage : errors.description}
          onChange={(event) => update("description", event.target.value)} />
        <TextField label="Ubicación (link de Google Maps, opcional)" name="mapsUrl" type="text" inputMode="url" value={draft.values.mapsUrl} loading={saving}
          error={errors.mapsUrl} onChange={(event) => update("mapsUrl", event.target.value)} />
        {photos ? <PostPhotosSection items={draft.extras.photos} active={photosCtl.active} progress={photosCtl.progress} summary={photosCtl.summary} alert={photoAlert}
          busy={saving || photosCtl.uploading || photosCtl.selecting} focusRetry={focusRetry}
          onAdd={(source) => { setPhotoError(undefined); setMissingContent(false); setNotice(""); return photosCtl.add(source); }}
          onRemove={(localId) => { setPhotoError(undefined); photosCtl.remove(localId); }}
          onMove={(localId, delta) => photosCtl.move(localId, delta)}
          onRetry={(localId) => { setPhotoError(undefined); void photosCtl.retry(localId).then((outcome) => { if (outcome !== "busy") settleUpload(outcome, false); }); }} /> : null}
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
        {failure && failure.kind !== "validation" && !photoConflict ? <Feedback variant="error">No pudimos guardar el recuerdo. Revisá tu conexión e intentá nuevamente.
          {(newActivity || draft.extras.photos.length > 0) && (failure.kind === "network" || failure.kind === "server") ? ` ${retryHint}` : ""}</Feedback> : null}
        {failure?.kind === "validation" && !errors.link && !errors.activity && !errors.photos ? <Feedback variant="error">Revisá los datos del recuerdo.</Feedback> : null}
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
