import { rootTabOf } from "../trips/trip-tabs.js";

/** What the back press does when no open layer consumed it. */
export type BackAction = { kind: "back" } | { kind: "navigate"; to: string; replace: true } | { kind: "exit" };
export type BackContext = {
  pathname: string;
  /** Trip of the current route, when there is one. */
  tripId: string | undefined;
  /** Whether there is an app entry behind the current one (`canGoBack` of post-origin). */
  canGoBack: boolean;
  /** The Trip was opened from the notices center: its shell shows `Volver a avisos` and the back press must match it. */
  fromNotices: boolean;
};

/** Screens that are a root of the app: with nothing behind them the back press closes the app (the Capacitor default). */
const appRoots = new Set(["/trips", "/", "/login"]);

/**
 * Where a back press goes once every open dialog, sheet and dirty form had its chance.
 * It never resolves to nothing: a root of the Trip returns to its shell origin, anything else goes back, to Mis viajes or out of the app.
 */
export const resolveBackAction = ({ pathname, tripId, canGoBack, fromNotices }: BackContext): BackAction => {
  if (rootTabOf(pathname, tripId)) return { kind: "navigate", to: fromNotices ? "/notifications" : "/trips", replace: true };
  if (canGoBack) return { kind: "back" };
  if (appRoots.has(pathname)) return { kind: "exit" };
  // No entry behind: a screen reached by deep link or notice. `/register` has no session yet, everything else falls back to Mis viajes.
  return { kind: "navigate", to: pathname === "/register" ? "/login" : "/trips", replace: true };
};
