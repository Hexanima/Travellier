import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { anchorSelector, readPhoto, readRestore } from "./post-origin.js";

/**
 * Reads `state.restore` once and, when the screen is ready (its items exist), scrolls to the anchor and focuses it; without the
 * anchor it falls back to the saved scroll, silently. The state is then cleaned so it is not applied again.
 */
export function useRestorePosition(ready: boolean) {
  const location = useLocation();
  const navigate = useNavigate();
  const [restore] = useState(() => readRestore(location.state));
  const done = useRef(false);
  useEffect(() => {
    if (!ready || !restore || done.current) return;
    done.current = true;
    const selector = anchorSelector(restore.anchor);
    const target = selector ? document.querySelector<HTMLElement>(selector) : null;
    // With the photo viewer open the focus belongs to the dialog: the grid only scrolls.
    const viewerOpen = readPhoto(location.state) !== undefined;
    if (target) { target.scrollIntoView({ block: "center" }); if (!viewerOpen) target.focus({ preventScroll: true }); } else window.scrollTo(0, restore.scrollY);
    // Only `restore` is dropped; anything else in the entry (the open photo) stays, since clearing it would close the viewer.
    const kept = { ...(location.state as Record<string, unknown> | null) };
    delete kept.restore;
    navigate(`${location.pathname}${location.search}`, { replace: true, state: Object.keys(kept).length > 0 ? kept : null });
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
}
