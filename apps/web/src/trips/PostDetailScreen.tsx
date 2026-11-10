import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Button, Feedback, List, ListItem, LoadingState } from "../components/index.js";
import { safeMapsUrl } from "./safe-maps-url.js";
import { buildOrigin, canGoBack, originHref, originLabel, readOrigin, type PostOrigin } from "./post-origin.js";
import { CommentsPanel, PostLikeControl } from "./PostComments.js";
import type { TripFailure } from "./trip-management-api.js";
import type { TripCommentApi } from "./trip-comment-api.js";
import type { TripLikeApi } from "./trip-like-api.js";
import type { TripMembersApi } from "./trip-members-api.js";
import type { PostDetail, PostSummary, TripPostApi } from "./trip-post-api.js";
import { useLikes } from "./use-likes.js";
import "./itinerary.css";

export type PostDetailScreenProps = { posts: Pick<TripPostApi, "get">; members: Pick<TripMembersApi, "list">; comments: TripCommentApi;
  likes: Pick<TripLikeApi, "summary" | "setPostLike" | "setCommentLike">; timeZone?: string };
type Interaction = Pick<PostDetailScreenProps, "members" | "comments" | "likes">;
type Panel = "children" | "comments";
const panels: readonly { id: Panel; label: string }[] = [{ id: "children", label: "Continuaciones" }, { id: "comments", label: "Comentarios" }];
type LoadState = { kind: "loading" } | { kind: "ready"; detail: PostDetail } | { kind: "error"; error: TripFailure };

const noText = "Recuerdo sin texto.";
/** Single-line excerpt; nothing is invented for an empty text (the caller decides the placeholder). */
const excerpt = (text: string | null, max: number): string | undefined => {
  const clean = text?.replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  return clean.length > max ? `${clean.slice(0, max).trimEnd()}…` : clean;
};
/** Only the restore data of an origin travels back, so its place (anchor and scroll) is recovered. */
const restoreOf = (origin: PostOrigin) => {
  if (origin.anchor === undefined || origin.scrollY === undefined) return undefined;
  const panel = origin.label === "fotos" ? { panel: "photos" as const } : {};
  // From the viewer the photo is derived from the anchor (an id only); the signed urls are never in the state.
  const photo = origin.viewer && origin.anchor.startsWith("data-photo=") ? origin.anchor.slice("data-photo=".length) : undefined;
  return { ...(photo ? { photo } : {}), restore: { anchor: origin.anchor, scrollY: origin.scrollY, ...panel } };
};

export function PostDetailScreen({ posts, members, comments, likes, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone }: PostDetailScreenProps) {
  const { tripId, postId } = useParams();
  return <DetailContent key={`${tripId}/${postId}`} tripId={tripId} postId={postId} get={posts.get} timeZone={timeZone} interaction={{ members, comments, likes }} />;
}

function DetailContent({ tripId, postId, get, timeZone, interaction }: { tripId?: string; postId?: string; get: TripPostApi["get"]; timeZone: string; interaction: Interaction }) {
  const location = useLocation();
  const navigate = useNavigate();
  const title = useRef<HTMLHeadingElement>(null);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  useEffect(() => { title.current?.focus(); }, []);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!tripId || !postId) { setState({ kind: "error", error: { kind: "not-found" } }); return; }
      setState((current) => current.kind === "ready" ? current : { kind: "loading" });
      setRefreshing(true); setRefreshError(false);
      try {
        const result = await get(tripId, postId);
        if (cancelled) return;
        if (result.ok) setState({ kind: "ready", detail: result.value });
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
  }, [tripId, postId, get, attempt]);

  const origin = readOrigin(location.state, tripId ?? "");
  // Back is the immediately previous level when the app has history; a deep link falls back to the origin (or the diary).
  const goBack = () => { if (canGoBack(location)) navigate(-1); else navigate(originHref(origin), { state: restoreOf(origin) }); };
  const publication = new Intl.DateTimeFormat("es-AR", { timeZone, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const unavailable = state.kind === "error" && ["not-found", "forbidden"].includes(state.error.kind);
  return <main className="app-shell trips-shell itinerary-shell">
    <div className="trips-panel memory-detail">
      <Button onClick={goBack}>Volver</Button>
      <Link className="trips-back" to={originHref(origin)} state={restoreOf(origin)}>{originLabel(origin.label)}</Link>
      <header className="itinerary-header">
        <h1 ref={title} tabIndex={-1}>Recuerdo</h1>
      </header>
      {state.kind === "loading" ? <LoadingState label="Cargando recuerdo…" /> : null}
      {state.kind === "ready" && refreshing ? <LoadingState label="Actualizando recuerdo…" /> : null}
      {state.kind === "ready" && refreshError ? <div className="activity-detail">
        <Feedback variant="error">No pudimos actualizar el recuerdo. Lo que ya cargaste se conserva.</Feedback>
        <Button onClick={() => setAttempt((value) => value + 1)}>Actualizar recuerdo</Button>
      </div> : null}
      {state.kind === "error" ? <div className="trips-state">
        <Feedback variant="error">{unavailable ? "Este recuerdo ya no está disponible para tu cuenta."
          : state.error.kind === "unauthorized" ? "Tu sesión venció. Volvé a iniciar sesión."
          : "No pudimos cargar el recuerdo. Revisá tu conexión e intentá nuevamente."}</Feedback>
        {state.error.kind === "unauthorized" ? <Link to="/login">Iniciar sesión</Link>
          : !unavailable ? <Button onClick={() => setAttempt((value) => value + 1)}>Reintentar</Button> : null}
      </div> : null}
      {state.kind === "ready" && tripId && postId ? <ReadyContent tripId={tripId} postId={postId} detail={state.detail} origin={origin} publication={publication}
        interaction={interaction} /> : null}
    </div>
  </main>;
}

/**
 * Mounted once the detail is ready and kept while it refreshes: the comments and the likes are requested here once, and the active panel, the lists
 * and the typed texts are not rebuilt by refreshing or by interacting.
 */
function ReadyContent({ tripId, postId, detail, origin, publication, interaction }: { tripId: string; postId: string; detail: PostDetail; origin: PostOrigin;
  publication: Intl.DateTimeFormat; interaction: Interaction }) {
  const { post, parent, children, rootActivityId } = detail;
  const likes = useLikes(tripId, postId, interaction.likes);
  const [panel, setPanel] = useState<Panel>("children");
  const tabs = useRef<Record<Panel, HTMLButtonElement | null>>({ children: null, comments: null });
  const label = excerpt(post.description, 80);
  const here = `/trips/${tripId}/memories/${postId}`;
  const format = (iso: string) => publication.format(new Date(iso));
  const summaryItem = (item: PostSummary) => <ListItem className="itinerary-nested-post" key={item.id}>
    <Link className="trips-settings-link" to={`/trips/${tripId}/memories/${item.id}`} state={{ origin }}>{excerpt(item.description, 140) ?? noText}</Link>
    <p className="itinerary-secondary">Publicado <time dateTime={item.createdAt}>{format(item.createdAt)}</time></p>
  </ListItem>;
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const target = event.key === "ArrowRight" ? (index + 1) % panels.length : event.key === "ArrowLeft" ? (index + panels.length - 1) % panels.length
      : event.key === "Home" ? 0 : event.key === "End" ? panels.length - 1 : undefined;
    if (target === undefined) return;
    event.preventDefault();
    setPanel(panels[target].id);
    tabs.current[panels[target].id]?.focus();
  };
  return <>
    <section className="activity-detail" aria-labelledby="memory-content-title">
      <h2 id="memory-content-title">Contenido</h2>
      <p className="itinerary-post-description">{post.description?.trim() ? post.description : noText}</p>
      {safeMapsUrl(post.mapsUrl) ? <a className="trips-settings-link" href={safeMapsUrl(post.mapsUrl)} rel="noopener noreferrer">Ver ubicación</a> : null}
      <p className="itinerary-secondary">Publicado <time dateTime={post.createdAt}>{format(post.createdAt)}</time></p>
      {rootActivityId ? <p className="itinerary-secondary">Vinculado a una actividad</p> : null}
      {post.transportId ? <p className="itinerary-secondary">Vinculado a un transporte</p> : null}
      <PostLikeControl likes={likes} />
      <div className="memory-actions">
        <Link className="trips-settings-link" to={`/trips/${tripId}/memories/new?parentPostId=${post.id}`}
          state={{ origin: buildOrigin({ pathname: here, search: "" }, "recuerdo"), ...(label ? { parentLabel: label } : {}) }}>Continuar recuerdo</Link>
        <Link className="trips-settings-link" to={`${here}/edit`} state={{ origin: buildOrigin({ pathname: here, search: "" }, "recuerdo") }}>Editar</Link>
      </div>
    </section>
    {parent || post.parentPostId ? <section className="activity-detail" aria-labelledby="memory-previous-title">
      <h2 id="memory-previous-title">Recuerdo anterior</h2>
      {parent ? <List className="itinerary-posts memories-list" aria-label="Recuerdo anterior">{summaryItem(parent)}</List>
        : <p className="itinerary-secondary">El recuerdo anterior ya no está disponible.</p>}
    </section> : null}
    <div className="memory-tabs" role="tablist" aria-label="Continuaciones y comentarios">
      {panels.map(({ id, label: name }, index) => <button key={id} type="button" role="tab" className="ui-button memory-tab" id={`memory-tab-${id}`}
        aria-selected={panel === id} aria-controls={`memory-panel-${id}`} tabIndex={panel === id ? 0 : -1} ref={(node) => { tabs.current[id] = node; }}
        onClick={() => setPanel(id)} onKeyDown={(event) => onKeyDown(event, index)}>{name}</button>)}
    </div>
    <section className="activity-detail memory-panel" id="memory-panel-children" role="tabpanel" aria-labelledby="memory-tab-children" hidden={panel !== "children"}>
      <h2 id="memory-children-title">Continuaciones</h2>
      {children.length > 0 ? <List className="itinerary-posts memories-list" aria-label="Continuaciones">{children.map(summaryItem)}</List>
        : <p className="itinerary-secondary">Todavía no hay continuaciones.</p>}
    </section>
    <section className="activity-detail memory-panel" id="memory-panel-comments" role="tabpanel" aria-labelledby="memory-tab-comments" hidden={panel !== "comments"}>
      <h2 id="memory-comments-title">Comentarios</h2>
      <CommentsPanel tripId={tripId} postId={postId} comments={interaction.comments} members={interaction.members} likes={likes} format={format} />
    </section>
  </>;
}
