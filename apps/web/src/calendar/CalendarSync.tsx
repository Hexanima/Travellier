import type { TripItineraryApi, TripItineraryResponse } from "../trips/trip-itinerary-api.js";
import type { CalendarSyncService } from "./calendar-sync-service.js";
import { CalendarSyncPanel } from "./CalendarSyncPanel.js";
import { useCalendarSync } from "./use-calendar-sync.js";

type Props = { service: CalendarSyncService; tripId: string; itinerary: Pick<TripItineraryApi, "get">; loaded: TripItineraryResponse; timeZone?: string };

/** Hook + panel for a loaded itinerary. Rendered only when a service exists (native platform or injected): inert on the web. */
export function CalendarSync({ service, tripId, itinerary, loaded, timeZone }: Props) {
  const calendar = useCalendarSync({ service, tripId, itinerary, loaded });
  return <CalendarSyncPanel status={calendar.status} busy={calendar.busy} timeZone={timeZone} onEnable={() => void calendar.enable()}
    onRetry={() => void calendar.retry()} onStop={() => void calendar.stop()} onRemove={() => void calendar.remove()} onRestore={() => void calendar.restore()} />;
}
