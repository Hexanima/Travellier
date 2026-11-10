import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { decideBack, initializeBackButton, type NativeBackButtonApi } from "./back-button.js";

const capacitorBackButtonApi: NativeBackButtonApi = {
  addListener: (eventName, listener) => App.addListener(eventName, listener),
  exitApp: () => App.exitApp(),
};

/** Without a port the handler is only active on a native platform; on the web it does nothing. */
export function BackButtonHandler({ nativeBack = Capacitor.isNativePlatform() ? capacitorBackButtonApi : undefined }: { nativeBack?: NativeBackButtonApi }) {
  const navigate = useNavigate();
  const location = useLocation();
  const latest = useRef({ navigate, location });
  latest.current = { navigate, location };

  useEffect(() => {
    if (!nativeBack) return;
    let disposed = false;
    let stop: (() => Promise<void>) | undefined;
    void initializeBackButton(nativeBack, (event) => {
      if (disposed) return;
      const { navigate: go, location: current } = latest.current;
      const action = decideBack(current, event.canGoBack);
      if (action.kind === "history") go(-1);
      else if (action.kind === "navigate") go(action.to, { replace: true, ...(action.state !== undefined ? { state: action.state } : {}) });
      else void nativeBack.exitApp().catch(() => undefined);
    }).then((remove) => {
      if (disposed) void remove(); else stop = remove;
    }).catch(() => undefined);
    return () => { disposed = true; if (stop) void stop(); };
  }, [nativeBack]);

  return null;
}
