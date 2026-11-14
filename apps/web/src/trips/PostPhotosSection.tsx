import { useEffect, useRef, type ReactNode } from "react";
import type { PhotoSource } from "app-domain";
import type { PhotoDraftItem } from "./post-draft.js";
import type { SelectOutcome } from "./use-post-photos.js";

export type PostPhotosSectionProps = {
  items: readonly PhotoDraftItem[];
  /** Ids waiting for or in a transfer, and their progress in steps of 5 % (0 to 1). Transient: not part of the draft. */
  active: readonly string[]; progress: Readonly<Record<string, number>>;
  /** The only polite status of the section («Subiendo fotos: 2 de 5»). */
  summary: string;
  /** The only alert of the section: selection problems and the summary of upload errors. Per-photo errors are plain text. */
  alert?: ReactNode;
  /** Saving, uploading or selecting: the controls stay focusable (`aria-disabled`) and ignore the press. */
  busy: boolean;
  /** Increment to move the focus to the first «Reintentar» (after an upload error). */
  focusRetry: number;
  onAdd: (source: PhotoSource) => Promise<SelectOutcome>;
  onRemove: (localId: string) => void;
  onMove: (localId: string, delta: -1 | 1) => void;
  onRetry: (localId: string) => void;
};
/** Texto corto por foto: el de la espera agotada acompaña a «Sin conexión.» y no repite «Intentá nuevamente», que ya es el botón «Reintentar» de la fila. */
const failureText: Record<string, string> = { network: "Sin conexión.", timeout: "La conexión tardó demasiado.", expired: "El permiso de subida venció.", rejected: "El servidor rechazó la foto.",
  missing: "Volvé a elegir esta foto.", not_uploaded: "No llegó al servidor.", too_large: "Pesa más de 10 MB.", content_type_mismatch: "El formato no coincide.",
  invalid: "No se pudo usar esta foto.", duplicate: "Está repetida.", server: "El servidor no respondió bien.", "not-found": "El recuerdo ya no está disponible." };
type Pending = { kind: "remove"; index: number } | { kind: "move"; localId: string; delta: -1 | 1 };

export function PostPhotosSection({ items, active, progress, summary, alert, busy, focusRetry, onAdd, onRemove, onMove, onRetry }: PostPhotosSectionProps) {
  const galleryRef = useRef<HTMLButtonElement>(null), cameraRef = useRef<HTMLButtonElement>(null), listRef = useRef<HTMLUListElement>(null);
  const pending = useRef<Pending>(undefined);
  // The focus follows what the person did once the list re-rendered: the next photo after removing, the moved photo after reordering.
  useEffect(() => {
    const action = pending.current; pending.current = undefined;
    if (!action) return;
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>("li[data-photo]") ?? []);
    if (action.kind === "remove") {
      (rows[action.index]?.querySelector<HTMLElement>("[data-photo-remove]") ?? galleryRef.current)?.focus();
      return;
    }
    const row = rows.find((element) => element.dataset.photo === action.localId);
    const preferred = row?.querySelector<HTMLElement>(action.delta < 0 ? "[data-photo-up]" : "[data-photo-down]");
    const other = row?.querySelector<HTMLElement>(action.delta < 0 ? "[data-photo-down]" : "[data-photo-up]");
    (preferred?.getAttribute("aria-disabled") === "true" ? other : preferred)?.focus();
  }, [items]);
  const retryToken = useRef(focusRetry);
  useEffect(() => {
    if (focusRetry === retryToken.current) return;
    retryToken.current = focusRetry;
    listRef.current?.querySelector<HTMLElement>("[data-photo-retry]")?.focus();
  }, [focusRetry]);
  const open = async (source: PhotoSource, ref: { current: HTMLButtonElement | null }) => {
    if (busy) return;
    if (await onAdd(source) === "cancelled") ref.current?.focus();
  };
  const label = (index: number) => `Foto ${index + 1} de ${items.length}`;
  const statusOf = (item: PhotoDraftItem) => {
    if (active.includes(item.localId)) return progress[item.localId] !== undefined ? `Subiendo ${Math.round(progress[item.localId]! * 100)} %` : "Subiendo…";
    return item.status === "failed" ? `No se subió. ${failureText[item.failure ?? ""] ?? ""}`.trim() : "Lista";
  };
  return <section className="post-photos-section" aria-labelledby="post-photos-heading">
    <h2 id="post-photos-heading">Fotos</h2>
    <div className="post-photos-add">
      <button ref={galleryRef} type="button" className="ui-button" name="addPhotos" aria-disabled={busy || undefined} onClick={() => void open("gallery", galleryRef)}>Agregar fotos</button>
      <button ref={cameraRef} type="button" className="ui-button" name="takePhoto" aria-disabled={busy || undefined} onClick={() => void open("camera", cameraRef)}>Sacar foto</button>
    </div>
    <p role="status" className="itinerary-secondary">{summary}</p>
    {alert ? <p role="alert" className="ui-field__error">{alert}</p> : null}
    {items.length > 0 ? <ul ref={listRef} className="post-photos-list">
      {items.map((item, index) => <li key={item.localId} data-photo={item.localId} className="post-photo">
        {item.previewUrl ? <img src={item.previewUrl} alt={label(index)} width={64} height={64} /> : <span className="post-photo-placeholder" role="img" aria-label={label(index)} />}
        <span className="post-photo-status">{statusOf(item)}</span>
        <span className="post-photo-actions">
          <button type="button" className="ui-button" data-photo-remove aria-disabled={busy || undefined} aria-label={`Quitar ${label(index).toLowerCase()}`}
            onClick={() => { if (busy) return; pending.current = { kind: "remove", index }; onRemove(item.localId); }}>Quitar</button>
          <button type="button" className="ui-button" data-photo-up aria-disabled={busy || index === 0 || undefined} aria-label={`Subir ${label(index).toLowerCase()}`}
            onClick={() => { if (busy || index === 0) return; pending.current = { kind: "move", localId: item.localId, delta: -1 }; onMove(item.localId, -1); }}>Subir</button>
          <button type="button" className="ui-button" data-photo-down aria-disabled={busy || index === items.length - 1 || undefined} aria-label={`Bajar ${label(index).toLowerCase()}`}
            onClick={() => { if (busy || index === items.length - 1) return; pending.current = { kind: "move", localId: item.localId, delta: 1 }; onMove(item.localId, 1); }}>Bajar</button>
          {item.status === "failed" && !active.includes(item.localId) ? <button type="button" className="ui-button" data-photo-retry aria-disabled={busy || undefined}
            aria-label={`Reintentar ${label(index).toLowerCase()}`} onClick={() => { if (!busy) onRetry(item.localId); }}>Reintentar</button> : null}
        </span>
      </li>)}
    </ul> : null}
  </section>;
}
