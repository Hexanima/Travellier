import { useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { Button, Feedback, List, ListItem, LoadingState } from "../components/index.js";
import type { TripFailure } from "./trip-management-api.js";
import type { PostResponse, TripPostApi } from "./trip-post-api.js";
import { PostLink } from "./post-navigation.js";
import { useRestorePosition } from "./use-restore-position.js";
import { inheritNoBack, memoryAnchor } from "./post-origin.js";
import { PostDraftsProvider, useHasPostDrafts } from "./use-post-drafts.js";
import { CommentDraftsProvider, useHasCommentDrafts } from "./use-comment-drafts.js";
import { GalleryProvider, type GalleryProviderProps } from "./use-gallery.js";
import { useInTripShell } from "./trip-state.js";
import type { TripMembersApi } from "./trip-members-api.js";
import { loadPeople, unknownPeople, type PhotoPeople } from "./photo-people.js";
import { canEditContent } from "./authorship.js";
import { useTripRefreshLoader } from "./trip-refresh.js";
import { sameValue } from "./same-value.js";
import { Heading } from "./Heading.js";
import "./itinerary.css";

/** `members` is optional: without it nobody is known and «Editar» is offered to all (the server decides). */
export type TripMemoriesScreenProps = { posts: Pick<TripPostApi, "list">; members?: Pick<TripMembersApi, "list">; timeZone?: string };
type LoadState = { kind: "loading" } | { kind: "ready"; posts: PostResponse[] } | { kind: "error"; error: TripFailure };
/** `*-activity` means an activity was created together with the post; `going` is true only when the author's participation came back valid. */
type Notice = "created" | "updated" | "created-activity" | "linked-activity";
type Saved = { post: PostResponse; notice: Notice; going: boolean };
const notices: readonly unknown[] = ["created", "updated", "created-activity", "linked-activity"];
const alreadySavedText = "Ese recuerdo ya se había guardado. Revisá si tus últimos cambios hacen falta.";
/** Left by the composer when the server says this attempt was already saved: no post travels, only the notice and the memory to open. */
const alreadySavedFrom = (state: unknown): { postId?: string } | undefined => {
  if (typeof state !== "object" || state === null || (state as { notice?: unknown }).notice !== "already-saved") return undefined;
  const postId = (state as { postId?: unknown }).postId;
  return typeof postId === "string" && /^[0-9a-f]{24}$/.test(postId) ? { postId } : {};
};
const noticeText = ({ notice, going }: Saved) => notice === "created" ? "Recuerdo publicado." : notice === "updated" ? "Cambios guardados."
  : `${notice === "created-activity" ? "Recuerdo publicado" : "Cambios guardados"} y actividad creada.${going ? " Vas a ir." : ""}`;

/**
 * Layout of `memories/*`. Under `TripContentLayout` the drafts already live above (they survive the journal, whose shell remounts this layout);
 * without a provider above (this layout alone) it keeps them here, keyed by Trip. Without `gallery` there is no gallery provider (the photos route needs it).
 */
export function MemoriesLayout({ gallery }: { gallery?: GalleryProviderProps } = {}) {
  const { tripId } = useParams();
  const hasPostDrafts = useHasPostDrafts(), hasCommentDrafts = useHasCommentDrafts();
  const outlet = <Outlet />;
  const comments = hasCommentDrafts ? outlet : <CommentDraftsProvider key={tripId}>{outlet}</CommentDraftsProvider>;
  const content = hasPostDrafts ? comments : <PostDraftsProvider key={tripId}>{comments}</PostDraftsProvider>;
  return gallery ? <GalleryProvider key={tripId} {...gallery}>{content}</GalleryProvider> : content;
}

/** Newest first; the id breaks ties so the order is stable. Repeated ids keep their first occurrence. */
const arrange = (items: readonly PostResponse[]): PostResponse[] => {
  const unique = [...new Map(items.slice().reverse().map((item) => [item.id, item])).values()].reverse();
  return unique.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id));
};
/** Server data wins for known ids; a locally saved post missing from the server answer is kept. */
const merge = (server: readonly PostResponse[], local: PostResponse | undefined) =>
  arrange(local && !server.some((item) => item.id === local.id) ? [...server, local] : server);
const savedFrom = (state: unknown, tripId: string | undefined): Saved | undefined => {
  if (typeof state !== "object" || state === null) return undefined;
  const { post, notice, going } = state as { post?: Partial<PostResponse>; notice?: unknown; going?: unknown };
  if (typeof post !== "object" || post === null || typeof post.id !== "string" || post.tripId !== tripId || typeof post.createdAt !== "string" ||
    !Number.isFinite(Date.parse(post.createdAt)) || (post.description !== null && typeof post.description !== "string") || !notices.includes(notice)) return undefined;
  return { post: post as PostResponse, notice: notice as Notice, going: going === true };
};

export function TripMemoriesScreen({ posts, members, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone }: TripMemoriesScreenProps) {
  const { tripId } = useParams();
  return <MemoriesContent key={tripId} tripId={tripId} posts={posts} members={members} timeZone={timeZone} />;
}

function MemoriesContent({ tripId, posts, members, timeZone }: TripMemoriesScreenProps & { tripId?: string }) {
  const inShell = useInTripShell();
  const location = useLocation();
  const navigate = useNavigate();
  // Read once: the saved post is kept locally and the history entry is cleaned so going back does not repeat the notice.
  const [saved] = useState(() => savedFrom(location.state, tripId));
  const [alreadySaved] = useState(() => alreadySavedFrom(location.state));
  const localPost = useRef(saved?.post);
  const [state, setState] = useState<LoadState>(saved ? { kind: "ready", posts: [saved.post] } : { kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  // Who the author is decides «Editar»; the listing never waits for it (a failed read leaves «Editar» for all).
  const [people, setPeople] = useState<PhotoPeople>(unknownPeople);
  useEffect(() => {
    if (!tripId || !members) return;
    let cancelled = false;
    void loadPeople(members, tripId).then((loaded) => { if (!cancelled) setPeople(loaded); });
    return () => { cancelled = true; };
  }, [tripId, members]);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  useEffect(() => { if (saved || alreadySaved) navigate(location.pathname, { replace: true, ...inheritNoBack(location, null) }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Silent refresh (T121): no `refreshing`/`refreshError`; a load that starts meanwhile bumps `epoch` and the older answer is dropped. The detail of a memory
  // (comments, likes) is not refreshed here: it would step over a comment draft.
  const epoch = useRef(0);
  const mounted = useRef(true);
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useTripRefreshLoader("memories", async ({ signal }) => {
    if (!tripId || stateRef.current.kind !== "ready") return { status: "ok" };
    const started = epoch.current;
    let result: Awaited<ReturnType<typeof posts.list>>;
    try { result = await posts.list(tripId); } catch { return { status: "error" }; }
    if (signal.aborted || !mounted.current || epoch.current !== started) return { status: "error" };
    if (!result.ok) {
      const { kind } = result.error;
      return { status: kind === "not-found" || kind === "forbidden" ? "gone" : kind === "unauthorized" ? "unauthorized" : "error" };
    }
    const next = merge(result.value, localPost.current);
    setState((current) => current.kind === "ready" && sameValue(current.posts, next) ? current : { kind: "ready", posts: next });
    return { status: "ok" };
  });
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      epoch.current += 1;
      if (!tripId) { setState({ kind: "error", error: { kind: "not-found" } }); return; }
      setState((current) => current.kind === "ready" ? current : { kind: "loading" });
      setRefreshing(true); setRefreshError(false);
      try {
        const result = await posts.list(tripId);
        if (cancelled) return;
        if (result.ok) setState({ kind: "ready", posts: merge(result.value, localPost.current) });
        else if (["network", "server"].includes(result.error.kind)) {
          setRefreshError(true);
          setState((current) => current.kind === "ready" ? current : { kind: "error", error: result.error });
        } else setState({ kind: "error", error: result.error });
      } catch {
        if (cancelled) return;
        setRefreshError(true);
        setState((current) => current.kind === "ready" ? current : { kind: "error", error: { kind: "network" } });
      } finally {
        if (!cancelled) setRefreshing(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [tripId, posts, attempt]);
  useRestorePosition(state.kind === "ready");
  const publication = new Intl.DateTimeFormat("es-AR", { timeZone, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const unavailable = state.kind === "error" && ["not-found", "forbidden"].includes(state.error.kind);
  const create = `/trips/${tripId}/memories/new`;
  const body = <div className="memory-feed">
      <header className="itinerary-header">
        {inShell ? <h2>Recuerdos</h2> : <h1>Recuerdos</h1>}
        <p>Lo que vive el grupo, del más reciente al más antiguo. Horarios en tu zona local.</p>
        <Link className="memory-fab" to={create}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /></svg>
          <span className="memory-fab__label">Nuevo recuerdo</span>
        </Link>
      </header>
      {state.kind === "ready" && saved ? <Feedback variant="success">{noticeText(saved)}</Feedback> : null}
      {alreadySaved ? <div className="activity-detail">
        <Feedback>{alreadySavedText}</Feedback>
        {alreadySaved.postId ? <PostLink tripId={tripId ?? ""} postId={alreadySaved.postId} anchor={memoryAnchor(alreadySaved.postId)} label="diario">Ver recuerdo</PostLink> : null}
      </div> : null}
      {state.kind === "ready" && refreshing ? <LoadingState label="Actualizando recuerdos…" /> : null}
      {state.kind === "ready" && refreshError ? <div className="activity-detail">
        <Feedback variant="error">No pudimos actualizar los recuerdos. Los cambios guardados se conservan.</Feedback>
        <Button onClick={() => setAttempt((value) => value + 1)}>Actualizar recuerdos</Button>
      </div> : null}
      {state.kind === "loading" ? <LoadingState label="Cargando recuerdos…" /> : null}
      {state.kind === "error" ? <div className="trips-state">
        <Feedback variant="error">{unavailable ? "Los recuerdos de este viaje no están disponibles para tu cuenta."
          : state.error.kind === "unauthorized" ? "Tu sesión venció. Volvé a iniciar sesión."
          : "No pudimos cargar los recuerdos. Revisá tu conexión e intentá nuevamente."}</Feedback>
        {state.error.kind === "unauthorized" ? <Link to="/login">Iniciar sesión</Link>
          : !unavailable ? <Button onClick={() => setAttempt((value) => value + 1)}>Reintentar</Button> : null}
      </div> : null}
      {state.kind === "ready" && state.posts.length === 0 ? <section className="trips-empty">
        <Heading level={inShell ? 3 : 2}>Todavía no hay recuerdos.</Heading>
        <p>Publicá el primero para empezar el diario del viaje.</p>
        <Link className="ui-button" to={create}>Crear el primer recuerdo</Link>
      </section> : null}
      {state.kind === "ready" && state.posts.length > 0 ? <List className="itinerary-posts memories-list" aria-label="Recuerdos">
        {state.posts.map((post) => <ListItem className="itinerary-nested-post" key={post.id} data-memory={post.id} tabIndex={-1}>
          <p className="itinerary-post-description"><PostLink tripId={tripId ?? ""} postId={post.id} anchor={memoryAnchor(post.id)} label="diario">
            {post.description ?? "Recuerdo sin texto."}</PostLink></p>
          <p className="itinerary-secondary">Publicado <time dateTime={post.createdAt}>{publication.format(new Date(post.createdAt))}</time></p>
          {canEditContent(people, post.authorId)
            ? <Link className="trips-settings-link" to={`/trips/${tripId}/memories/${post.id}/edit`}>Editar</Link>
            : <Link className="trips-settings-link" to={`/trips/${tripId}/memories/${post.id}/edit`} state={{ focus: "expense" }}>Editar gasto</Link>}
        </ListItem>)}
      </List> : null}
  </div>;
  if (inShell) return body;
  return <main className="app-shell trips-shell itinerary-shell">
    <div className="trips-panel">
      <Link className="trips-back" to={`/trips/${tripId}/itinerary`}>Volver al itinerario</Link>
      {body}
    </div>
  </main>;
}
