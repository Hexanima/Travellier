import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Button, Feedback, List, ListItem, LoadingState } from "../components/index.js";
import { buildOrigin, canGoBack, originHref, originLabel, readOrigin, type PostOrigin } from "./post-origin.js";
import type { TripFailure } from "./trip-management-api.js";
import type { PostDetail, PostSummary, TripPostApi } from "./trip-post-api.js";
import "./itinerary.css";

export type PostDetailScreenProps = { posts: Pick<TripPostApi, "get">; timeZone?: string };
type LoadState = { kind: "loading" } | { kind: "ready"; detail: PostDetail } | { kind: "error"; error: TripFailure };

const noText = "Recuerdo sin texto.";
/** Single-line excerpt; nothing is invented for an empty text (the caller decides the placeholder). */
const excerpt = (text: string | null, max: number): string | undefined => {
  const clean = text?.replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  return clean.length > max ? `${clean.slice(0, max).trimEnd()}…` : clean;
};
/** Only the restore data of an origin travels back, so its place (anchor and scroll) is recovered. */
const restoreOf = (origin: PostOrigin) => origin.anchor !== undefined && origin.scrollY !== undefined ? { restore: { anchor: origin.anchor, scrollY: origin.scrollY } } : undefined;

export function PostDetailScreen({ posts, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone }: PostDetailScreenProps) {
  const { tripId, postId } = useParams();
  return <DetailContent key={`${tripId}/${postId}`} tripId={tripId} postId={postId} get={posts.get} timeZone={timeZone} />;
}

function DetailContent({ tripId, postId, get, timeZone }: { tripId?: string; postId?: string; get: TripPostApi["get"]; timeZone: string }) {
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
  const here = `/trips/${tripId}/memories/${postId}`;
  const summaryItem = (item: PostSummary) => <ListItem className="itinerary-nested-post" key={item.id}>
    <Link className="trips-settings-link" to={`/trips/${tripId}/memories/${item.id}`} state={{ origin }}>{excerpt(item.description, 140) ?? noText}</Link>
    <p className="itinerary-secondary">Publicado <time dateTime={item.createdAt}>{publication.format(new Date(item.createdAt))}</time></p>
  </ListItem>;
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
      {state.kind === "ready" ? (() => {
        const { post, parent, children, rootActivityId } = state.detail;
        const label = excerpt(post.description, 80);
        return <>
          <section className="activity-detail" aria-labelledby="memory-content-title">
            <h2 id="memory-content-title">Contenido</h2>
            <p className="itinerary-post-description">{post.description?.trim() ? post.description : noText}</p>
            {post.mapsUrl ? <a className="trips-settings-link" href={post.mapsUrl} rel="noopener noreferrer">Ver ubicación</a> : null}
            <p className="itinerary-secondary">Publicado <time dateTime={post.createdAt}>{publication.format(new Date(post.createdAt))}</time></p>
            {rootActivityId ? <p className="itinerary-secondary">Vinculado a una actividad</p> : null}
            {post.transportId ? <p className="itinerary-secondary">Vinculado a un transporte</p> : null}
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
          <section className="activity-detail" aria-labelledby="memory-children-title">
            <h2 id="memory-children-title">Continuaciones</h2>
            {children.length > 0 ? <List className="itinerary-posts memories-list" aria-label="Continuaciones">{children.map(summaryItem)}</List>
              : <p className="itinerary-secondary">Todavía no hay continuaciones.</p>}
          </section>
        </>;
      })() : null}
    </div>
  </main>;
}
