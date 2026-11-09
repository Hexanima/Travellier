import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { Button, Feedback, LoadingState } from "../components/index.js";
import { setLink, type PostDraft, type PostLink } from "./post-draft.js";
import { activityOptionLabel, excludedPostIds, linkSummary, postOptionLabel } from "./post-link-options.js";
import type { TripItineraryApi } from "./trip-itinerary-api.js";
import type { TripResult } from "./trip-management-api.js";
import type { PostResponse, TripPostApi } from "./trip-post-api.js";
import { usePostDraft, type PostDraftHandle } from "./use-post-drafts.js";
import "./itinerary.css";

export type PostLinkPickerProps = { posts: Pick<TripPostApi, "list" | "get">; itinerary: TripItineraryApi; timeZone?: string; onCreateSpontaneous?: () => void };
type Kind = "none" | "post" | "activity";
type Lazy<T> = { kind: "idle" } | { kind: "loading" } | { kind: "ready"; value: T } | { kind: "error" };
type Activity = { id: string; title: string; scheduledAt: string };
export const transportDroppedNotice = "Un recuerdo continuación no mantiene otro vínculo directo; se quitó el transporte.";

/** Loads once, only when `wanted` turns true; a failure is retried explicitly and a ready list is never requested again. */
function useLazy<T>(wanted: boolean, load: () => Promise<TripResult<T>>): [Lazy<T>, () => void] {
  const [state, setState] = useState<Lazy<T>>({ kind: "idle" });
  const [attempt, setAttempt] = useState(0);
  const started = useRef(-1), mounted = useRef(true), loader = useRef(load);
  loader.current = load;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!wanted || started.current === attempt) return;
    started.current = attempt; setState({ kind: "loading" });
    const settle = (next: Lazy<T>) => { if (mounted.current && started.current === attempt) setState(next); };
    loader.current().then((result) => settle(result.ok ? { kind: "ready", value: result.value } : { kind: "error" }), () => settle({ kind: "error" }));
  }, [wanted, attempt]);
  return [state, () => setAttempt((value) => value + 1)];
}

export function PostLinkPicker(props: PostLinkPickerProps) {
  const { tripId, postId } = useParams();
  const handle = usePostDraft(postId ? `edit:${postId}` : "new");
  const { search } = useLocation();
  const composer = `/trips/${tripId}/memories/${postId ? `${postId}/edit` : "new"}${search}`;
  // Opened by URL without a draft (or after a discard): the composer is the only entry point.
  if (!handle.draft) return <Navigate to={composer} replace />;
  return <Picker {...props} tripId={tripId} postId={postId} draft={handle.draft} commit={handle.setDraft} setReturned={handle.setReturned} composer={composer} />;
}

type PickerInnerProps = PostLinkPickerProps & { tripId?: string; postId?: string; draft: PostDraft; commit: (draft: PostDraft) => void; setReturned: PostDraftHandle["setReturned"]; composer: string };

function Picker({ posts, itinerary, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone, onCreateSpontaneous, tripId, postId, draft, commit, setReturned, composer }: PickerInnerProps) {
  const navigate = useNavigate();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [kind, setKind] = useState<Kind>(draft.extras.link?.kind ?? "none");
  const [selected, setSelected] = useState<PostLink | null>(draft.extras.link);
  const [postList, retryPosts] = useLazy<PostResponse[]>(kind === "post", () => posts.list(tripId ?? ""));
  const [activityList, retryActivities] = useLazy<Activity[]>(kind === "activity", async () => {
    const result = await itinerary.get(tripId ?? "");
    return result.ok ? { ok: true, value: result.value.activities } : result;
  });
  // With a real history `navigate(-1)` resolves later (popstate): repeated taps after the first must not leave twice.
  const leaving = useRef(false);
  useEffect(() => { leaving.current = false; headingRef.current?.focus(); }, []);

  const excluded = postList.kind === "ready" ? excludedPostIds(postList.value, postId) : new Set<string>();
  const postOptions = postList.kind === "ready" ? postList.value.filter((item) => !excluded.has(item.id)) : [];
  const activityOptions = activityList.kind === "ready" ? activityList.value.slice().sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt)) : [];
  const chosen = selected?.kind === kind ? selected : null;
  const dropsTransport = kind === "post" && draft.extras.transportId !== null;
  const fromComposer = (useLocation().state as { fromComposer?: boolean } | null)?.fromComposer === true;
  // Coming from the composer, going back pops this entry (no duplicated composer in the history); the focus and the
  // notice travel through the drafts context. Opened directly by URL, the composer replaces this entry.
  const back = (notice?: string) => {
    if (leaving.current) return;
    leaving.current = true;
    const result = { focus: "link" as const, ...(notice ? { notice } : {}) };
    if (fromComposer) { setReturned(result); navigate(-1); } else navigate(composer, { replace: true, state: result });
  };
  const accept = () => {
    const link: PostLink | null = kind === "none" ? null : chosen;
    if (kind !== "none" && !link) return;
    commit(setLink(draft, link));
    back(`Vínculo actualizado: ${linkSummary(link)}.${dropsTransport ? ` ${transportDroppedNotice}` : ""}`);
  };
  const choose = (kindValue: Exclude<Kind, "none">, id: string, label: string) => setSelected({ kind: kindValue, id, label });
  const kinds: [Kind, string][] = [["none", "Sin vínculo"], ["post", "Post"], ["activity", "Actividad"]];

  return <main className="app-shell trips-shell itinerary-shell">
    <div className="trips-panel post-link-picker">
      <header className="itinerary-header">
        <h1 ref={headingRef} tabIndex={-1}>Vincular recuerdo</h1>
        <p>Elegí a qué se vincula este recuerdo. Los cambios se aplican al aceptar.</p>
      </header>
      <div role="radiogroup" aria-label="Vincular a" className="post-link-options">
        {kinds.map(([value, label]) => <label key={value} className="post-link-option">
          <input type="radio" name="link-kind" checked={kind === value} onChange={() => setKind(value)} /> {label}
        </label>)}
      </div>
      {kind === "post" ? <section className="post-link-panel">
        {postList.kind === "loading" || postList.kind === "idle" ? <LoadingState label="Cargando recuerdos…" /> : null}
        {postList.kind === "error" ? <div className="trips-state">
          <Feedback variant="error">No pudimos cargar los recuerdos. Revisá tu conexión e intentá nuevamente.</Feedback>
          <Button onClick={retryPosts}>Reintentar</Button>
        </div> : null}
        {postList.kind === "ready" && postOptions.length === 0 ? <Feedback>Todavía no hay otros recuerdos para vincular.</Feedback> : null}
        {postList.kind === "ready" && postOptions.length > 0 ? <div role="radiogroup" aria-label="Recuerdos disponibles" className="post-link-options">
          {postOptions.map((item) => <label key={item.id} className="post-link-option">
            <input type="radio" name="link-post" checked={chosen?.id === item.id} onChange={() => choose("post", item.id, postOptionLabel(item))} /> {postOptionLabel(item)}
          </label>)}
        </div> : null}
        {dropsTransport ? <p className="itinerary-secondary">Un recuerdo continuación no mantiene otro vínculo directo; se quitará el transporte.</p> : null}
      </section> : null}
      {kind === "activity" ? <section className="post-link-panel">
        {activityList.kind === "loading" || activityList.kind === "idle" ? <LoadingState label="Cargando actividades…" /> : null}
        {activityList.kind === "error" ? <div className="trips-state">
          <Feedback variant="error">No pudimos cargar las actividades. Revisá tu conexión e intentá nuevamente.</Feedback>
          <Button onClick={retryActivities}>Reintentar</Button>
        </div> : null}
        {activityList.kind === "ready" && activityOptions.length === 0 ? <Feedback>Este viaje todavía no tiene actividades.</Feedback> : null}
        {activityList.kind === "ready" && activityOptions.length > 0 ? <div role="radiogroup" aria-label="Actividades disponibles" className="post-link-options">
          {activityOptions.map((item) => <label key={item.id} className="post-link-option">
            <input type="radio" name="link-activity" checked={chosen?.id === item.id} onChange={() => choose("activity", item.id, activityOptionLabel(item, timeZone))} /> {activityOptionLabel(item, timeZone)}
          </label>)}
        </div> : null}
        <button type="button" className="ui-button" disabled={!onCreateSpontaneous} aria-disabled={!onCreateSpontaneous || undefined} onClick={onCreateSpontaneous}>
          {onCreateSpontaneous ? "Crear actividad espontánea" : "Crear actividad espontánea — Disponible próximamente"}
        </button>
      </section> : null}
      <Button disabled={kind !== "none" && chosen === null} onClick={accept}>Aceptar</Button>
      <Button onClick={() => back()}>Cancelar</Button>
    </div>
  </main>;
}
