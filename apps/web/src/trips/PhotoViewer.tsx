import { useEffect, useRef, type MouseEvent } from "react";
import { Modal } from "../components/index.js";
import type { GalleryPhoto } from "./trip-gallery-api.js";
import "./itinerary.css";

export type PhotoViewerProps = {
  photos: readonly GalleryPhoto[]; photoId: string; hasMore: boolean; loadingMore: boolean;
  authorOf: (photo: GalleryPhoto) => string; timeZone: string; postHref: (photo: GalleryPhoto) => string;
  onSelect: (photoId: string) => void; onLoadMore: () => void; onClose: () => void; onOpenPost: (photo: GalleryPhoto) => void;
  onImageError: (photoId: string) => void; onRetryImage: (photoId: string) => void;
  /** The image could not load even after a refresh. */
  failed: boolean;
  /** Load or refresh failure shown inside the dialog as its single alert (the page hides its own while the viewer is open). */
  notice?: string;
  onRetryNotice?: () => void;
};

/** Enlarged photo over the loaded ones. It is controlled: the open photo lives in the history state (an id), never a url. */
export function PhotoViewer({ photos, photoId, hasMore, loadingMore, authorOf, timeZone, postHref, onSelect, onLoadMore, onClose, onOpenPost, onImageError, onRetryImage, failed, notice, onRetryNotice }: PhotoViewerProps) {
  const index = photos.findIndex((item) => item.id === photoId);
  const current = photos[index];
  const awaitingMore = useRef(false);

  // After «Siguiente» on the last loaded photo, move to the first new one once the page arrived.
  useEffect(() => {
    if (!awaitingMore.current || loadingMore) return;
    awaitingMore.current = false;
    const next = photos[index + 1];
    if (next) onSelect(next.id);
  }, [photos.length, loadingMore]); // eslint-disable-line react-hooks/exhaustive-deps

  const atStart = index <= 0;
  const atEnd = index >= photos.length - 1 && !hasMore;
  const previous = () => { if (!atStart) onSelect(photos[index - 1]!.id); };
  const next = () => {
    if (index < photos.length - 1) onSelect(photos[index + 1]!.id);
    else if (hasMore && !loadingMore) { awaitingMore.current = true; onLoadMore(); }
  };
  const latest = useRef({ previous, next });
  latest.current = { previous, next };
  useEffect(() => {
    // Auxiliary keyboard shortcut: the buttons stay the primary control.
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key === "ArrowLeft") latest.current.previous();
      else if (event.key === "ArrowRight") latest.current.next();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  if (!current) return null;
  const day = new Intl.DateTimeFormat("es-AR", { timeZone, day: "numeric", month: "short", year: "numeric" });
  const moment = new Intl.DateTimeFormat("es-AR", { timeZone, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const author = authorOf(current);
  const guarded = (disabled: boolean, action: () => void) => ({ "aria-disabled": disabled || undefined, onClick: () => { if (!disabled) action(); } });
  const openPost = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onOpenPost(current);
  };
  return <Modal isOpen closeOnEscape onClose={onClose} error={notice} title={`Foto ${index + 1} de ${photos.length}${hasMore ? " cargadas" : ""}`}>
    <div className="photo-viewer">
      {notice && onRetryNotice ? <button type="button" onClick={onRetryNotice}>Reintentar</button> : null}
      {loadingMore ? <p role="status">Cargando más fotos…</p> : null}
      {failed ? <div className="photo-viewer__failed">
        <p>No se pudo cargar la imagen</p>
        <button type="button" onClick={() => onRetryImage(current.id)}>Reintentar</button>
      </div> : <img src={current.url} alt={`Foto de ${author} del ${day.format(new Date(current.uploadedAt))}`} referrerPolicy="no-referrer" onError={() => onImageError(current.id)} />}
      <p>De {author}, <time dateTime={current.uploadedAt}>{moment.format(new Date(current.uploadedAt))}</time></p>
      <div className="photo-viewer__nav">
        <button type="button" {...guarded(atStart, previous)}>Anterior</button>
        <button type="button" {...guarded(atEnd || (index >= photos.length - 1 && loadingMore), next)}>Siguiente</button>
      </div>
      <a className="trips-settings-link" href={postHref(current)} onClick={openPost}>Ver recuerdo</a>
    </div>
  </Modal>;
}
