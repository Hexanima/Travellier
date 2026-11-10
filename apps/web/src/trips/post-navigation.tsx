import type { MouseEvent, ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { openPostFrom } from "./open-post.js";
import type { OriginLabel } from "./post-origin.js";

export type PostLinkProps = { tripId: string; postId: string; anchor: string; label: Extract<OriginLabel, "diario" | "itinerario" | "fotos">; className?: string; children: ReactNode };

/** Link to the detail of a post. Modified clicks keep the browser behaviour. */
export function PostLink({ tripId, postId, anchor, label, className, children }: PostLinkProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    openPostFrom(navigate, location, { tripId, postId, anchor, label });
  };
  return <Link className={className} to={`/trips/${tripId}/memories/${postId}`} onClick={open}>{children}</Link>;
}
