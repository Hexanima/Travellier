import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Button, Feedback, List, ListItem, LoadingState, Modal } from "../components/index.js";
import { LocationPreview } from "./LocationPreview.js";
import { buildOrigin, canGoBack, originHref, originLabel, readOrigin, withNoBack, type PostOrigin } from "./post-origin.js";
import { CommentsPanel, PostLikeControl } from "./PostComments.js";
import type { TripFailure } from "./trip-management-api.js";
import type { TripCommentApi } from "./trip-comment-api.js";
import type { TripLikeApi } from "./trip-like-api.js";
import type { TripMembersApi } from "./trip-members-api.js";
import type { PostDetail, PostSummary, TripPostApi } from "./trip-post-api.js";
import { useLikes } from "./use-likes.js";
import { loadPeople, unknownPeople, type PhotoPeople } from "./photo-people.js";
import { canDeleteContent, canEditContent } from "./authorship.js";
import "./itinerary.css";

export type PostDetailScreenProps = { posts: Pick<TripPostApi, "get" | "remove">; members: Pick<TripMembersApi, "list">; comments: TripCommentApi;
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
  return <DetailContent key={`${tripId}/${postId}`} tripId={tripId} postId={postId} get={posts.get} remove={posts.remove} timeZone={timeZone} interaction={{ members, comments, likes }} />;
}

function DetailContent({ tripId, postId, get, remove, timeZone, interaction }: { tripId?: string; postId?: string; get: TripPostApi["get"]; remove: TripPostApi["remove"];
  timeZone: string; interaction: Interaction }) {
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
  // After deleting there is nothing to come back to: with history it is the previous level, otherwise the origin replaces this entry and
  // inherits `noBack` (this branch only runs with nothing behind), so the next back press does not go nowhere.
  const afterDelete = () => { if (canGoBack(location)) navigate(-1); else navigate(originHref(origin), { replace: true, state: withNoBack(restoreOf(origin)) }); };
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
        interaction={interaction} remove={remove} onDeleted={afterDelete} onGone={() => setState({ kind: "error", error: { kind: "not-found" } })} /> : null}
    </div>
  </main>;
}

/**
 * Mounted once the detail is ready and kept while it refreshes: the comments and the likes are requested here once, and the active panel, the lists
 * and the typed texts are not rebuilt by refreshing or by interacting.
 */
function ReadyContent({ tripId, postId, detail, origin, publication, interaction, remove, onDeleted, onGone }: { tripId: string; postId: string; detail: PostDetail; origin: PostOrigin;
  publication: Intl.DateTimeFormat; interaction: Interaction; remove: TripPostApi["remove"]; onDeleted: () => void; onGone: () => void }) {
  const { post, parent, children, rootActivityId } = detail;
  const likes = useLikes(tripId, postId, interaction.likes);
  const [panel, setPanel] = useState<Panel>("children");
  // Only the author edits the content; the others keep the expense. The detail never waits for this read (a failed one leaves «Editar»).
  const [people, setPeople] = useState<PhotoPeople>(unknownPeople);
  const { members } = interaction;
  useEffect(() => {
    let cancelled = false;
    void loadPeople(members, tripId).then((loaded) => { if (!cancelled) setPeople(loaded); });
    return () => { cancelled = true; };
  }, [members, tripId]);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<{ text: string; login?: boolean }>();
  const [notice, setNotice] = useState<string>();
  const busyRef = useRef(false);
  const alive = useRef(true);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const actions = useRef<HTMLDivElement>(null);
  const returnFocus = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  // Runs after Modal's own effect: the initial focus goes to the safe action.
  useEffect(() => { if (confirming) cancelRef.current?.focus(); }, [confirming]);
  // Cancelling returns the focus to the button that opened the dialog (a click does not always focus a button on mobile).
  useEffect(() => {
    if (confirming || !returnFocus.current) return;
    returnFocus.current = false;
    actions.current?.querySelector<HTMLElement>("button[data-error]")?.focus();
  }, [confirming]);
  const canDelete = canDeleteContent(people, detail.post.authorId);
  // A role that changed while the dialog was open: it no longer applies, so it closes.
  useEffect(() => { if (confirming && !canDelete && !busyRef.current) setConfirming(false); }, [confirming, canDelete]);
  const openDelete = () => { setRemoveError(undefined); setNotice(undefined); setConfirming(true); };
  const closeDelete = () => { if (busyRef.current) return; returnFocus.current = true; setConfirming(false); };
  const confirmDelete = async () => {
    if (busyRef.current) return;
    busyRef.current = true; setRemoving(true); setRemoveError(undefined);
    try {
      const result = await remove(tripId, postId);
      if (!alive.current) return;
      if (result.ok) { onDeleted(); return; }
      // Already deleted (a retry after an unconfirmed failure, or by someone else): the outcome the user wanted.
      if (result.error.kind === "not-found") { onGone(); return; }
      if (result.error.kind === "unauthorized") { setRemoveError({ text: "Tu sesión venció. Volvé a iniciar sesión.", login: true }); return; }
      if (result.error.kind === "forbidden") {
        const text = "Ya no tenés permiso para eliminar este recuerdo.";
        const loaded = await loadPeople(members, tripId);
        if (!alive.current) return;
        setPeople(loaded);
        if (canDeleteContent(loaded, detail.post.authorId)) setRemoveError({ text });
        else { setConfirming(false); setNotice(text); }
        return;
      }
      setRemoveError({ text: removeFailure });
    } catch {
      if (alive.current) setRemoveError({ text: removeFailure });
    } finally {
      busyRef.current = false;
      if (alive.current) setRemoving(false);
    }
  };
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
      <LocationPreview value={post.mapsUrl} context="memory" />
      <p className="itinerary-secondary">Publicado <time dateTime={post.createdAt}>{format(post.createdAt)}</time></p>
      {rootActivityId ? <p className="itinerary-secondary">Vinculado a una actividad</p> : null}
      {post.transportId ? <p className="itinerary-secondary">Vinculado a un transporte</p> : null}
      {/* Only a direct link: the detail does not carry the root transport of a chain. */}
      {post.transportId ? <Link className="trips-settings-link" to={`/trips/${tripId}/itinerary?transport=${post.transportId}`} state={{ origin }}>Ver transporte</Link> : null}
      <PostLikeControl likes={likes} />
      <div className="memory-actions" ref={actions}>
        <Link className="trips-settings-link" to={`/trips/${tripId}/memories/new?parentPostId=${post.id}`}
          state={{ origin: buildOrigin({ pathname: here, search: "" }, "recuerdo"), ...(label ? { parentLabel: label } : {}) }}>Continuar recuerdo</Link>
        {canEditContent(people, post.authorId)
          ? <Link className="trips-settings-link" to={`${here}/edit`} state={{ origin: buildOrigin({ pathname: here, search: "" }, "recuerdo") }}>Editar</Link>
          : <Link className="trips-settings-link" to={`${here}/edit`} state={{ origin: buildOrigin({ pathname: here, search: "" }, "recuerdo"), focus: "expense" }}>Editar gasto</Link>}
        {canDelete ? <Button error onClick={openDelete}>Eliminar recuerdo</Button> : null}
      </div>
      {notice ? <Feedback variant="error" role="status">{notice}</Feedback> : null}
    </section>
    {parent || post.parentPostId ? <section className="activity-detail" aria-labelledby="memory-previous-title">
      <h2 id="memory-previous-title">Recuerdo anterior</h2>
      {parent ? <div className="memory-parent">
        <Link className="memory-parent__excerpt" to={`/trips/${tripId}/memories/${parent.id}`} state={{ origin }}>{excerpt(parent.description, 140) ?? noText}</Link>
        <p className="itinerary-secondary">Publicado <time dateTime={parent.createdAt}>{format(parent.createdAt)}</time></p>
      </div>
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
    <div className="members-dialog">
      <Modal isOpen={confirming} closeOnEscape title="Eliminar recuerdo" onClose={closeDelete} loading={removing} error={removeError?.text}>
        <p>Se eliminan el recuerdo, sus fotos, su gasto, sus comentarios y me gusta. Sus continuaciones pasan al recuerdo anterior. No se puede deshacer.</p>
        {removeError?.login ? <Link to="/login">Iniciar sesión</Link> : null}
        <div className="trip-members-actions">
          <button ref={cancelRef} className="ui-button" type="button" onClick={closeDelete}>Cancelar</button>
          <Button error onClick={() => void confirmDelete()}>Eliminar</Button>
        </div>
      </Modal>
    </div>
  </>;
}
const removeFailure = "No pudimos eliminar el recuerdo. Revisá tu conexión e intentá nuevamente.";
