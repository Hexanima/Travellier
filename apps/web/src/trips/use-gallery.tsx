import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useParams } from "react-router-dom";
import { appendPage, currentCursor, flatten, makePage, replacePage, staleIndexes, type GalleryPageData } from "./gallery-pages.js";
import { readPhoto, readRestore } from "./post-origin.js";
import type { GalleryPage, GalleryPhoto, TripGalleryApi } from "./trip-gallery-api.js";
import type { TripFailure, TripResult } from "./trip-management-api.js";

export type GalleryFilter = { activityId?: string; transportId?: string };
/** `trip` for the whole Trip; T77 filters get their own entry so each keeps its own pages. */
// eslint-disable-next-line react-refresh/only-export-components
export const filterKey = (filter: GalleryFilter) => filter.activityId ? `activity:${filter.activityId}` : filter.transportId ? `transport:${filter.transportId}` : "trip";

/** Throttle of the per-image refresh: one refresh per page every 10 s. */
export const imageRefreshIntervalMs = 10_000;

type Store = Map<string, GalleryPageData[]>;
type GalleryContext = { store: Store; list: TripGalleryApi["list"]; now: () => number };
const Context = createContext<GalleryContext | undefined>(undefined);

/** In-memory snapshots per filter. The signed urls live only here (never in history state, url, storage or logs); the provider is keyed by Trip. */
export type GalleryProviderProps = { list: TripGalleryApi["list"]; now?: () => number };
export function GalleryProvider({ list, now = Date.now, children }: GalleryProviderProps & { children: ReactNode }) {
  const store = useRef<Store>(new Map());
  const value = useMemo(() => ({ store: store.current, list, now }), [list, now]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export type Phase = "initial-loading" | "initial-error" | "idle" | "more-loading" | "more-error";
type State = { pages: GalleryPageData[]; phase: Phase; error?: TripFailure; refreshFailed: boolean; /** Why the last url refresh failed (404/403 tell the filter is gone). */ refreshError?: TripFailure; failed: ReadonlySet<string> };
const pageKey = (cursor: string | null) => cursor ?? "";

export type GalleryPages = {
  photos: GalleryPhoto[]; phase: Phase; error: TripFailure | undefined; hasMore: boolean; refreshFailed: boolean; refreshError: TripFailure | undefined; failed: ReadonlySet<string>;
  loadMore: () => void; retry: () => void; restart: () => void; retryRefresh: () => void; imageError: (photoId: string) => void; retryImage: (photoId: string) => void;
};

/**
 * Pages of the gallery. Every request (first page, «Cargar más», refreshes of expired urls) goes through one serialized queue, so none
 * runs in parallel. Results of a request whose cursor is no longer the current one are discarded.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useGalleryPages(filter: GalleryFilter = {}, { reuse = true }: { reuse?: boolean } = {}): GalleryPages {
  const context = useContext(Context);
  if (!context) throw new Error("useGalleryPages needs a GalleryProvider");
  const { store, list, now } = context;
  const { tripId = "" } = useParams();
  const location = useLocation();
  const key = filterKey(filter);
  const { activityId, transportId } = filter;
  // Read once: only an entry that comes back (restore or open viewer) may reuse the snapshot; a fresh entry asks for page 1.
  // `reuse: false` (the activity filter) always asks page 1, so a relink or a removal made meanwhile is never hidden by an old snapshot.
  const [reusable] = useState(() => reuse && (readRestore(location.state) !== undefined || readPhoto(location.state) !== undefined));
  const [state, setState] = useState<State>({ pages: [], phase: "initial-loading", refreshFailed: false, failed: new Set() });
  const stateRef = useRef(state);
  const generation = useRef(0);
  const mounted = useRef(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const loadingCursor = useRef<string | null>(null);
  const pending = useRef(new Set<string>());
  const tried = useRef(new Map<string, string>());
  const lastRefresh = useRef(new Map<string, number>());
  const failedPages = useRef(new Set<string>());

  const commit = useCallback((update: (current: State) => State) => {
    stateRef.current = update(stateRef.current);
    setState(stateRef.current);
    store.set(key, stateRef.current.pages);
  }, [store, key]);
  const query = useMemo(() => ({ ...(activityId ? { activityId } : {}), ...(transportId ? { transportId } : {}) }), [activityId, transportId]);
  const request = useCallback(async (cursor: string | null): Promise<TripResult<GalleryPage>> => {
    try { return await list(tripId, { ...query, ...(cursor !== null ? { cursor } : {}) }); } catch { return { ok: false, error: { kind: "network" } }; }
  }, [list, tripId, query]);
  const enqueue = useCallback((task: () => Promise<void>) => { queue.current = queue.current.then(task, task).catch(() => undefined); }, []);
  const outdated = (gen: number) => gen !== generation.current || !mounted.current;

  const refreshPage = useCallback((cursor: string | null, gen: number) => {
    const id = pageKey(cursor);
    if (pending.current.has(id)) return;
    pending.current.add(id);
    enqueue(async () => {
      if (outdated(gen) || !stateRef.current.pages.some((page) => page.cursor === cursor)) { pending.current.delete(id); return; }
      lastRefresh.current.set(id, now());
      const result = await request(cursor);
      pending.current.delete(id);
      if (outdated(gen)) return;
      if (result.ok) {
        failedPages.current.delete(id);
        commit((current) => {
          const index = current.pages.findIndex((page) => page.cursor === cursor);
          const pages = replacePage(current.pages, index, makePage(cursor, result.value));
          // A photo whose url changed gets another chance; one that already failed with this very url and came back unchanged is shown as failed.
          const before = new Map((current.pages[index]?.photos ?? []).map((photo) => [photo.id, photo.url]));
          const failed = new Set(current.failed);
          for (const photo of pages[index]?.photos ?? []) {
            if (before.get(photo.id) !== photo.url) failed.delete(photo.id);
            else if (tried.current.get(photo.id) === photo.url) failed.add(photo.id);
          }
          return { ...current, pages, failed, refreshFailed: failedPages.current.size > 0, refreshError: failedPages.current.size > 0 ? current.refreshError : undefined };
        });
      } else {
        failedPages.current.add(id);
        // Photos waiting for this refresh cannot get a new url now: they show the placeholder (and «Reintentar»).
        commit((current) => {
          const failed = new Set(current.failed);
          for (const photo of current.pages.find((page) => page.cursor === cursor)?.photos ?? []) if (tried.current.get(photo.id) === photo.url) failed.add(photo.id);
          return { ...current, failed, refreshFailed: true, refreshError: result.error };
        });
      }
    });
  }, [enqueue, request, now, commit]);

  const refreshStale = useCallback(() => {
    if (!mounted.current) return;
    for (const index of staleIndexes(stateRef.current.pages, now())) refreshPage(stateRef.current.pages[index]!.cursor, generation.current);
  }, [now, refreshPage]);

  const loadFirst = useCallback((gen: number) => enqueue(async () => {
    if (outdated(gen)) return;
    const result = await request(null);
    if (outdated(gen)) return;
    if (result.ok) commit(() => ({ pages: [makePage(null, result.value)], phase: "idle", refreshFailed: false, failed: new Set() }));
    else commit((current) => ({ ...current, pages: [], phase: "initial-error", error: result.error }));
  }), [enqueue, request, commit]);

  const loadMore = useCallback(() => {
    const cursor = currentCursor(stateRef.current.pages);
    if (cursor === null || loadingCursor.current === cursor) return;
    loadingCursor.current = cursor;
    const gen = generation.current;
    commit((current) => ({ ...current, phase: "more-loading", error: undefined }));
    enqueue(async () => {
      const result = await (outdated(gen) ? Promise.resolve(undefined) : request(cursor));
      if (loadingCursor.current === cursor) loadingCursor.current = null;
      // A late answer for a cursor that is no longer the current one (or from before a restart) is dropped.
      if (!result || outdated(gen) || currentCursor(stateRef.current.pages) !== cursor) return;
      if (result.ok) commit((current) => ({ ...current, pages: appendPage(current.pages, makePage(cursor, result.value)), phase: "idle" }));
      else commit((current) => ({ ...current, phase: "more-error", error: result.error }));
    });
  }, [enqueue, request, commit]);

  const restart = useCallback(() => {
    generation.current += 1;
    loadingCursor.current = null; pending.current.clear(); tried.current.clear(); failedPages.current.clear();
    store.delete(key);
    commit(() => ({ pages: [], phase: "initial-loading", refreshFailed: false, failed: new Set() }));
    loadFirst(generation.current);
  }, [store, key, commit, loadFirst]);

  const retry = useCallback(() => {
    const { phase } = stateRef.current;
    if (phase === "initial-error") { commit((current) => ({ ...current, phase: "initial-loading", error: undefined })); loadFirst(generation.current); }
    else if (phase === "more-error") loadMore();
  }, [commit, loadFirst, loadMore]);

  const retryRefresh = useCallback(() => {
    commit((current) => ({ ...current, refreshFailed: false, refreshError: undefined }));
    const gen = generation.current;
    for (const page of stateRef.current.pages) {
      if (!failedPages.current.has(pageKey(page.cursor))) continue;
      for (const photo of page.photos) tried.current.delete(photo.id);
      refreshPage(page.cursor, gen);
    }
  }, [commit, refreshPage]);

  const imageError = useCallback((photoId: string) => {
    const page = stateRef.current.pages.find((item) => item.photos.some((photo) => photo.id === photoId));
    const photo = page?.photos.find((item) => item.id === photoId);
    if (!page || !photo) return;
    const markFailed = () => commit((current) => ({ ...current, failed: new Set(current.failed).add(photoId) }));
    if (tried.current.get(photoId) === photo.url) { // this url already asked for a refresh
      if (!pending.current.has(pageKey(page.cursor))) markFailed(); // the refresh ended and the url did not change: no silent broken image
      return;
    }
    if (tried.current.has(photoId)) { markFailed(); return; } // the refreshed url failed too
    tried.current.set(photoId, photo.url);
    if (pending.current.has(pageKey(page.cursor))) return; // the page is already being refreshed: wait for its new urls
    const last = lastRefresh.current.get(pageKey(page.cursor));
    if (last !== undefined && now() - last < imageRefreshIntervalMs) { markFailed(); return; }
    lastRefresh.current.set(pageKey(page.cursor), now());
    refreshPage(page.cursor, generation.current);
  }, [commit, now, refreshPage]);

  const retryImage = useCallback((photoId: string) => {
    const page = stateRef.current.pages.find((item) => item.photos.some((photo) => photo.id === photoId));
    if (!page) return;
    tried.current.delete(photoId); // a real refresh: the next error on this photo is judged against what the refresh brings
    commit((current) => { const failed = new Set(current.failed); failed.delete(photoId); return { ...current, failed }; });
    lastRefresh.current.set(pageKey(page.cursor), now());
    refreshPage(page.cursor, generation.current);
  }, [commit, now, refreshPage]);

  useEffect(() => {
    mounted.current = true;
    generation.current += 1;
    loadingCursor.current = null; pending.current.clear(); tried.current.clear(); lastRefresh.current.clear(); failedPages.current.clear();
    const snapshot = reusable ? store.get(key) : undefined;
    if (snapshot && snapshot.length > 0) {
      commit(() => ({ pages: snapshot, phase: "idle", refreshFailed: false, failed: new Set() }));
      refreshStale();
    } else {
      store.delete(key);
      commit(() => ({ pages: [], phase: "initial-loading", refreshFailed: false, failed: new Set() }));
      loadFirst(generation.current);
    }
    const onVisible = () => { if (document.visibilityState === "visible") refreshStale(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", refreshStale);
    return () => {
      mounted.current = false; generation.current += 1;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", refreshStale);
    };
  }, [tripId, key, list, query]); // eslint-disable-line react-hooks/exhaustive-deps

  const photos = useMemo(() => flatten(state.pages), [state.pages]);
  return { photos, phase: state.phase, error: state.error, hasMore: currentCursor(state.pages) !== null, refreshFailed: state.refreshFailed, refreshError: state.refreshError, failed: state.failed,
    loadMore, retry, restart, retryRefresh, imageError, retryImage };
}
