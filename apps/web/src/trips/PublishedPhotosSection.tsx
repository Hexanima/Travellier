import { useState } from "react";
import type { PublishedPhoto } from "./trip-photo-api.js";

export type PublishedPhotosSectionProps = {
  items: readonly PublishedPhoto[];
  /** Ids marked to be removed when the memory is saved (reversible until then). */
  marked: readonly string[];
  /** Saving or uploading: the controls stay focusable (`aria-disabled`) and ignore the press. */
  busy: boolean;
  onToggle: (photoId: string) => void;
};

/**
 * The photos already published by the author, with a thumbnail only while the signed url is in memory (it is never stored in the draft)
 * and a placeholder otherwise or when it fails to load. «Quitar» is a reversible mark: nothing is deleted until the memory is saved.
 */
export function PublishedPhotosSection({ items, marked, busy, onToggle }: PublishedPhotosSectionProps) {
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());
  if (items.length === 0) return null;
  const label = (index: number) => `foto publicada ${index + 1} de ${items.length}`;
  const caption = (index: number) => `Foto publicada ${index + 1} de ${items.length}`;
  return <section className="post-photos-section" data-published-photos aria-labelledby="published-photos-heading">
    <h2 id="published-photos-heading">Fotos publicadas</h2>
    <ul className="post-photos-list">
      {items.map((item, index) => {
        const removed = marked.includes(item.id);
        return <li key={item.id} data-published-photo={item.id} className="post-photo">
          {item.url && !broken.has(item.id)
            ? <img src={item.url} alt={caption(index)} width={64} height={64} onError={() => setBroken((current) => new Set(current).add(item.id))} />
            : <span className="post-photo-placeholder" role="img" aria-label={caption(index)} />}
          <span className="post-photo-status">{removed ? "Se quitará al guardar" : "Publicada"}</span>
          <span className="post-photo-actions">
            <button type="button" className="ui-button" aria-disabled={busy || undefined} aria-label={removed ? `Deshacer quitar ${label(index)}` : `Quitar ${label(index)}`}
              onClick={() => { if (!busy) onToggle(item.id); }}>{removed ? "Deshacer" : "Quitar"}</button>
          </span>
        </li>;
      })}
    </ul>
  </section>;
}
