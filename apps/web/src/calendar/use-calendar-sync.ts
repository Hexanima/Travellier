import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { TripItineraryApi, TripItineraryResponse } from "../trips/trip-itinerary-api.js";
import { useTripRefresh } from "../trips/use-trip-refresh.js";
import type { CalendarSyncService } from "./calendar-sync-service.js";

type Options = { service: CalendarSyncService; tripId: string; itinerary: Pick<TripItineraryApi, "get">; loaded: TripItineraryResponse };

/** States in which a periodic or resume trigger has nothing to keep up to date (not enabled, or waiting for the user). */
const idle = ["checking", "off", "needs-account", "needs-permission", "denied", "syncing", "removing-partial"];

/**
 * Connects the screen to the sync service. Opening only reads what was saved (silent: no permission dialog, no calendar access).
 * Every successful itinerary load (also after a save or a manual refresh) triggers a sync, which does nothing unless the user enabled it.
 * While enabled, returning to the foreground and the periodic refresh (T85) re-read the itinerary and sync; never in the background.
 */
export function useCalendarSync({ service, tripId, itinerary, loaded }: Options) {
  const status = useSyncExternalStore(service.subscribe, () => service.getStatus(tripId));
  const [acting, setActing] = useState(false);
  const running = useRef(false);
  const latest = useRef(loaded);
  latest.current = loaded;

  useEffect(() => { void service.init(tripId); }, [service, tripId]);
  useEffect(() => { if (document.visibilityState === "visible") void service.sync(tripId, loaded); }, [service, tripId, loaded]);
  useTripRefresh(async () => {
    if (idle.includes(service.getStatus(tripId).state)) return;
    const result = await itinerary.get(tripId);
    if (result.ok) await service.sync(tripId, result.value);
  });

  // One action at a time; the ref closes the window between two clicks of the same tick.
  const act = async (task: () => Promise<unknown>) => {
    if (running.current) return;
    running.current = true; setActing(true);
    try { await task(); } finally { running.current = false; setActing(false); }
  };
  return {
    status,
    busy: acting || status.state === "syncing",
    enable: () => act(() => service.enable(tripId, latest.current)),
    retry: () => act(() => service.sync(tripId, latest.current)),
    restore: () => act(() => service.restore(tripId, latest.current)),
    stop: () => act(() => service.disable(tripId)),
    remove: () => act(() => service.removeAll(tripId)),
  };
}
