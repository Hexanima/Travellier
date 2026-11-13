import { useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { capacitorAppBackButton, type AppBackButton } from "../native/app-back-button.js";
import { canGoBack, inheritNoBack, readOrigin } from "../trips/post-origin.js";
import { createBackLayerStack } from "./back-layers.js";
import { BackDepthContext, BackLayerContext } from "./back-layer-context.js";
import { resolveBackAction } from "./back-navigation.js";

/** How long a back press keeps the lock: enough for the asynchronous `popstate` and for the bounce of the button or the gesture. */
const backLockMs = 250;

const tripOfPath = (pathname: string) => /^\/trips\/([^/]+)\//.exec(pathname)?.[1];

type Props = {
  children: ReactNode;
  /** Back press port; by default the Capacitor one on a native platform and nothing on the web (there the browser back already works). */
  backButton?: AppBackButton;
};

/**
 * Handles the native back press: first the open layers (dialogs, sheets, dirty forms) from the most recently opened one,
 * and if none takes it, the resolved navigation. Registering the port replaces the Capacitor default, so every press ends in an action.
 */
export function BackNavigationProvider({ children, backButton = Capacitor.isNativePlatform() ? capacitorAppBackButton : undefined }: Props) {
  const stack = useMemo(() => createBackLayerStack(), []);
  const navigate = useNavigate();
  const location = useLocation();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const locationRef = useRef(location);
  locationRef.current = location;
  // A second press while the navigation is still pending would pop twice: `popstate` arrives asynchronously, so the lock
  // is held for a short window (the physical button and the gesture bounce within tens of milliseconds) and released after it,
  // whether or not the entry changed (a `back` with nothing behind in the WebView never changes it).
  const navigating = useRef(false);
  const release = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(release.current), []);

  useEffect(() => {
    if (!backButton) return;
    return backButton.onBack(() => {
      if (navigating.current) return;
      // The lock covers the whole press, closing a layer included: with two nested dialogs, two presses within the window
      // close only the innermost one, which is what a single press must do.
      const lock = () => {
        navigating.current = true;
        clearTimeout(release.current);
        release.current = setTimeout(() => { navigating.current = false; }, backLockMs);
      };
      if (stack.handle()) { lock(); return; }
      const current = locationRef.current;
      const tripId = tripOfPath(current.pathname);
      const action = resolveBackAction({
        pathname: current.pathname,
        tripId,
        canGoBack: canGoBack(current),
        fromNotices: readOrigin(current.state, tripId ?? "").label === "avisos",
      });
      if (action.kind === "exit") { backButton.exitApp(); return; }
      lock();
      if (action.kind === "back") navigateRef.current(-1);
      // The entry it replaces is left behind: it inherits `noBack` only when nothing was behind it, so the next press
      // neither resolves to a back that goes nowhere nor closes the app with history still behind.
      else navigateRef.current(action.to, { replace: true, ...inheritNoBack(current) });
    });
  }, [backButton, stack]);

  return <BackLayerContext.Provider value={stack}>{children}</BackLayerContext.Provider>;
}

/** Content of a dialog: its own layers (a dirty form, a nested confirmation) answer the back press before the dialog closes. */
export function BackLayerDepth({ children }: { children: ReactNode }) {
  const depth = useContext(BackDepthContext);
  const next = useMemo(() => depth + 1, [depth]);
  return <BackDepthContext.Provider value={next}>{children}</BackDepthContext.Provider>;
}
