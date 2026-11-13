import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { capacitorAppBackButton, type AppBackButton } from "../native/app-back-button.js";
import { canGoBack, readOrigin } from "../trips/post-origin.js";
import { createBackLayerStack, type BackLayerStack } from "./back-layers.js";
import { resolveBackAction } from "./back-navigation.js";

const BackLayerContext = createContext<BackLayerStack | undefined>(undefined);
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
  // A second press while the navigation is still pending would pop twice: it is ignored until the entry changes.
  const navigating = useRef(false);
  useEffect(() => { navigating.current = false; }, [location]);

  useEffect(() => {
    if (!backButton) return;
    return backButton.onBack(() => {
      if (stack.handle()) return;
      if (navigating.current) return;
      const current = locationRef.current;
      const tripId = tripOfPath(current.pathname);
      const action = resolveBackAction({
        pathname: current.pathname,
        tripId,
        canGoBack: canGoBack(current),
        fromNotices: readOrigin(current.state, tripId ?? "").label === "avisos",
      });
      if (action.kind === "exit") { backButton.exitApp(); return; }
      navigating.current = true;
      if (action.kind === "back") navigateRef.current(-1);
      else navigateRef.current(action.to, { replace: true });
    });
  }, [backButton, stack]);

  return <BackLayerContext.Provider value={stack}>{children}</BackLayerContext.Provider>;
}

/**
 * Registers a layer of the back press while `active`. The last layer activated answers first; returning `false`
 * delegates to the one below. Without the provider (web) it does nothing.
 */
export function useBackLayer(active: boolean, handler: () => boolean | void) {
  const stack = useContext(BackLayerContext);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    if (!stack || !active) return;
    return stack.register(() => handlerRef.current() !== false);
  }, [stack, active]);
}
