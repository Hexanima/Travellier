import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button, Feedback, LoadingState } from "../components/index.js";
import { PhotoGrid } from "./PhotoGrid.js";
import { PhotoViewer } from "./PhotoViewer.js";
import { openPostFrom } from "./open-post.js";
import { authorLabel, type PhotoPeople } from "./photo-people.js";
import { canGoBack, photoAnchor, readPhoto } from "./post-origin.js";
import type { TripFailure } from "./trip-management-api.js";
import { useRefreshGuard } from "./trip-refresh.js";
import type { GalleryPages } from "./use-gallery.js";

const stateOf = (state: unknown): Record<string, unknown> => typeof state === "object" && state !== null && !Array.isArray(state) ? { ...(state as Record<string, unknown>) } : {};
/** The entry state without the open photo nor its viewer-entry mark (null when nothing else is left). Anything else stays. */
const withoutPhoto = (state: unknown) => { const rest = stateOf(state); delete rest.photo; delete rest.viewerEntry; return Object.keys(rest).length > 0 ? rest : null; };
/** The viewer entry was pushed by the grid itself: closing it goes one step back. A viewer reopened by a return (restore) has no such mark. */
const isViewerEntry = (state: unknown) => stateOf(state).viewerEntry === true;
const rejectsCursor = (error: TripFailure) => error.kind === "validation" && (error.fields ?? []).some((item) => item.field === "cursor");

export type PhotoBrowserProps = {
  gallery: GalleryPages; people: PhotoPeople; timeZone: string; tripId: string;
  /** Accessible name of the grid. */
  label: string;
  /** Where a post opened from the viewer returns to: the photos page or the activity dialog. */
  originLabel: "fotos" | "actividad" | "transporte";
  /** Content of the empty state (shown when the gallery is loaded and has no photos). */
  empty: ReactNode;
  /** Stable element that receives the focus when the list restarts from page 1 (the page heading or the photos tab). */
  focusTarget: () => HTMLElement | null | undefined;
  /** Mounts the viewer in `document.body`, in its own layer, instead of in place (used inside the activity dialog, whose content is inert). */
  portal?: boolean;
};

/** Grid of photos and enlarged viewer over one gallery (hook result). The open photo lives in the history state (an id), never a url. */
export function PhotoBrowser({ gallery, people, timeZone, tripId, label, originLabel, empty, focusTarget, portal = false }: PhotoBrowserProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { photos, phase, error, hasMore } = gallery;
  const openId = readPhoto(location.state);
  const settled = phase === "idle" || phase === "more-error";
  const viewing = openId !== undefined && photos.some((item) => item.id === openId) ? openId : undefined;
  const here = `${location.pathname}${location.search}`;

  // A photo in the state that cannot be shown (malformed, or not among the loaded ones) is dropped; pages are not auto-loaded to find it.
  const hasPhotoKey = typeof location.state === "object" && location.state !== null && "photo" in location.state;
  // Only the entry the grid pushed is undone with a step back; any other (a return from the detail, a reload) is cleaned in place and never leaves the screen.
  // Shared by the user's close and by the forced one below, so both leave the same history.
  const closing = useRef(false);
  // A second close while the first is pending (history.go is asynchronous: the dialog stays mounted until popstate) is ignored, so it never steps back twice.
  // The mark is cleared when the entry has no photo anymore and, as a safety net, whenever the location changes (so it can never block a later close).
  const closeViewer = () => {
    if (closing.current) return;
    closing.current = true;
    if (isViewerEntry(location.state) && canGoBack(location)) navigate(-1);
    else navigate(here, { replace: true, state: withoutPhoto(location.state) });
  };
  useEffect(() => { closing.current = false; }, [location.key]);
  useEffect(() => {
    if (!hasPhotoKey) { closing.current = false; return; }
    if (closing.current) return; // a close is already underway: do not navigate twice
    if (openId === undefined || (settled && !photos.some((item) => item.id === openId))) closeViewer();
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

  // Restarting from page 1 closes the viewer for good (same criterion as «Cerrar», so it does not reopen when the photo is on page 1) and, since the button
  // and the thumbnails disappear, the focus goes to the stable target of the gallery.
  const focusRestart = useRef(false);
  useEffect(() => {
    if (focusRestart.current && phase === "initial-loading") { focusTarget()?.focus(); focusRestart.current = false; }
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps
  const restart = () => {
    if (hasPhotoKey) closeViewer();
    focusRestart.current = true;
    gallery.restart();
  };

  const day = useMemo(() => new Intl.DateTimeFormat("es-AR", { timeZone, day: "numeric", month: "short", year: "numeric" }), [timeZone]);
  const items = photos.map((item, index) => {
    const author = authorLabel(people, item.uploaderId);
    const date = day.format(new Date(item.uploadedAt));
    return { id: item.id, src: item.url, name: `Foto ${index + 1} de ${photos.length}. De ${author}, ${date}`, caption: `${author}, ${date}`, failed: gallery.failed.has(item.id),
      onOpen: () => navigate(here, { state: { photo: item.id, viewerEntry: true } }), onError: () => gallery.imageError(item.id), onRetry: () => gallery.retryImage(item.id) };
  });
  const select = (id: string) => navigate(here, { replace: true, state: { ...stateOf(location.state), photo: id } });
  const viewed = viewing ? photos.find((item) => item.id === viewing) : undefined;
  // The viewer is a modal: the Trip refresh waits while it is open (T121) and catches up once when it closes.
  useRefreshGuard(viewed !== undefined);

  const failure = phase === "initial-error" || phase === "more-error" ? error : undefined;
  const unavailable = failure !== undefined && ["not-found", "forbidden"].includes(failure.kind);
  const failureText = failure === undefined ? undefined : unavailable ? "Las fotos de este viaje no están disponibles para tu cuenta."
    : failure.kind === "unauthorized" ? "Tu sesión venció. Volvé a iniciar sesión."
    : rejectsCursor(failure) ? "No pudimos continuar la lista de fotos. Podés volver a cargarla desde el inicio."
    : "No pudimos cargar las fotos. Revisá tu conexión e intentá nuevamente.";
  const refreshText = "No pudimos renovar algunas fotos. Se conservan las que ya estaban cargadas.";
  // With the viewer open (aria-modal) the notices live inside it and are not repeated in the page: a single alert is visible at any time.
  const inViewer = viewed !== undefined;
  const notice = failureText ?? (gallery.refreshFailed ? refreshText : undefined);
  // The same action as outside the viewer: login (401), restart (rejected cursor), nothing (404/403) or retry. Restarting closes the viewer for good (closeViewer).
  const retryNotice = failure ? (unavailable || failure.kind === "unauthorized" || rejectsCursor(failure) ? undefined : gallery.retry) : gallery.refreshFailed ? gallery.retryRefresh : undefined;
  const noticeAction = failure === undefined || unavailable ? undefined : failure.kind === "unauthorized" ? <Link to="/login">Iniciar sesión</Link>
    : rejectsCursor(failure) ? <Button onClick={restart}>Volver a cargar desde el inicio</Button> : undefined;
  const viewer = viewed ? <PhotoViewer photos={photos} photoId={viewed.id} hasMore={hasMore} loadingMore={phase === "more-loading"} timeZone={timeZone}
    authorOf={(item) => authorLabel(people, item.uploaderId)} postHref={(item) => `/trips/${tripId}/memories/${item.postId}`}
    onSelect={select} onLoadMore={() => gallery.loadMore()} onClose={closeViewer} failed={gallery.failed.has(viewed.id)} notice={notice} onRetryNotice={retryNotice} noticeAction={noticeAction}
    onOpenPost={(item) => openPostFrom(navigate, location, { tripId, postId: item.postId, anchor: photoAnchor(item.id), label: originLabel, viewer: true, ...(originLabel === "fotos" ? { panel: "photos" as const } : {}) })}
    onImageError={gallery.imageError} onRetryImage={gallery.retryImage} /> : null;
  return <>
    {phase === "initial-loading" ? <LoadingState label="Cargando fotos…" /> : null}
    {failure && !inViewer ? <div className="trips-state">
      <Feedback variant="error">{failureText}</Feedback>
      {failure.kind === "unauthorized" ? <Link to="/login">Iniciar sesión</Link>
        : unavailable ? null
        : rejectsCursor(failure) ? <Button onClick={restart}>Volver a cargar desde el inicio</Button>
        : <Button onClick={gallery.retry}>Reintentar</Button>}
    </div> : null}
    {!failure && gallery.refreshFailed && !inViewer ? <div className="trips-state">
      <Feedback variant="error">{refreshText}</Feedback>
      <Button onClick={gallery.retryRefresh}>Reintentar</Button>
    </div> : null}
    {phase === "idle" && photos.length === 0 && !hasMore ? empty : null}
    {photos.length > 0 ? <>
      <PhotoGrid label={label} items={items} />
      <p role="status">Mostrando {photos.length} {photos.length === 1 ? "foto" : "fotos"}</p>
      {phase === "more-loading" && !inViewer ? <LoadingState label="Cargando más fotos…" /> : null}
      {hasMore ? <Button aria-disabled={phase === "more-loading" || undefined} onClick={loadMore}>Cargar más</Button> : null}
    </> : null}
    {viewer && portal ? createPortal(<div className="activity-confirm-layer">{viewer}</div>, document.body) : viewer}
  </>;
}
