import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { TripManagementApi } from "./trip-management-api.js";

const NameContext = createContext("");
const FrameContext = createContext(false);

/**
 * State of the Trip shared by every screen inside it. The Trip is asked once, without blocking the screens (a failure leaves an empty name).
 * Mount it with `key={tripId}` so another Trip never reuses the previous state.
 */
export function TripProvider({ tripId, trips, children }: { tripId?: string; trips?: Pick<TripManagementApi, "get">; children: ReactNode }) {
  const [name, setName] = useState("");
  useEffect(() => {
    if (!tripId || !trips) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await trips.get(tripId);
        if (!cancelled && result.ok) setName(result.value.name);
      } catch { /* the name is only a heading: leave it empty */ }
    })();
    return () => { cancelled = true; };
  }, [tripId, trips]);
  return <NameContext.Provider value={name}>{children}</NameContext.Provider>;
}

/** Name of the Trip when known, empty otherwise. */
export const useTripName = () => useContext(NameContext);

/** Marks that the screens below are rendered inside the tabs frame (it provides `<main>`, the way back and the Trip heading). */
export function ShellFrame({ children }: { children: ReactNode }) {
  return <FrameContext.Provider value>{children}</FrameContext.Provider>;
}
export const useInTripShell = () => useContext(FrameContext);
