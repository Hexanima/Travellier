import { App } from "@capacitor/app";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

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
        navigateRef.current(path);
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
