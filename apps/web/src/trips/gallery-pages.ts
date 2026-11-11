import type { GalleryPage, GalleryPhoto } from "./trip-gallery-api.js";

/** Loaded pages of the gallery in server order. `cursor` is the one that requested the page (null for the first). Pure and immutable. */
export type GalleryPageData = { cursor: string | null; photos: GalleryPhoto[]; nextCursor: string | null; expiresAtMs: number };

export const staleMarginMs = 30_000;

export const makePage = (cursor: string | null, page: GalleryPage): GalleryPageData => ({
  cursor, photos: page.photos, nextCursor: page.nextCursor, expiresAtMs: Math.min(Number.POSITIVE_INFINITY, ...page.photos.map((photo) => photo.expiresAtMs)),
});

/** Adds a page at the end; a photo already loaded in any earlier page keeps its first appearance. */
export const appendPage = (pages: readonly GalleryPageData[], page: GalleryPageData): GalleryPageData[] => {
  const seen = new Set(pages.flatMap((item) => item.photos.map((photo) => photo.id)));
  const photos = page.photos.filter((photo) => !seen.has(photo.id) && seen.add(photo.id));
  return [...pages, { ...page, photos }];
};

/**
 * Refreshes the signed urls and expiry of a page. The answer is the server truth for that cursor: a photo it no longer has is dropped (an old url
 * must never inherit a new expiry), so the page may end up with fewer photos than the limit. Order, cursor and next cursor stay (the next page
 * still starts where this one ended), and so do the other pages. Photos that only the answer has are not added: they belong to another page.
 */
export const replacePage = (pages: readonly GalleryPageData[], index: number, fresh: GalleryPageData): GalleryPageData[] => {
  const current = pages[index];
  if (!current) return pages as GalleryPageData[];
  const byId = new Map(fresh.photos.map((photo) => [photo.id, photo]));
  const photos = current.photos.flatMap((photo) => { const next = byId.get(photo.id); return next ? [{ ...photo, url: next.url, expiresAtMs: next.expiresAtMs }] : []; });
  const expiresAtMs = Math.min(Number.POSITIVE_INFINITY, ...photos.map((photo) => photo.expiresAtMs));
  return pages.map((page, position) => position === index ? { ...current, photos, expiresAtMs } : page);
};

export const flatten = (pages: readonly GalleryPageData[]): GalleryPhoto[] => pages.flatMap((page) => page.photos);
export const isStale = (page: GalleryPageData, now: number, margin = staleMarginMs) => page.expiresAtMs - now <= margin;
export const staleIndexes = (pages: readonly GalleryPageData[], now: number, margin = staleMarginMs) =>
  pages.flatMap((page, index) => isStale(page, now, margin) ? [index] : []);
/** The cursor to ask for the next page: the one the last page returned (null when there is no more). */
export const currentCursor = (pages: readonly GalleryPageData[]): string | null => pages.length === 0 ? null : pages[pages.length - 1]!.nextCursor;

/**
 * Silent refresh of the first page (T121). A signed url is never swapped for a known photo (the image would reload every cycle; expired urls have their own
 * refresh): only the ids matter. Photos the answer has and the first page does not go first (the answer is newest first); the first page keeps the rest, the
 * following pages and its `nextCursor` (the next page still starts where the old first page ended). The exception is a single complete page (no cursor in
 * the answer either): there the answer is the truth and removed photos leave. If the answer is a full page that shares no id with the first page (more new
 * photos than a page) the pages restart from the answer and its cursor, so no gap is left. Same array when the ids did not change.
 */
export const mergeFirstPage = (pages: readonly GalleryPageData[], fresh: GalleryPageData): GalleryPageData[] => {
  const first = pages[0];
  if (!first || first.cursor !== null) return pages as GalleryPageData[];
  // More new photos than a page: the answer shares nothing with the old first page, so keeping its `nextCursor` would leave a gap. Restart from the
  // answer and its cursor (the rest is loaded again by scrolling); photos already loaded keep their snapshot and url.
  const overlaps = fresh.photos.some((photo) => first.photos.some((old) => old.id === photo.id));
  if (!overlaps && fresh.nextCursor !== null && first.photos.length > 0 && fresh.photos.length > 0) {
    const loaded = new Map(pages.flatMap((page) => page.photos.map((photo) => [photo.id, photo] as const)));
    const photos = fresh.photos.map((photo) => loaded.get(photo.id) ?? photo);
    return [{ ...fresh, photos, expiresAtMs: Math.min(Number.POSITIVE_INFINITY, ...photos.map((photo) => photo.expiresAtMs)) }];
  }
  const known = new Map(first.photos.map((photo) => [photo.id, photo]));
  const later = new Set(pages.slice(1).flatMap((page) => page.photos.map((photo) => photo.id)));
  const answer = fresh.photos.filter((photo) => !later.has(photo.id)).map((photo) => known.get(photo.id) ?? photo);
  const complete = pages.length === 1 && first.nextCursor === null && fresh.nextCursor === null;
  const answered = new Set(answer.map((photo) => photo.id));
  const photos = complete ? answer : [...answer, ...first.photos.filter((photo) => !answered.has(photo.id))];
  if (photos.length === first.photos.length && photos.every((photo, index) => photo.id === first.photos[index]!.id)) return pages as GalleryPageData[];
  const expiresAtMs = Math.min(Number.POSITIVE_INFINITY, ...photos.map((photo) => photo.expiresAtMs));
  return pages.map((page, index) => index === 0 ? { ...first, photos, expiresAtMs } : page);
};
