import { useRef, useState, type ReactNode, type TouchEvent } from "react";

/** Distance of the downward pull (px) that counts as a request to refresh. */
export const pullThresholdPx = 64;

export type PullToRefreshProps = { onRefresh: () => Promise<unknown> | void; children: ReactNode; threshold?: number };

/**
 * Pull down at the top of the page to refresh (T121). No package: it reads the touch events itself, only starts with the page at the top (`scrollY === 0`)
 * and one finger, and is cancelled if the page scrolls or the finger goes up. It never blocks scrolling (no `preventDefault`). The pull gesture is not the only
 * way: every listing also has an «Actualizar» button. The state is announced politely in a status region that exists only while pulling or refreshing.
 */
export function PullToRefresh({ onRefresh, children, threshold = pullThresholdPx }: PullToRefreshProps) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const origin = useRef<number | null>(null);
  const distance = useRef(0);
  const running = useRef(false);
  const reset = () => { origin.current = null; distance.current = 0; setPull(0); };

  const onStart = (event: TouchEvent) => {
    reset();
    if (running.current || window.scrollY !== 0 || event.touches.length !== 1) return;
    origin.current = event.touches[0]!.clientY;
  };
  const onMove = (event: TouchEvent) => {
    if (origin.current === null) return;
    if (window.scrollY !== 0 || event.touches.length !== 1) { reset(); return; }
    distance.current = Math.max(0, event.touches[0]!.clientY - origin.current);
    setPull(distance.current);
  };
  const onEnd = () => {
    const done = origin.current !== null && distance.current >= threshold && !running.current && window.scrollY === 0;
    reset();
    if (!done) return;
    running.current = true;
    setRefreshing(true);
    void Promise.resolve().then(onRefresh).catch(() => undefined).finally(() => { running.current = false; setRefreshing(false); });
  };

  const armed = pull >= threshold;
  return <div className="pull-to-refresh" onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd} onTouchCancel={reset}>
    {refreshing || armed ? <p className="pull-to-refresh__status" role="status" aria-live="polite">{refreshing ? "Actualizando…" : "Soltá para actualizar"}</p> : null}
    {children}
  </div>;
}
