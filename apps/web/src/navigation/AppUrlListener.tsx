import { App } from "@capacitor/app";
import { useEffect } from "react";
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
};

export function AppUrlListener({
  nativeApp = capacitorAppUrlApi,
}: AppUrlListenerProps) {
  const navigate = useNavigate();

  useEffect(() => {
    let disposed = false;
    let stopListening: (() => Promise<void>) | undefined;

    void initializeAppUrlListener(nativeApp, navigate).then((stop) => {
      if (disposed) {
        void stop();
        return;
      }

      stopListening = stop;
    });

    return () => {
      disposed = true;
      if (stopListening) {
        void stopListening();
      }
    };
  }, [nativeApp, navigate]);

  return null;
}
