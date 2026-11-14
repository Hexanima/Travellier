import { rootTabOf } from "../trips/trip-tabs.js";

/**
 * What the back press does when no open layer consumed it.
 * `keepHistory` decides the state of the entry that replaces the current one:
 * `true` (every destination but one) leaves the history behind reachable, inheriting `noBack` only when nothing was behind;
 * `false` marks the new entry as having nothing behind even if there was history, and only Mis viajes reached from a root of the Trip does it:
 * the definition taken says the next press there closes the app, so whatever was behind the entry of the root is dropped.
 */
export type BackAction = { kind: "back" } | { kind: "navigate"; to: string; replace: true; keepHistory: boolean } | { kind: "exit" };
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
  // A root of the Trip leaves to whatever opened it. Avisos is a destination with an origin of its own (someone reaches it from the profile or
  // from Mis viajes), so its history stays: dropping it would answer the next press with the fallback to Mis viajes and lose a legitimate back.
  // Mis viajes is the root of the app: the definition taken ends the journey there, so the press marks it as having nothing behind and the
  // next one closes the app. The dominant case (but not the only one) is the Trip opened from a card of Mis viajes: the tabs replace their
  // entry, so the root sat right on top of it and keeping that entry would answer the next press with a back to the screen just reached, with
  // nothing visible. When the root was reached otherwise (a push from inside the Trip, an invitation, a profile that pushed Mis viajes again)
  // the entry behind showed another screen and is dropped too: `docs/REVISION_PENDIENTE.md` (T151) lists what that loses.
  if (rootTabOf(pathname, tripId)) return fromNotices
    ? { kind: "navigate", to: "/notifications", replace: true, keepHistory: true }
    : { kind: "navigate", to: "/trips", replace: true, keepHistory: false };
  if (canGoBack) return { kind: "back" };
  if (appRoots.has(pathname)) return { kind: "exit" };
  // No entry behind: a screen reached by deep link or notice. `/register` has no session yet, everything else falls back to Mis viajes.
  return { kind: "navigate", to: pathname === "/register" ? "/login" : "/trips", replace: true, keepHistory: true };
};
