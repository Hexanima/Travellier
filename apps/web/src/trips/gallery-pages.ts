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
