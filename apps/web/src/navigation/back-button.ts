import { canGoBack, withNoBack } from "../trips/post-origin.js";
import { rootTabOf, tabPath } from "../trips/trip-tabs.js";

type BackButtonEvent = { canGoBack: boolean };
type BackButtonHandle = { remove: () => Promise<void> };

/** The slice of `@capacitor/app` used for the hardware/system Back. Injectable so it can be simulated. */
export type NativeBackButtonApi = {
  addListener: (eventName: "backButton", listener: (event: BackButtonEvent) => void) => Promise<BackButtonHandle>;
  exitApp: () => Promise<void>;
};

export type BackAction =
  | { kind: "history" }
  | { kind: "navigate"; to: string; state?: unknown }
  | { kind: "exit" };

const appRoots = new Set(["/", "/login", "/register", "/trips"]);
const tripAreas = new Set(["new", "join", "explore"]);

/** The Trip id of `/trips/<id>/...`, or undefined for any other path (including /trips/new, /trips/join and /trips/explore/...). */
const tripIdOf = (pathname: string): string | undefined => {
  const [, trips, id, ...rest] = pathname.split("/");
  return trips === "trips" && id && rest.length > 0 && rest[0] !== "" && !tripAreas.has(id) ? id : undefined;
};

/**
 * What the system Back does. Registering a `backButton` listener disables the default of Capacitor, so every case is decided here:
 * - something behind in the app (router entry and webview history): go back through the history, which is also what closes details and dialogs;
 * - nothing behind: a root of the Trip leaves to Mis viajes, another screen of the Trip goes to the diary of that Trip, the app roots exit the app,
 *   and any other screen goes to Mis viajes. Entries are replaced so the app never piles up history.
 */
export function decideBack(location: { pathname: string; key: string; state: unknown }, webviewCanGoBack: boolean): BackAction {
  if (canGoBack(location) && webviewCanGoBack) return { kind: "history" };
  const pathname = location.pathname.length > 1 ? location.pathname.replace(/\/+$/, "") : location.pathname;
  if (appRoots.has(pathname)) return { kind: "exit" };
  const tripId = tripIdOf(pathname);
  if (tripId && !rootTabOf(pathname, tripId)) return { kind: "navigate", to: tabPath(tripId, "diary"), state: withNoBack() };
  return { kind: "navigate", to: "/trips" };
}

/** Registers the listener once and returns how to remove it. */
export async function initializeBackButton(nativeBack: NativeBackButtonApi, handle: (event: BackButtonEvent) => void): Promise<() => Promise<void>> {
  const registered = await nativeBack.addListener("backButton", handle);
  return () => registered.remove();
}
