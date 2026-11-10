import { useEffect, useRef } from "react";

/** Two triggers closer than this are one (a return to the foreground fires `visibilitychange` and `focus` together). */
const minGapMs = 1_000;
export const defaultRefreshIntervalMs = 45_000;

/**
 * Refreshes a Trip screen when the app comes back to the foreground (`visibilitychange`, `focus`) and periodically while it is visible.
 * It never refreshes in the background, never starts a refresh while the previous one is pending and does nothing on mount (the screen loads itself).
 * `refresh` may be a new function on every render: the latest one is used.
 */
export function useTripRefresh(refresh: () => void | Promise<unknown>, { intervalMs = defaultRefreshIntervalMs }: { intervalMs?: number } = {}) {
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => {
    let pending = false, last = Number.NEGATIVE_INFINITY;
    const run = (respectGap: boolean) => {
      if (document.visibilityState !== "visible" || pending) return;
      const now = Date.now();
      if (respectGap && now - last < minGapMs) return;
      last = now; pending = true;
      let result: void | Promise<unknown>;
      try { result = latest.current(); } catch { pending = false; return; }
      void Promise.resolve(result).catch(() => undefined).finally(() => { pending = false; });
    };
    const onVisible = () => run(true);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const timer = window.setInterval(() => run(false), intervalMs);
    return () => { document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", onVisible); window.clearInterval(timer); };
  }, [intervalMs]);
}
