import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Button, Feedback, LoadingState, Modal, TextAreaField, TextField } from "../components/index.js";
import { MAX_AMOUNT_TEXT } from "./amount-limits.js";
import { ParticipationConflictModal } from "./ParticipationConflictModal.js";
import { expenseDraftFromSaved, validateExpense, type SavedExpense } from "./expense-draft.js";
import { mapSplitFieldErrors, sentSplitKeys, type ListErrors, type RowErrors } from "./expense-split.js";
import { formatCents, formatExpenseAmount, formatLocalDate, localDayKey } from "./expense-format.js";
import { PostPhotosSection } from "./PostPhotosSection.js";
import { PublishedPhotosSection } from "./PublishedPhotosSection.js";
import type { PublishedPhoto } from "./trip-photo-api.js";
import { newObjectId } from "./new-object-id.js";
import { newActivityLabel, parseNewActivity, resolveNewActivity } from "./new-activity-draft.js";
import type { ParticipationConfirmation } from "./participation-conflict.js";
import { canGoBack, readOrigin, originHref, withNoBack } from "./post-origin.js";
import { activityParam, clearExpense, draftFromPost, draftKeyFor, emptyDraft, hasContent, isDraftDirty, prepareCreate, prepareExpenseOnlyUpdate, prepareUpdate, setExpense, setLink, setNewActivity, setRemoveExpense, setTransport, toggleRemovePhoto, type PostDraft, type ResolvedNewActivity } from "./post-draft.js";
import { commentLength } from "./comment-text.js";
import { loadPeople, unknownPeople, type PhotoPeople } from "./photo-people.js";
import { canEditContent } from "./authorship.js";
import type { TripMembersApi } from "./trip-members-api.js";
import { POST_DESCRIPTION_MAX, descriptionTooLong } from "./post-text-limits.js";
import { linkSummary } from "./post-link-options.js";
import type { TripItineraryApi, TripItineraryResponse } from "./trip-itinerary-api.js";
import type { TripFailure } from "./trip-management-api.js";
import type { PostInput, PostResponse, SavedExpenseView, TripPostApi } from "./trip-post-api.js";
import { LocationPreview } from "./LocationPreview.js";
import { usePostDraft } from "./use-post-drafts.js";
import { usePostPhotos, type PostPhotoDeps, type UploadOutcome } from "./use-post-photos.js";
import "./itinerary.css";
import "./expenses.css";

/** `photos` is optional: without it the composer shows no photo section (nothing about photos reaches the form). */
export type PostComposerProps = { posts: Pick<TripPostApi, "create" | "update" | "get">; itinerary: Pick<TripItineraryApi, "get">; timeZone?: string; photos?: PostPhotoDeps;
  /** Only read when editing: who the author is decides whether the content is editable (T125). Without it «Editar» is offered and the server decides. */
  members?: Pick<TripMembersApi, "list">;
  /** Creates the retry id of a publication attempt (24 lowercase hex). Injectable for tests; defaults to `newObjectId`. */
  newId?: () => string };
/** A conflict answer waits here for an explicit decision: the same entry is resent with the confirmation, or dropped on cancel. */
type PendingConfirmation = { input: PostInput; confirmation: ParticipationConfirmation; stale: boolean };
type Loaded = { kind: "loading" } | { kind: "ready"; post?: PostResponse; expense?: SavedExpenseView } | { kind: "error"; error: TripFailure };
/** The stored expense (and the dates it is attributed to) as read from the itinerary, which is where a post carries it. */
type ExpenseLoad = { kind: "loading" } | { kind: "error" } | { kind: "ready"; saved?: SavedExpense; attribution?: { source: "activity" | "publication"; occurredAt: string; publishedAt: string } };
const removedExpenseText = "Gasto: se quitará al guardar. Dejará de figurar en el registro y en el balance.";
const notInPostMessage = "Una foto que querías quitar ya no pertenece a este recuerdo. Actualizamos la lista.";
const removeWithActivityMessage = "No se pueden quitar fotos y crear una actividad nueva en el mismo guardado. Deshacé la quita de fotos o quitá la actividad nueva.";
/** The published photos of the post being edited (author only): read once when editing, never kept in the draft. */
type PublishedLoad = { kind: "idle" } | { kind: "loading" } | { kind: "ready"; items: PublishedPhoto[] } | { kind: "error" };
const objectId = (value: string) => /^[0-9a-f]{24}$/.test(value);
const expenseWaitMessage = "Esperá a que cargue el gasto guardado para guardar los cambios.";
const exceedsMessage = "El nuevo importe queda por debajo de pagos o partes fijas ya registrados. Ajustalos en Pagos y reparto.";
const splitRowsMessage = "Revisá pagos y reparto: no pudimos guardar algunas filas.";
const splitFieldPattern = /^expense\.(payments|shares)\b/;
const breakdownLimitMessage = "El desglose del gasto supera el máximo de 2000 caracteres. Editá el gasto.";
const descriptionLimitMessage = `El texto supera el máximo de ${POST_DESCRIPTION_MAX} caracteres.`;
const expenseFieldMessage = (field: string, code: string): string | undefined => {
  if (splitFieldPattern.test(field) && code === "exceeds_total") return exceedsMessage;
  if (field === "expense.breakdown" && code === "too_long") return breakdownLimitMessage;
  if (field === "expense.totalAmount" && code === "exceeds_max") return `El importe no puede superar ${MAX_AMOUNT_TEXT}. No lo redondeamos por vos.`;
  if (field === "expense.totalAmount" && (code === "invalid" || code === "required")) return "Revisá el importe del gasto.";
  if (field === "expense.currency" && (code === "invalid" || code === "required")) return "Elegí la moneda del gasto.";
  return field.startsWith("expense.") ? "No pudimos guardar el gasto. Revisá sus datos." : undefined;
};
const lockedNotice = "Solo el autor puede editar el contenido; podés editar el gasto y el reparto.";
const authorOnlyMessage = "Solo el autor puede editar el contenido de este recuerdo. Tu borrador se conserva.";
const missingContentMessage = "Escribí un texto o agregá una ubicación.";
const missingContentWithPhotosMessage = "Escribí un texto, agregá una ubicación o elegí una foto.";
const fieldMessages: Record<string, string> = { description: "Revisá el texto del recuerdo.", mapsUrl: "Revisá el link de la ubicación." };
const linkFields = ["parentPostId", "activityId", "transportId"];
const windowMessage = "Elegí un horario dentro de la franja de actividad del destino.";
const activityMessage = (field: string, code: string) => field === "title" ? "Ingresá un título para la actividad."
  : field === "durationMinutes" ? code === "outside_window" ? "La actividad terminaría después de la salida del destino. Acortá la duración o elegí otro horario." : "Revisá la duración estimada."
  : field === "scheduledAt" || field === "dayId" ? windowMessage : undefined;
const retryHint = "Revisá tus recuerdos antes de reintentar por si ya se publicó.";
/** With a retry id the server recognizes a repeated request, so retrying cannot publish twice. */
const safeRetryHint = "Podés reintentar: el recuerdo no se va a publicar dos veces.";
const isGenericRequestConflict = (error: TripFailure) => error.kind === "server" && error.code === "PostRequestConflictError";
const withoutAttempt = (draft: PostDraft, which: "attemptId" | "activityAttemptId"): PostDraft => { const next = { ...draft }; delete next[which]; return next; };
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

export function PostComposer({ posts, itinerary, photos, members, newId, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone }: PostComposerProps) {
  const { tripId, postId } = useParams();
  return <Composer key={`${tripId}/${postId ?? "new"}`} tripId={tripId} postId={postId} posts={posts} itinerary={itinerary} photos={photos} members={members} newId={newId ?? newObjectId} timeZone={timeZone} />;
}

function Composer({ tripId, postId, posts, itinerary, photos, members, timeZone, newId }: Omit<PostComposerProps, "timeZone" | "newId"> & { timeZone: string; newId: () => string; tripId?: string; postId?: string }) {
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
  const focusExpense = useRef(entry?.focus === "expense");
  const focusSplit = useRef(entry?.focus === "split");
  const expenseRef = useRef<HTMLButtonElement>(null);
  const splitRef = useRef<HTMLButtonElement>(null);
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
  /** The published photo ids behind the `removePhotos` of the input last sent, by position. */
  const sentRemoveIds = useRef<readonly string[]>([]);
  /** The row keys behind the `payments` and `shares` of the input last sent, by position (as `sentPhotoIds`). */
  const sentSplit = useRef<{ payments: readonly string[]; shares: readonly string[] }>({ payments: [], shares: [] });
  /** Rows and lists the server rejected, to open the editor on them. */
  const [splitErrors, setSplitErrors] = useState<{ rowErrors: RowErrors; listErrors: ListErrors }>();
  const focusPending = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const listing = `/trips/${tripId}/memories`;
  const existing = loaded.kind === "ready" ? loaded.post : undefined;
  // Editing only: the author decides who edits the content (T124). The form never waits for this read; a failed one leaves everything editable.
  const [people, setPeople] = useState<PhotoPeople>(unknownPeople);
  useEffect(() => {
    if (!postId || !tripId || !members) return;
    let cancelled = false;
    void loadPeople(members, tripId).then((result) => { if (!cancelled) setPeople(result); });
    return () => { cancelled = true; };
  }, [postId, tripId, members]);
  const contentLocked = existing !== undefined && people.loaded && !canEditContent(people, existing.authorId);
  const [publishedLoad, setPublishedLoad] = useState<PublishedLoad>({ kind: "idle" });
  const [publishedAttempt, setPublishedAttempt] = useState(0);
  const listPublished = photos?.api.listForPost;
  const existingId = existing?.id;
  // Only the author removes photos: a member limited to the expense never lists them.
  const wantsPublished = existingId !== undefined && listPublished !== undefined && !contentLocked && tripId !== undefined;
  useEffect(() => {
    if (!wantsPublished || !existingId || !tripId || !listPublished) return;
    let cancelled = false;
    setPublishedLoad((current) => current.kind === "ready" ? current : { kind: "loading" });
    void (async () => {
      try {
        const result = await listPublished(tripId, existingId);
        if (!cancelled) setPublishedLoad(result.ok ? { kind: "ready", items: result.value } : { kind: "error" });
      } catch { if (!cancelled) setPublishedLoad({ kind: "error" }); }
    })();
    return () => { cancelled = true; };
  }, [wantsPublished, existingId, tripId, listPublished, publishedAttempt]);

  useEffect(() => {
    if (!postId) return;
    let cancelled = false;
    const load = async () => {
      if (!tripId) { setLoaded({ kind: "error", error: { kind: "not-found" } }); return; }
      setLoaded({ kind: "loading" });
      try {
        const result = await posts.get(tripId, postId);
        if (!cancelled) setLoaded(result.ok ? { kind: "ready", post: result.value.post, ...(result.value.expense ? { expense: result.value.expense } : {}) } : { kind: "error", error: result.error });
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
    const first = missingContent ? "description" : ["description", "mapsUrl", "link", "activity", "expense"].find((name) => errors[name]);
    if (first) formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
    focusPending.current = false;
  }, [errors, saving, missingContent]);
  // Back from a subform: the focus returns to the button that opened it.
  useEffect(() => {
    if (loaded.kind !== "ready") return;
    if (focusLink.current) { linkRef.current?.focus(); focusLink.current = false; }
    if (focusExpense.current) { expenseRef.current?.focus(); focusExpense.current = false; }
    if (focusSplit.current) { splitRef.current?.focus(); focusSplit.current = false; }
  }, [loaded.kind]);

  const [expenseLoad, setExpenseLoad] = useState<ExpenseLoad>(postId ? { kind: "loading" } : { kind: "ready" });
  const [expenseAttempt, setExpenseAttempt] = useState(0);
  const savedExpense = expenseLoad.kind === "ready" ? expenseLoad.saved : undefined;
  // The stored payments and shares come from the post detail (the itinerary does not carry them).
  const storedView = loaded.kind === "ready" ? loaded.expense : undefined;
  const saved: PostDraft = existing ? draftFromPost(existing) : emptyDraft();
  // A transport preloaded from its detail (creation only) is part of the base (it is not a change); a continuation memory keeps no transport.
  const preloaded = postId ? null : transportParam(location.search);
  // A continuation opened from a detail preloads its parent (creation only); the parent wins over a transport and is not a change either.
  const preloadedParent = postId ? null : parentParam(location.search);
  // A memory shared from an activity preloads it (creation only); precedence parent > activity > transport, so no relation is mixed (a child keeps none other).
  const preloadedActivity = postId ? undefined : activityParam(location.search);
  const base: PostDraft = preloadedParent ? setLink(saved, { kind: "post", id: preloadedParent, label: parentLabelOf(location.state) })
    : preloadedActivity ? setLink(saved, { kind: "activity", id: preloadedActivity, label: activityLabelOf(location.state) })
    : preloaded && saved.extras.transportId === null && saved.extras.link?.kind !== "post" ? setTransport(saved, preloaded) : saved;
  // An existing draft (for example after a subform or an error) always wins over the saved values.
  const draft: PostDraft = handle.draft ?? base;
  // The base carries the stored expense only to compare: the draft keeps `null` («untouched») until the expense is edited.
  const splitTouched = draft.extras.split.payments !== null || draft.extras.split.shares !== null;
  const dirty = isDraftDirty(draft, setExpense(base, savedExpense ? expenseDraftFromSaved(savedExpense) : null));
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
  // Editing: read what is stored for the expense (the itinerary is where the post carries it). A failure is shown with a retry, never silent.
  useEffect(() => {
    if (!postId || loaded.kind !== "ready" || !tripId) return;
    let cancelled = false;
    setExpenseLoad({ kind: "loading" });
    void loadItinerary().then((value) => {
      if (cancelled) return;
      if (!value) { setExpenseLoad({ kind: "error" }); return; }
      try {
        const stored = [...value.posts, ...value.unplacedPosts].find((item) => item.id === postId)?.expense;
        const row = value.expenses.find((item) => item.postId === postId);
        setExpenseLoad({ kind: "ready", ...(stored ? { saved: { totalAmount: stored.totalAmount, currency: stored.currency, breakdown: stored.breakdown } } : {}),
          ...(row ? { attribution: { source: row.source, occurredAt: row.occurredAt, publishedAt: row.publishedAt } } : {}) });
      } catch { setExpenseLoad({ kind: "error" }); }
    });
    return () => { cancelled = true; };
  }, [postId, tripId, loaded.kind, expenseAttempt]); // eslint-disable-line react-hooks/exhaustive-deps
  const wantsItinerary = newActivity !== null;
  useEffect(() => { if (wantsItinerary && tripId) void loadItinerary(); }, [wantsItinerary, tripId]); // eslint-disable-line react-hooks/exhaustive-deps
  const update = (field: "description" | "mapsUrl", value: string) => {
    handle.setDraft({ ...draft, values: { ...draft.values, [field]: value } });
    setErrors((current) => { const next = { ...current }; delete next[field]; return next; });
    setFailure(undefined); setMessage(""); setMissingContent(false);
  };
  const fail = (error: TripFailure) => {
    setFailure(error);
    // A 403 when editing means the role changed: read the members again so the form switches to the limited mode.
    if (error.kind === "forbidden" && postId && tripId && members) void loadPeople(members, tripId).then(setPeople);
    if (error.kind === "validation") {
      const mapped: Record<string, string> = {};
      const splitFields: { field: string; code?: string }[] = [];
      let focusContent = false;
      for (const { field, code } of error.fields ?? []) {
        // A rejected retry id is dropped: the next attempt creates a fresh one (nothing was saved with it).
        if (field === "id") applyDraft((current) => withoutAttempt(current, "attemptId"));
        if (field === "newActivity.id") applyDraft((current) => withoutAttempt(current, "activityAttemptId"));
        const photoField = /^photos\[(\d+)\]/.exec(field);
        if (photoField) {
          // The index is the position in what was sent; it is resolved through the ids kept when the input was built (not the current draft order).
          const sent = sentPhotoIds.current[Number(photoField[1])];
          if (sent !== undefined) photosCtl.markFailed(sent, code ?? "invalid");
          mapped.photos = badPhotoMessage; setFocusRetry((value) => value + 1);
        } else if (/^removePhotos\[(\d+)\]/.test(field)) {
          // The photo belongs to another memory (or is not removable): it is dropped from the marks and the list is read again.
          const sent = sentRemoveIds.current[Number(/^removePhotos\[(\d+)\]/.exec(field)![1])];
          if (sent !== undefined) applyDraft((current) => ({ ...current, extras: { ...current.extras, removePhotoIds: current.extras.removePhotoIds.filter((item) => item !== sent) } }));
          mapped.photos = notInPostMessage; setPublishedAttempt((value) => value + 1);
        } else if (field === "removePhotos") mapped.photos ??= removeWithActivityMessage;
        else if (field === "photos") mapped.photos ??= photosFieldMessage;
        else if (linkFields.includes(field)) mapped.link ??= linkMessage(code ?? "");
        else if (field === "description") {
          // The server decides the content rule and the limit: both stay on the field and the draft is kept.
          if (code === "required") { setMissingContent(true); focusContent = true; }
          else mapped.description = code === "too_long" ? descriptionLimitMessage : fieldMessages.description!;
        }
        else if (field in fieldMessages) mapped[field] = fieldMessages[field]!;
        else if (splitFieldPattern.test(field)) splitFields.push({ field, code });
        else if (expenseFieldMessage(field, code ?? "")) {
          // A payments conflict is the most specific answer; otherwise the first expense problem wins.
          const message = expenseFieldMessage(field, code ?? "")!;
          if (message === exceedsMessage || mapped.expense === undefined) mapped.expense = message;
        }
        else if (newActivity !== null && activityMessage(field, code ?? "")) mapped.activity ??= activityMessage(field, code ?? "")!;
      }
      if (splitFields.length > 0) {
        // Rows are placed through the keys sent; whatever cannot be placed stays a general expense error.
        const placed = mapSplitFieldErrors(splitFields, sentSplit.current);
        if (placed.handled) {
          setSplitErrors({ rowErrors: placed.rowErrors, listErrors: placed.listErrors });
          mapped.expense = Object.keys(placed.listErrors).length > 0 ? exceedsMessage : splitRowsMessage;
        } else mapped.expense ??= expenseFieldMessage(splitFields[0]!.field, "")!;
      }
      setErrors(mapped); focusPending.current = focusContent || Object.keys(mapped).some((name) => name !== "photos");
    }
  };
  const unavailable = (kind: string) => kind === "not-found" || kind === "forbidden";
  /** What a failed save blocks: when editing, a 403 is about authorship (the form stays with its draft), never «no longer available». */
  const blocksSave = (kind: string) => kind === "not-found" || (kind === "forbidden" && !existing);
  /** What the person is told when the photos did not finish uploading; true means every photo is ready to be sent. */
  const settleUpload = (outcome: UploadOutcome, publishing: boolean): boolean => {
    if (outcome.kind === "ready") return true;
    if (outcome.kind === "aborted") return false;
    const unsaved = !publishing ? "" : existing ? " El recuerdo no cambió." : " El recuerdo no se publicó.";
    if (outcome.kind === "error") {
      if (blocksSave(outcome.error.kind) || outcome.error.kind === "forbidden" || outcome.error.kind === "unauthorized") fail(outcome.error);
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
  /**
   * The retry ids of this attempt live in the draft: created the first time an input is built and reused by every retry (a failure, a cancelled or
   * confirmed schedule modal, an edited text), so the server can recognize a repeated request. Creating needs the post id; editing needs the activity id only when it creates one.
   */
  const withAttempt = (source: PostDraft): PostDraft => {
    const needPost = !existing && source.attemptId === undefined, needActivity = existing !== undefined && source.extras.newActivity !== null && source.activityAttemptId === undefined;
    if (!needPost && !needActivity) return source;
    const next: PostDraft = { ...source, ...(needPost ? { attemptId: newId() } : {}), ...(needActivity ? { activityAttemptId: newId() } : {}) };
    applyDraft(() => next);
    return next;
  };
  const buildInput = (plain: PostDraft, resolved?: ResolvedNewActivity): PostInput => {
    const source = withAttempt(plain);
    // Same selection as the input's `photos` (uploaded ones, in order): index i of a 422 `photos[i]` is the photo with this id.
    sentPhotoIds.current = source.extras.photos.filter((item) => item.status === "uploaded" && item.key !== undefined).map((item) => item.localId);
    sentSplit.current = sentSplitKeys(source.extras.split);
    sentRemoveIds.current = source.extras.removePhotoIds.filter(objectId);
    return existing ? prepareUpdate(source, existing, resolved, savedExpense, storedView) : prepareCreate(source, resolved);
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingRef.current || photosCtl.isBusy() || !tripId) return;
    setMessage(""); setFailure(undefined); setErrors({}); setSplitErrors(undefined); setMissingContent(false); setNotice(""); setPhotoError(undefined);
    // Not the author: only the expense travels; the content, links and photos of the draft are never read (T125).
    if (existing && contentLocked) {
      if ((draft.extras.expense !== null || splitTouched || draft.extras.removeExpense) && expenseLoad.kind !== "ready") { setMessage(expenseWaitMessage); return; }
      const input = prepareExpenseOnlyUpdate(draft, savedExpense, storedView);
      if (Object.keys(input).length === 0) { setMessage("No hay cambios para guardar."); return; }
      await send(input, undefined);
      return;
    }
    // Creating always needs text, a location or a photo; editing only when the text or the location changed and nothing is left, counting the
    // photos already published (an existing memory can be relinked without them).
    const textChanged = draft.values.description !== base.values.description || draft.values.mapsUrl !== base.values.mapsUrl;
    if (descriptionTooLong(draft.values.description)) { setErrors({ description: descriptionLimitMessage }); focusPending.current = true; return; }
    const removedIds = draft.extras.removePhotoIds;
    // Removing published photos and creating an activity are two different requests: never chained (a failure would leave half of it applied).
    if (existing && removedIds.length > 0 && draft.extras.newActivity !== null) { setErrors({ photos: removeWithActivityMessage }); return; }
    const empty = !hasContent(draft);
    if (empty && !existing) { setMissingContent(true); focusPending.current = true; return; }
    // The published photos only count when this edit would leave neither text nor location (the text was cleared or the last photos are removed).
    // With the list loaded it is local, minus the marked ones; otherwise the count is read now, lazily. A failed read never blocks: the server applies the rule.
    if (empty && existing && (textChanged || removedIds.length > 0)) {
      let left: number | undefined;
      if (wantsPublished && publishedLoad.kind === "ready") left = publishedLoad.items.filter((item) => !removedIds.includes(item.id)).length;
      else if (textChanged && photos?.api.countForPost) {
        savingRef.current = true; setSaving(true);
        try { const counted = await photos.api.countForPost(tripId, existing.id); left = counted.ok ? counted.value : undefined; } catch { left = undefined; }
        finally { savingRef.current = false; setSaving(false); }
      }
      if (left === 0) { setMissingContent(true); focusPending.current = true; return; }
    }
    const resolved = resolveActivity();
    if (resolved === "invalid") return;
    // A changed expense is a merge-patch against the stored one: it cannot be built until that is known.
    if (existing && (draft.extras.expense !== null || splitTouched || draft.extras.removeExpense) && expenseLoad.kind !== "ready") { setMessage(expenseWaitMessage); return; }
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
  /**
   * Saves memory and activity together; a confirmation from a previous 409 is forwarded unchanged. Nothing is announced unless everything was saved.
   * `retried` marks the single automatic retry after a generic 409 (the id was taken by someone else): it uses a new id and never repeats again.
   */
  const send = async (input: PostInput, confirmation: ParticipationConfirmation | undefined, retried = false) => {
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
        if (backToBalance()) return;
        navigate(listing, { state: { post, going: participation?.status === "going",
          notice: activity ? (existing ? "linked-activity" : "created-activity") : existing ? "updated" : "created" } });
      } else if (result.error.kind === "already-saved") {
        // The same attempt was saved before (a lost answer): never republish. The draft is dropped and the saved memory is one tap away in the listing.
        const savedId = existing ? existing.id : result.error.postId;
        setPending(undefined);
        handle.clear();
        navigate(listing, { state: { notice: "already-saved", ...(savedId !== undefined ? { postId: savedId } : {}) } });
      } else if (result.error.kind === "participation-conflict" && result.error.confirmation) {
        setPending({ input, confirmation: result.error.confirmation, stale: confirmation !== undefined });
      } else if (!retried && isGenericRequestConflict(result.error) && (existing ? input.newActivity?.id !== undefined : input.id !== undefined)) {
        // The id belongs to someone else (not a retry of ours): a fresh one, same content, once.
        const fresh = newId();
        applyDraft((current) => existing ? { ...current, activityAttemptId: fresh } : { ...current, attemptId: fresh });
        await send(existing && input.newActivity ? { ...input, newActivity: { ...input.newActivity, id: fresh } } : { ...input, id: fresh }, confirmation, true);
      } else { setPending(undefined); fail(result.error); }
    } catch { setPending(undefined); fail({ kind: "network" }); }
    finally { savingRef.current = false; setSaving(false); }
  };
  const composerPath = `/trips/${tripId}/memories/${postId ? `${postId}/edit` : "new"}`;
  // The draft is materialized first: in an edit it does not exist until something changes, and the selector needs it.
  const openPicker = () => { handle.setDraft(draft); navigate(`${composerPath}/link${location.search}`, { state: { fromComposer: true } }); };
  const openActivity = () => { handle.setDraft(draft); navigate(`${composerPath}/activity${location.search}`, { state: { fromComposer: true } }); };
  const openExpense = () => {
    if (expenseLoad.kind !== "ready") return;
    handle.setDraft(draft); navigate(`${composerPath}/expense${location.search}`, { state: { fromComposer: true } });
  };
  const openSplit = (adjust?: { rowErrors: RowErrors; listErrors: ListErrors }) => {
    if (expenseLoad.kind !== "ready") return;
    handle.setDraft(draft); navigate(`${composerPath}/expense/split${location.search}`, { state: { fromComposer: true, ...adjust } });
  };
  const removeExpense = () => {
    // A new expense takes its payments and shares with it.
    handle.setDraft(clearExpense(draft)); setSplitErrors(undefined); setNotice(""); setErrors((current) => { const next = { ...current }; delete next.expense; return next; });
    expenseRef.current?.focus();
  };
  /** The saved expense is only marked: it is removed when the memory is saved, and «Conservar gasto» undoes it. */
  const expenseSection = useRef<HTMLElement>(null);
  const expenseFocus = useRef<"keep" | "remove" | undefined>(undefined);
  const markRemoveSaved = () => {
    handle.setDraft(setRemoveExpense(draft, true)); setSplitErrors(undefined); setNotice(""); expenseFocus.current = "keep";
    setErrors((current) => { const next = { ...current }; delete next.expense; return next; });
  };
  const keepSaved = () => { handle.setDraft(setRemoveExpense(draft, false)); expenseFocus.current = "remove"; };
  const removingExpense = draft.extras.removeExpense;
  useEffect(() => {
    const target = expenseFocus.current;
    if (!target) return;
    expenseFocus.current = undefined;
    expenseSection.current?.querySelector<HTMLElement>(target === "keep" ? 'button[name="keepExpense"]' : 'button[name="removeExpense"]')?.focus();
  }, [removingExpense]);
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
  /**
   * An edit opened from the balance (T85) returns to it, saving or leaving: `-1` when there is app history (its entry keeps the restore state),
   * otherwise the entry is replaced by the balance carrying the place to find again. Returns whether it navigated.
   */
  const backToBalance = () => {
    const origin = readOrigin(location.state, tripId ?? "");
    if (!postId || origin.label !== "balance") return false;
    if (leaving.current) return true;
    if (canGoBack(location)) { leaving.current = true; navigate(-1); }
    else navigate(originHref(origin), { replace: true, state: withNoBack(origin.anchor !== undefined && origin.scrollY !== undefined ? { restore: { anchor: origin.anchor, scrollY: origin.scrollY } } : undefined) });
    return true;
  };
  const leave = () => {
    if (leaving.current) return;
    handle.clear();
    if (backToBalance()) return;
    const origin = readOrigin(location.state, tripId ?? "");
    if (postId && origin.label !== "recuerdo") { navigate(listing); return; }
    if ((origin.label === "recuerdo" || origin.label === "actividad" || origin.label === "transporte") && canGoBack(location)) { leaving.current = true; navigate(-1); }
    else navigate(originHref(origin), { replace: true, state: withNoBack() });
  };
  const cancel = () => { if (dirty) setConfirmingDiscard(true); else leave(); };
  const published = existing ? new Intl.DateTimeFormat("es-AR", { timeZone, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : undefined;

  const blocked = loaded.kind === "error" ? loaded.error : failure && (blocksSave(failure.kind) || failure.kind === "unauthorized") ? failure : undefined;
  const authorOnly = failure?.kind === "forbidden" && existing !== undefined;
  // Creating always carries its id once an input was built; editing only when it creates an activity (a plain PATCH has no id and keeps the old hint).
  const safeRetry = existing ? newActivity !== null && draft.activityAttemptId !== undefined : draft.attemptId !== undefined;
  const photoConflict = failure?.code === "PhotoConflictError";
  const conflictAlert: ReactNode = photoConflict ? <>Revisá tus recuerdos antes de reintentar; puede que ya esté publicado. <Link to={listing}>Ver recuerdos</Link></> : undefined;
  const photoAlert: ReactNode = photoError || errors.photos || conflictAlert || photosCtl.message || undefined;
  const hasText = draft.values.description.trim() !== "" || draft.values.mapsUrl.trim() !== "";
  // What the section shows: the expense of the draft if it was edited, otherwise the stored one.
  const typed = draft.extras.expense !== null ? validateExpense(draft.extras.expense) : undefined;
  const expenseText = typed?.ok ? `${formatCents(typed.cents, typed.value.currency)}${typed.value.breakdown ? ` · ${typed.value.breakdown}` : ""}`
    : typed ? "sin completar" : savedExpense ? `${formatExpenseAmount(savedExpense)}${savedExpense.breakdown ? ` · ${savedExpense.breakdown}` : ""}` : undefined;
  // The stored attribution only describes the stored link: if the draft changed the parent, activity or transport it is recalculated on save.
  const linkChanged = draft.extras.link?.kind !== saved.extras.link?.kind || draft.extras.link?.id !== saved.extras.link?.id
    || draft.extras.transportId !== saved.extras.transportId || draft.extras.newActivity !== null;
  const storedAttribution = expenseLoad.kind === "ready" && savedExpense && expenseLoad.attribution?.source === "activity"
    && localDayKey(expenseLoad.attribution.occurredAt, timeZone) !== localDayKey(expenseLoad.attribution.publishedAt, timeZone) ? expenseLoad.attribution : undefined;
  const attribution = linkChanged || removingExpense ? undefined : storedAttribution;
  const attributionStale = linkChanged && !removingExpense && storedAttribution !== undefined;
  return <main className="app-shell trips-shell itinerary-shell">
    <div className="trips-panel">
      <header className="itinerary-header">
        <h1>{contentLocked ? "Editar gasto del recuerdo" : postId ? "Editar recuerdo" : "Nuevo recuerdo"}</h1>
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
        {contentLocked ? <section className="activity-detail" aria-label="Contenido del recuerdo">
          <Feedback>{lockedNotice}</Feedback>
          <p className="itinerary-post-description">{existing?.description?.trim() ? existing.description : "Recuerdo sin texto."}</p>
          <LocationPreview value={existing?.mapsUrl ?? null} context="memory" />
        </section> : <>
        <TextAreaField label="Texto (opcional)" name="description" rows={6} value={draft.values.description} loading={saving} error={missingContent ? photos ? missingContentWithPhotosMessage : missingContentMessage : errors.description}
          onChange={(event) => update("description", event.target.value)} />
        <p className="comment-count">{commentLength(draft.values.description.trim())} / {POST_DESCRIPTION_MAX}</p>
        <TextField label="Ubicación (link de Google Maps, opcional)" name="mapsUrl" type="text" inputMode="url" value={draft.values.mapsUrl} loading={saving}
          error={errors.mapsUrl} onChange={(event) => update("mapsUrl", event.target.value)} />
        <LocationPreview value={draft.values.mapsUrl} context="composer" />
        {photos ? <>
          {wantsPublished ? <>
            {publishedLoad.kind === "loading" ? <LoadingState label="Cargando fotos publicadas…" /> : null}
            {publishedLoad.kind === "error" ? <div className="trips-state">
              <Feedback variant="error">No pudimos cargar las fotos publicadas. Podés seguir editando.</Feedback>
              <Button aria-label="Reintentar fotos publicadas" onClick={() => setPublishedAttempt((value) => value + 1)}>Reintentar</Button>
            </div> : null}
            {publishedLoad.kind === "ready" ? <PublishedPhotosSection items={publishedLoad.items} marked={draft.extras.removePhotoIds} busy={saving || photosCtl.uploading || photosCtl.selecting}
              onToggle={(photoId) => {
                setPhotoError(undefined); setMissingContent(false); setNotice("");
                setErrors((current) => { const next = { ...current }; delete next.photos; return next; });
                applyDraft((current) => toggleRemovePhoto(current, photoId));
              }} /> : null}
          </> : null}
          <PostPhotosSection items={draft.extras.photos} active={photosCtl.active} progress={photosCtl.progress} summary={photosCtl.summary} alert={photoAlert}
          busy={saving || photosCtl.uploading || photosCtl.selecting} focusRetry={focusRetry}
          onAdd={(source) => { setPhotoError(undefined); setMissingContent(false); setNotice(""); return photosCtl.add(source); }}
          onRemove={(localId) => { setPhotoError(undefined); photosCtl.remove(localId); }}
          onMove={(localId, delta) => photosCtl.move(localId, delta)}
          onRetry={(localId) => { setPhotoError(undefined); void photosCtl.retry(localId).then((outcome) => { if (outcome !== "busy") settleUpload(outcome, false); }); }} />
        </> : null}
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
        </>}
        <section className="post-expense-section" aria-label="Gasto" ref={expenseSection}>
          <p id="post-expense-summary">{removingExpense ? removedExpenseText : expenseText !== undefined ? `Gasto: ${expenseText}` : "Sin gasto"}</p>
          {attributionStale ? <p id="post-expense-attribution" className="itinerary-secondary">Se recalcula al guardar</p> : null}
          {attribution ? <p id="post-expense-attribution" className="itinerary-secondary">Gasto atribuido al <span className="expense-date">{formatLocalDate(attribution.occurredAt, timeZone)}</span> (actividad) · Publicado el <span className="expense-date">{formatLocalDate(attribution.publishedAt, timeZone)}</span></p> : null}
          {expenseLoad.kind === "loading" ? <LoadingState label="Cargando gasto…" /> : null}
          {expenseLoad.kind === "error" ? <div className="trips-state">
            <Feedback variant="error">No pudimos cargar el gasto guardado. Revisá tu conexión e intentá nuevamente. Podés seguir editando el texto.</Feedback>
            <Button onClick={() => setExpenseAttempt((value) => value + 1)}>Reintentar</Button>
          </div> : null}
          {removingExpense ? <Button name="keepExpense" disabled={saving} onClick={keepSaved}>Conservar gasto</Button> : <>
            <button ref={expenseRef} name="expense" type="button" className="ui-button ui-button--secondary" disabled={saving} aria-disabled={expenseLoad.kind !== "ready" || undefined} onClick={openExpense}
              aria-describedby={[errors.expense ? "post-expense-summary post-expense-error" : "post-expense-summary", attribution || attributionStale ? "post-expense-attribution" : ""].filter(Boolean).join(" ")}>
              {draft.extras.expense !== null || savedExpense ? "Editar gasto" : "Agregar gasto"}</button>
            {draft.extras.expense !== null && !savedExpense ? <Button disabled={saving} onClick={removeExpense}>Quitar gasto</Button> : null}
            {existing && savedExpense ? <Button name="removeExpense" disabled={saving} onClick={markRemoveSaved}>Quitar gasto</Button> : null}
            <button ref={splitRef} name="split" type="button" className="ui-button ui-button--secondary" disabled={saving} aria-disabled={expenseLoad.kind !== "ready" || undefined}
              aria-describedby={splitTouched ? "post-split-summary" : undefined} onClick={() => openSplit()}>Pagos y reparto</button>
            {splitTouched ? <p id="post-split-summary" className="itinerary-secondary">Pagos y reparto con cambios sin guardar</p> : null}
          </>}
          {errors.expense ? <p className="ui-field__error" id="post-expense-error" role="alert">{errors.expense}</p> : null}
          {splitErrors ? <Button disabled={saving} onClick={() => openSplit(splitErrors)}>Ajustar pagos y reparto</Button> : null}
        </section>
        {message ? <Feedback>{message}</Feedback> : null}
        {authorOnly ? <Feedback variant="error" role="alert">{authorOnlyMessage}</Feedback> : null}
        {failure && failure.kind !== "validation" && !photoConflict && !authorOnly ? <Feedback variant="error">No pudimos guardar el recuerdo. Revisá tu conexión e intentá nuevamente.
          {(safeRetry || newActivity || draft.extras.photos.length > 0 || (!existing && draft.extras.expense !== null)) && (failure.kind === "network" || failure.kind === "server") ? ` ${safeRetry ? safeRetryHint : retryHint}` : ""}</Feedback> : null}
        {failure?.kind === "validation" && !missingContent && !errors.description && !errors.link && !errors.activity && !errors.photos && !errors.expense ? <Feedback variant="error">Revisá los datos del recuerdo.</Feedback> : null}
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
