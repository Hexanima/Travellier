import { App } from "@capacitor/app";
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { canGoBack, inheritNoBack } from "../trips/post-origin.js";
import {
  initializeAppUrlListener,
  type NativeAppUrlApi,
} from "./app-url-listener.js";

const capacitorAppUrlApi: NativeAppUrlApi = {
  addListener: (eventName, listener) => App.addListener(eventName, listener),
  getLaunchUrl: () => App.getLaunchUrl(),
};

type AppUrlListenerProps = {
  nativeApp?: NativeAppUrlApi;
  onNavigate?: (path: string) => void;
  onReady?: () => void;
};

export function AppUrlListener({
  nativeApp = capacitorAppUrlApi,
  onNavigate,
  onReady,
}: AppUrlListenerProps) {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const location = useLocation();
  const locationRef = useRef(location);
  locationRef.current = location;
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    let disposed = false;
    let stopListening: (() => Promise<void>) | undefined;

    void initializeAppUrlListener(nativeApp, (path) => {
      if (!disposed) {
        onNavigateRef.current?.(path);
        const current = locationRef.current;
        // En nativo el WebView siempre arranca en `/` (la pantalla pública): apilar dejaría esa entrada detrás y el Atrás
        // caería ahí. Con la app ya navegada (hay historial propio y no estamos en `/`) el push conserva ese historial legítimo.
        const replaceEntry = !canGoBack(current) || current.pathname === "/";
        navigateRef.current(path, replaceEntry ? { replace: true, ...inheritNoBack(current) } : {});
      }
    }).then((stop) => {
      if (disposed) {
        void stop();
        return;
      }

      stopListening = stop;
      onReadyRef.current?.();
    });

    return () => {
      disposed = true;
      if (stopListening) {
        void stopListening();
      }
    };
  }, [nativeApp]);

  return null;
}
