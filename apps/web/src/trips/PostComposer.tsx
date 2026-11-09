import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button, Feedback, LoadingState, Modal, TextAreaField, TextField } from "../components/index.js";
import { draftFromPost, emptyDraft, hasContent, isDraftDirty, prepareCreate, prepareUpdate, type PostDraft } from "./post-draft.js";
import type { TripFailure } from "./trip-management-api.js";
import type { PostResponse, TripPostApi } from "./trip-post-api.js";
import { usePostDraft } from "./use-post-drafts.js";
import "./itinerary.css";

export type PostComposerProps = { posts: Pick<TripPostApi, "create" | "update" | "get">; timeZone?: string };
type Loaded = { kind: "loading" } | { kind: "ready"; post?: PostResponse } | { kind: "error"; error: TripFailure };
const missingContentMessage = "Escribí un texto o agregá una ubicación.";
const fieldMessages: Record<string, string> = { description: "Revisá el texto del recuerdo.", mapsUrl: "Revisá el link de la ubicación." };

export function PostComposer({ posts, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone }: PostComposerProps) {
  const { tripId, postId } = useParams();
  return <Composer key={`${tripId}/${postId ?? "new"}`} tripId={tripId} postId={postId} posts={posts} timeZone={timeZone} />;
}

function Composer({ tripId, postId, posts, timeZone }: PostComposerProps & { tripId?: string; postId?: string }) {
  const navigate = useNavigate();
  const handle = usePostDraft(postId ? `edit:${postId}` : "new");
  const [loaded, setLoaded] = useState<Loaded>(postId ? { kind: "loading" } : { kind: "ready" });
  const [attempt, setAttempt] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<TripFailure>();
  const [message, setMessage] = useState("");
  const [missingContent, setMissingContent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
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
  // The fields are disabled while saving: focus the first one with an error once the save has settled.
  useEffect(() => {
    if (!focusPending.current || saving) return;
    const first = missingContent ? "description" : ["description", "mapsUrl"].find((name) => errors[name]);
    if (first) formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
    focusPending.current = false;
  }, [errors, saving, missingContent]);

  const base: PostDraft = existing ? draftFromPost(existing) : emptyDraft();
  // An existing draft (for example after a subform or an error) always wins over the saved values.
  const draft: PostDraft = handle.draft ?? base;
  const dirty = isDraftDirty(draft, base);
  const update = (field: "description" | "mapsUrl", value: string) => {
    handle.setDraft({ ...draft, values: { ...draft.values, [field]: value } });
    setErrors((current) => { const next = { ...current }; delete next[field]; return next; });
    setFailure(undefined); setMessage(""); setMissingContent(false);
  };
  const fail = (error: TripFailure) => {
    setFailure(error);
    if (error.kind === "validation") {
      const mapped = Object.fromEntries((error.fields ?? []).filter(({ field }) => field in fieldMessages).map(({ field }) => [field, fieldMessages[field]!]));
      setErrors(mapped); focusPending.current = Object.keys(mapped).length > 0;
    }
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingRef.current || !tripId) return;
    setMessage(""); setFailure(undefined); setErrors({}); setMissingContent(false);
    if (!hasContent(draft)) { setMissingContent(true); focusPending.current = true; return; }
    const input = existing ? prepareUpdate(draft, existing) : prepareCreate(draft);
    if (existing && Object.keys(input).length === 0) { setMessage("No hay cambios para guardar."); return; }
    savingRef.current = true; setSaving(true);
    try {
      const result = existing ? await posts.update(tripId, existing.id, input) : await posts.create(tripId, input);
      if (result.ok) {
        handle.clear();
        navigate(listing, { state: { post: result.value, notice: existing ? "updated" : "created" } });
      } else fail(result.error);
    } catch { fail({ kind: "network" }); }
    finally { savingRef.current = false; setSaving(false); }
  };
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
        {message ? <Feedback>{message}</Feedback> : null}
        {failure && failure.kind !== "validation" ? <Feedback variant="error">No pudimos guardar el recuerdo. Revisá tu conexión e intentá nuevamente.</Feedback> : null}
        {failure?.kind === "validation" ? <Feedback variant="error">Revisá los datos del recuerdo.</Feedback> : null}
        <Button type="submit" loading={saving} loadingLabel={existing ? "Guardando…" : "Publicando…"}>
          {existing ? "Guardar cambios" : "Publicar recuerdo"}
        </Button>
        <Button disabled={saving} onClick={cancel}>Cancelar</Button>
      </form> : null}
      <Modal isOpen={confirmingDiscard} closeOnEscape title="Descartar cambios" onClose={() => setConfirmingDiscard(false)}>
        <p>Si salís ahora, vas a perder los cambios de este recuerdo.</p>
        <button ref={keepRef} className="ui-button" type="button" onClick={() => setConfirmingDiscard(false)}>Seguir editando</button>
        <Button onClick={() => { setConfirmingDiscard(false); leave(); }}>Descartar</Button>
      </Modal>
    </div>
  </main>;
}
