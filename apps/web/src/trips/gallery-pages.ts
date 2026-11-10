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

/** Refreshes the signed urls and expiry of a page; its photos, order, cursor and the next cursor stay, and so do the other pages. */
export const replacePage = (pages: readonly GalleryPageData[], index: number, fresh: GalleryPageData): GalleryPageData[] => {
  const current = pages[index];
  if (!current) return pages as GalleryPageData[];
  const byId = new Map(fresh.photos.map((photo) => [photo.id, photo]));
  const photos = current.photos.map((photo) => { const next = byId.get(photo.id); return next ? { ...photo, url: next.url, expiresAtMs: next.expiresAtMs } : photo; });
  return pages.map((page, position) => position === index ? { ...current, photos, expiresAtMs: fresh.expiresAtMs } : page);
};

export const flatten = (pages: readonly GalleryPageData[]): GalleryPhoto[] => pages.flatMap((page) => page.photos);
export const isStale = (page: GalleryPageData, now: number, margin = staleMarginMs) => page.expiresAtMs - now <= margin;
export const staleIndexes = (pages: readonly GalleryPageData[], now: number, margin = staleMarginMs) =>
  pages.flatMap((page, index) => isStale(page, now, margin) ? [index] : []);
/** The cursor to ask for the next page: the one the last page returned (null when there is no more). */
export const currentCursor = (pages: readonly GalleryPageData[]): string | null => pages.length === 0 ? null : pages[pages.length - 1]!.nextCursor;
