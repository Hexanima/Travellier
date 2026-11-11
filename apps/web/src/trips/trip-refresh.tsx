import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { AppLifecycle } from "../native/app-lifecycle.js";

/** Same interval as the notices/balance refresh (T85); the PRD asks for 30–60 s. */
export const tripRefreshIntervalMs = 45_000;
/** Two triggers closer than this are one (a return to the foreground fires `visibilitychange` and `focus` together). */
const minGapMs = 1_000;

/**
 * `gone`: the Trip aggregate is not found or forbidden (deleted, access revoked) → the provider leaves to «Mis viajes».
 * `unauthorized`: the http client already handled the session. `error`: network/server/secondary failure, silent when the screen has data.
 */
export type RefreshOutcome = { status: "ok" | "gone" | "unauthorized" | "error" };
export type RefreshLoader = (context: { signal: AbortSignal }) => Promise<RefreshOutcome>;
type Registered = { current: RefreshLoader };
type Api = { register: (id: string, loader: Registered) => () => void; pause: () => () => void; refreshNow: () => Promise<void> };
const Context = createContext<Api | undefined>(undefined);

/**
 * Single ticker of the Trip: refreshes the loaders of the screens that are mounted when the app returns to the foreground, on a pull, and every
 * `intervalMs` while the document is visible; never in the background and never while paused. A loader that is already running is reused, not repeated.
 * Mount it with `key={tripId}` below the Trip providers; leaving the Trip stops the timer and aborts what is in flight. The Trip screens work without it.
 */
export function TripRefreshProvider({ tripId, lifecycle, intervalMs = tripRefreshIntervalMs, children }: {
  tripId?: string; lifecycle?: AppLifecycle; intervalMs?: number; children: ReactNode;
}) {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const loaders = useRef(new Map<string, Registered>());
  const paused = useRef(0);
  const cycle = useRef<{ signal: AbortSignal; inflight: Map<string, Promise<void>>; run: (respectGap: boolean) => void } | undefined>(undefined);

  const refreshAll = useCallback((): Promise<void> => {
    const current = cycle.current;
    if (!current) return Promise.resolve();
    const { signal, inflight } = current;
    for (const [id, loader] of loaders.current) {
      if (inflight.has(id)) continue;
      const task = Promise.resolve().then(() => loader.current({ signal })).then((outcome) => {
        if (!signal.aborted && outcome.status === "gone") navigateRef.current("/trips", { replace: true, state: { tripGone: true } });
      }, () => undefined).finally(() => { if (inflight.get(id) === task) inflight.delete(id); });
      inflight.set(id, task);
    }
    return Promise.all([...inflight.values()]).then(() => undefined);
  }, []);

  const api = useMemo<Api>(() => ({
    register: (id, loader) => { loaders.current.set(id, loader); return () => { if (loaders.current.get(id) === loader) loaders.current.delete(id); }; },
    pause: () => {
      paused.current += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true; paused.current -= 1;
        // What was skipped while paused is caught up once.
        if (paused.current === 0) cycle.current?.run(false);
      };
    },
    refreshNow: () => refreshAll(),
  }), [refreshAll]);

  useEffect(() => {
    const controller = new AbortController();
    const inflight = new Map<string, Promise<void>>();
    let last = Number.NEGATIVE_INFINITY;
    const run = (respectGap: boolean) => {
      if (document.visibilityState !== "visible" || paused.current > 0) return;
      const now = Date.now();
      if (respectGap && now - last < minGapMs) return;
      last = now;
      void refreshAll();
    };
    cycle.current = { signal: controller.signal, inflight, run };
    const onVisibility = () => run(true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    const stopLifecycle = lifecycle?.onResume(() => run(true));
    const timer = window.setInterval(() => run(false), intervalMs);
    return () => {
      controller.abort();
      inflight.clear();
      if (cycle.current?.signal === controller.signal) cycle.current = undefined;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
      stopLifecycle?.();
      window.clearInterval(timer);
    };
  }, [tripId, lifecycle, intervalMs, refreshAll]);

  return <Context.Provider value={api}>{children}</Context.Provider>;
}

/** Registers the silent refresh of a mounted screen under `id`. `load` may change on every render: the latest one runs. Without a provider it does nothing. */
export function useTripRefreshLoader(id: string, load: RefreshLoader) {
  const api = useContext(Context);
  const latest = useRef(load);
  latest.current = load;
  useEffect(() => api?.register(id, latest), [api, id]);
}

/** While `active`, the periodic and foreground refreshes wait (open dialog, save in progress, photo viewer); when released one refresh catches up. */
export function useRefreshGuard(active: boolean) {
  const api = useContext(Context);
  useEffect(() => (active ? api?.pause() : undefined), [api, active]);
}

/** Refreshes the mounted screens now (pull to refresh and «Actualizar»); resolves when they finish. Without a provider it does nothing. */
export function useRefreshNow(): () => Promise<void> {
  const api = useContext(Context);
  return useCallback(() => api?.refreshNow() ?? Promise.resolve(), [api]);
}
