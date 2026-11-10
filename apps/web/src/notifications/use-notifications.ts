import { useCallback, useEffect, useRef, useState } from "react";
import type { TripFailure, TripResult } from "../trips/trip-management-api.js";
import type { NotificationPage, TripNotification, TripNotificationApi } from "./trip-notification-api.js";

export type NotificationsPhase = "loading" | "idle" | "error" | "more-loading" | "more-error" | "unauthorized";
export type NotificationsState = {
  items: TripNotification[]; phase: NotificationsPhase; error: TripFailure | undefined; hasMore: boolean;
  /** The last background refresh failed; what was loaded is kept. */
  refreshFailed: boolean;
  loadMore: () => void; retry: () => void; refresh: () => Promise<void>;
};
type State = { items: TripNotification[]; cursor: string | null; pages: number; phase: NotificationsPhase; error?: TripFailure; refreshFailed: boolean };
const initial: State = { items: [], cursor: null, pages: 0, phase: "loading", refreshFailed: false };

const append = (items: TripNotification[], more: TripNotification[]) => {
  const seen = new Set(items.map((item) => item.id));
  return [...items, ...more.filter((item) => !seen.has(item.id))];
};

/**
 * The personal inbox. Pages come in the server's order; «Cargar más» uses the opaque cursor and an answer for a cursor that is no longer the
 * current one is dropped. Refreshing (a signal, a return to the foreground) keeps what was loaded and never runs two at once.
 */
export function useNotifications(list: TripNotificationApi["list"], { refreshSignal }: { refreshSignal?: number } = {}): NotificationsState {
  const [state, setState] = useState<State>(initial);
  const stateRef = useRef(state);
  const mounted = useRef(false);
  const generation = useRef(0);
  const loadingCursor = useRef<string | null>(null);
  const refreshing = useRef<Promise<void> | undefined>(undefined);
  const commit = useCallback((update: (current: State) => State) => { stateRef.current = update(stateRef.current); setState(stateRef.current); }, []);
  const request = useCallback(async (cursor?: string): Promise<TripResult<NotificationPage>> => {
    try { return await list(cursor === undefined ? {} : { cursor }); } catch { return { ok: false, error: { kind: "network" } }; }
  }, [list]);
  const expired = useCallback(() => commit(() => ({ items: [], cursor: null, pages: 0, phase: "unauthorized", error: { kind: "unauthorized" }, refreshFailed: false })), [commit]);

  const loadFirst = useCallback(async (gen: number) => {
    const result = await request();
    if (gen !== generation.current || !mounted.current) return;
    if (result.ok) commit(() => ({ items: result.value.notifications, cursor: result.value.nextCursor, pages: 1, phase: "idle", refreshFailed: false }));
    else if (result.error.kind === "unauthorized") expired();
    else commit((current) => ({ ...current, items: [], cursor: null, pages: 0, phase: "error", error: result.error }));
  }, [request, commit, expired]);

  const loadMore = useCallback(() => {
    const { cursor, phase } = stateRef.current;
    if (cursor === null || (phase !== "idle" && phase !== "more-error") || loadingCursor.current === cursor) return;
    loadingCursor.current = cursor;
    const gen = generation.current;
    commit((current) => ({ ...current, phase: "more-loading", error: undefined }));
    void request(cursor).then((result) => {
      if (loadingCursor.current === cursor) loadingCursor.current = null;
      // A late answer for a cursor that is no longer the current one (or from before a restart) is dropped.
      if (gen !== generation.current || !mounted.current || stateRef.current.cursor !== cursor) {
        if (mounted.current && stateRef.current.phase === "more-loading" && stateRef.current.cursor !== cursor) commit((current) => ({ ...current, phase: "idle" }));
        return;
      }
      if (result.ok) commit((current) => ({ ...current, items: append(current.items, result.value.notifications), cursor: result.value.nextCursor, pages: current.pages + 1, phase: "idle" }));
      else if (result.error.kind === "unauthorized") expired();
      else commit((current) => ({ ...current, phase: "more-error", error: result.error }));
    });
  }, [request, commit, expired]);

  const refresh = useCallback((): Promise<void> => {
    if (refreshing.current) return refreshing.current;
    const { phase } = stateRef.current;
    if (phase === "loading" || phase === "error" || phase === "unauthorized") return Promise.resolve();
    const gen = generation.current;
    const run = request().then((result) => {
      if (gen !== generation.current || !mounted.current) return;
      if (result.ok) {
        commit((current) => {
          const fresh = result.value.notifications;
          const freshIds = new Set(fresh.map((item) => item.id));
          // The first page is replaced; what had been loaded beyond it stays, with its own cursor.
          return { ...current, items: [...fresh, ...current.items.filter((item) => !freshIds.has(item.id))],
            cursor: current.pages > 1 ? current.cursor : result.value.nextCursor, refreshFailed: false };
        });
      } else if (result.error.kind === "unauthorized") expired();
      else commit((current) => ({ ...current, refreshFailed: true }));
    }).finally(() => { refreshing.current = undefined; });
    refreshing.current = run;
    return run;
  }, [request, commit, expired]);

  const retry = useCallback(() => {
    const { phase } = stateRef.current;
    if (phase === "error") { commit((current) => ({ ...current, phase: "loading", error: undefined })); void loadFirst(generation.current); }
    else if (phase === "more-error") loadMore();
  }, [commit, loadFirst, loadMore]);

  useEffect(() => {
    mounted.current = true;
    generation.current += 1;
    loadingCursor.current = null; refreshing.current = undefined;
    commit(() => initial);
    void loadFirst(generation.current);
    return () => { mounted.current = false; generation.current += 1; };
  }, [list]); // eslint-disable-line react-hooks/exhaustive-deps

  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    void refresh();
  }, [refreshSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  return { items: state.items, phase: state.phase, error: state.error, hasMore: state.cursor !== null, refreshFailed: state.refreshFailed, loadMore, retry, refresh };
}
