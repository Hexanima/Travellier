import type { MouseEvent, ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { buildOrigin, type OriginLabel } from "./post-origin.js";

export type PostLinkProps = { tripId: string; postId: string; anchor: string; label: Extract<OriginLabel, "diario" | "itinerario">; className?: string; children: ReactNode };

/**
 * Link to the detail of a post. Before leaving, the current history entry stores the anchor and scroll of the item, so going back
 * restores the place; the detail receives the origin to offer a valid way back. Modified clicks keep the browser behaviour.
 */
export function PostLink({ tripId, postId, anchor, label, className, children }: PostLinkProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const to = `/trips/${tripId}/memories/${postId}`;
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const scrollY = Math.max(0, Math.round(window.scrollY || 0));
    navigate(`${location.pathname}${location.search}`, { replace: true, state: { restore: { anchor, scrollY } } });
    navigate(to, { state: { origin: buildOrigin(location, label, anchor, scrollY) } });
  };
  return <Link className={className} to={to} onClick={open}>{children}</Link>;
}
