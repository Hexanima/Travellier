import "./itinerary.css";

/** `src` is a signed, short-lived url: it goes only into the `img` and nowhere else. */
export type PhotoGridItem = {
  id: string; src: string;
  /** Accessible name of the open button, e.g. «Foto 2 de 10. De Ana, 10 nov». */
  name: string;
  /** Visible short text: author and local date only. */
  caption?: string;
  onOpen: () => void; onError: () => void; onRetry?: () => void;
  /** The image could not load even after a refresh: a placeholder with a retry is shown. */
  failed?: boolean;
};

/** Presentational and reusable (no network): thumbnails aligned at the top in common rows. */
export function PhotoGrid({ label, items }: { label: string; items: readonly PhotoGridItem[] }) {
  return <ul className="photo-grid" aria-label={label}>
    {items.map((item) => <li className="photo-grid__item" key={item.id} data-photo={item.id}>
      {item.failed ? <div className="photo-grid__failed">
        <p>No se pudo cargar la imagen</p>
        <button type="button" onClick={item.onRetry}>Reintentar</button>
      </div> : <button className="photo-grid__open" type="button" aria-label={item.name} onClick={item.onOpen}>
        <img src={item.src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={item.onError} />
      </button>}
      {item.caption ? <p className="photo-grid__caption">{item.caption}</p> : null}
    </li>)}
  </ul>;
}
