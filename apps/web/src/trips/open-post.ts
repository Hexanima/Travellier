import type { NavigateFunction } from "react-router-dom";
import { buildOrigin, type OriginLabel, type RestorePanel } from "./post-origin.js";

export type PostOpening = { tripId: string; postId: string; anchor: string; label: OriginLabel; viewer?: boolean; panel?: RestorePanel };
type HereLocation = { pathname: string; search: string; state: unknown };

/**
 * Opens the detail of a post. Before leaving, the current history entry stores the anchor and scroll of the item (merged into its
 * previous state, so an open viewer or `noBack` survive); the detail receives the origin to offer a valid way back.
 */
export const openPostFrom = (navigate: NavigateFunction, location: HereLocation, { tripId, postId, anchor, label, viewer, panel }: PostOpening) => {
  const scrollY = Math.max(0, Math.round(window.scrollY || 0));
  const previous = typeof location.state === "object" && location.state !== null && !Array.isArray(location.state) ? location.state : {};
  navigate(`${location.pathname}${location.search}`, { replace: true, state: { ...previous, restore: { anchor, scrollY, ...(panel ? { panel } : {}) } } });
  navigate(`/trips/${tripId}/memories/${postId}`, { state: { origin: buildOrigin(location, label, anchor, scrollY, viewer) } });
};
