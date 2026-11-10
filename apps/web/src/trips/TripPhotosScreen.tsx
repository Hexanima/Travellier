import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Button, Feedback, LoadingState } from "../components/index.js";
import { PhotoGrid } from "./PhotoGrid.js";
import { PhotoViewer } from "./PhotoViewer.js";
import { openPostFrom } from "./open-post.js";
import { authorLabel, loadPeople, unknownPeople, type PhotoPeople } from "./photo-people.js";
import { canGoBack, photoAnchor, readPhoto } from "./post-origin.js";
import type { TripFailure } from "./trip-management-api.js";
import type { TripMembersApi } from "./trip-members-api.js";
import { useGalleryPages } from "./use-gallery.js";
import { useRestorePosition } from "./use-restore-position.js";
import "./itinerary.css";

export type TripPhotosScreenProps = { members: Pick<TripMembersApi, "list">; timeZone?: string };

const stateOf = (state: unknown): Record<string, unknown> => typeof state === "object" && state !== null && !Array.isArray(state) ? { ...(state as Record<string, unknown>) } : {};
/** The entry state without the open photo nor its viewer-entry mark (null when nothing else is left). Anything else stays. */
const withoutPhoto = (state: unknown) => { const rest = stateOf(state); delete rest.photo; delete rest.viewerEntry; return Object.keys(rest).length > 0 ? rest : null; };
/** The viewer entry was pushed by the grid itself: closing it goes one step back. A viewer reopened by a return (restore) has no such mark. */
const isViewerEntry = (state: unknown) => stateOf(state).viewerEntry === true;
const rejectsCursor = (error: TripFailure) => error.kind === "validation" && (error.fields ?? []).some((item) => item.field === "cursor");

export function TripPhotosScreen({ members, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone }: TripPhotosScreenProps) {
  const { tripId } = useParams();
  return <PhotosContent key={tripId} tripId={tripId ?? ""} members={members} timeZone={timeZone} />;
}

function PhotosContent({ tripId, members, timeZone }: { tripId: string; members: TripPhotosScreenProps["members"]; timeZone: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const gallery = useGalleryPages();
  const { photos, phase, error, hasMore } = gallery;
  const [people, setPeople] = useState<PhotoPeople>(unknownPeople);
  useEffect(() => {
    let cancelled = false;
    void loadPeople(members, tripId).then((loaded) => { if (!cancelled) setPeople(loaded); });
    return () => { cancelled = true; };
  }, [members, tripId]);

  const openId = readPhoto(location.state);
  const settled = phase === "idle" || phase === "more-error";
  const viewing = openId !== undefined && photos.some((item) => item.id === openId) ? openId : undefined;
  const here = `${location.pathname}${location.search}`;
  useRestorePosition(photos.length > 0);

  // A photo in the state that cannot be shown (malformed, or not among the loaded ones) is dropped; pages are not auto-loaded to find it.
  const hasPhotoKey = typeof location.state === "object" && location.state !== null && "photo" in location.state;
  useEffect(() => {
    if (!hasPhotoKey) return;
    if (openId === undefined || (settled && !photos.some((item) => item.id === openId))) navigate(here, { replace: true, state: withoutPhoto(location.state) });
  }, [hasPhotoKey, openId, settled, photos]); // eslint-disable-line react-hooks/exhaustive-deps

  // Closing the viewer returns the focus to the thumbnail of the last photo it showed.
  const lastViewed = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (lastViewed.current && viewing === undefined) {
      document.querySelector<HTMLElement>(`[data-photo="${lastViewed.current}"] button`)?.focus();
    }
    lastViewed.current = viewing;
  }, [viewing]);

  // After the last page arrives «Cargar más» disappears: the focus goes to the first new photo instead of getting lost.
  const focusFrom = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (focusFrom.current === undefined || phase === "more-loading") return;
    const first = photos[focusFrom.current];
    if (!hasMore && first) document.querySelector<HTMLElement>(`[data-photo="${first.id}"] button`)?.focus();
    focusFrom.current = undefined;
  }, [phase, hasMore, photos]);
  const loadMore = (event?: { currentTarget: HTMLElement }) => {
    if (phase === "more-loading") return;
    if (event && document.activeElement === event.currentTarget) focusFrom.current = photos.length;
    gallery.loadMore();
  };

  const day = useMemo(() => new Intl.DateTimeFormat("es-AR", { timeZone, day: "numeric", month: "short", year: "numeric" }), [timeZone]);
  const items = photos.map((item, index) => {
    const author = authorLabel(people, item.uploaderId);
    const date = day.format(new Date(item.uploadedAt));
    return { id: item.id, src: item.url, name: `Foto ${index + 1} de ${photos.length}. De ${author}, ${date}`, caption: `${author}, ${date}`, failed: gallery.failed.has(item.id),
      onOpen: () => navigate(here, { state: { photo: item.id, viewerEntry: true } }), onError: () => gallery.imageError(item.id), onRetry: () => gallery.retryImage(item.id) };
  });
  const select = (id: string) => navigate(here, { replace: true, state: { ...stateOf(location.state), photo: id } });
  // Only the entry the grid pushed is undone with a step back; any other (a return from the detail, a reload) is cleaned in place and never leaves the screen.
  const close = () => { if (isViewerEntry(location.state) && canGoBack(location)) navigate(-1); else navigate(here, { replace: true, state: withoutPhoto(location.state) }); };
  const viewed = viewing ? photos.find((item) => item.id === viewing) : undefined;

  const failure = phase === "initial-error" || phase === "more-error" ? error : undefined;
  const unavailable = failure !== undefined && ["not-found", "forbidden"].includes(failure.kind);
  const create = `/trips/${tripId}/memories/new`;
  return <main className="app-shell trips-shell itinerary-shell">
    <div className="trips-panel">
      <Link className="trips-back" to={`/trips/${tripId}/memories`}>Volver a recuerdos</Link>
      <header className="itinerary-header">
        <h1>Fotos</h1>
        <p>Las fotos del viaje, de la más reciente a la más antigua. Horarios en tu zona local.</p>
      </header>
      {phase === "initial-loading" ? <LoadingState label="Cargando fotos…" /> : null}
      {failure ? <div className="trips-state">
        <Feedback variant="error">{unavailable ? "Las fotos de este viaje no están disponibles para tu cuenta."
          : failure.kind === "unauthorized" ? "Tu sesión venció. Volvé a iniciar sesión."
          : rejectsCursor(failure) ? "No pudimos continuar la lista de fotos. Podés volver a cargarla desde el inicio."
          : "No pudimos cargar las fotos. Revisá tu conexión e intentá nuevamente."}</Feedback>
        {failure.kind === "unauthorized" ? <Link to="/login">Iniciar sesión</Link>
          : unavailable ? null
          : rejectsCursor(failure) ? <Button onClick={gallery.restart}>Volver a cargar desde el inicio</Button>
          : <Button onClick={gallery.retry}>Reintentar</Button>}
      </div> : null}
      {!failure && gallery.refreshFailed ? <div className="trips-state">
        <Feedback variant="error">No pudimos renovar algunas fotos. Se conservan las que ya estaban cargadas.</Feedback>
        <Button onClick={gallery.retryRefresh}>Reintentar</Button>
      </div> : null}
      {phase === "idle" && photos.length === 0 && !hasMore ? <section className="trips-empty">
        <h2>Todavía no hay fotos</h2>
        <p>Las fotos aparecen cuando alguien las agrega a un recuerdo.</p>
        <Link to={create}>Nuevo recuerdo</Link>
      </section> : null}
      {photos.length > 0 ? <>
        <PhotoGrid label="Fotos del viaje" items={items} />
        <p role="status">Mostrando {photos.length} {photos.length === 1 ? "foto" : "fotos"}</p>
        {phase === "more-loading" ? <LoadingState label="Cargando más fotos…" /> : null}
        {hasMore ? <Button aria-disabled={phase === "more-loading" || undefined} onClick={loadMore}>Cargar más</Button> : null}
      </> : null}
      {viewed ? <PhotoViewer photos={photos} photoId={viewed.id} hasMore={hasMore} loadingMore={phase === "more-loading"} timeZone={timeZone}
        authorOf={(item) => authorLabel(people, item.uploaderId)} postHref={(item) => `/trips/${tripId}/memories/${item.postId}`}
        onSelect={select} onLoadMore={() => gallery.loadMore()} onClose={close} failed={gallery.failed.has(viewed.id)}
        onOpenPost={(item) => openPostFrom(navigate, location, { tripId, postId: item.postId, anchor: photoAnchor(item.id), label: "fotos", viewer: true, panel: "photos" })}
        onImageError={gallery.imageError} onRetryImage={gallery.retryImage} /> : null}
    </div>
  </main>;
}
