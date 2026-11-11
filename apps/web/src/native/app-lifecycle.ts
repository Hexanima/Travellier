import { App } from "@capacitor/app";

/** Port of the app lifecycle: the host tells when the app returns to the foreground (the WebView may not fire `visibilitychange`/`focus`). */
export type AppLifecycle = { onResume(listener: () => void): () => void };
type Handle = { remove: () => Promise<void> };
export type NativeAppStateApi = {
  addListener: (eventName: "appStateChange", listener: (state: { isActive: boolean }) => void) => Promise<Handle>;
};

/** Adapter over `appStateChange`: only `isActive: true` is a resume. The returned stop is safe even if the native registration is still pending. */
export function createAppLifecycle(native: NativeAppStateApi): AppLifecycle {
  return {
    onResume: (listener) => {
      let stopped = false;
      let handle: Handle | undefined;
      native.addListener("appStateChange", ({ isActive }) => { if (isActive && !stopped) listener(); })
        .then((registered) => { if (stopped) void registered.remove(); else handle = registered; })
        .catch(() => undefined);
      return () => { stopped = true; if (handle) { void handle.remove(); handle = undefined; } };
    },
  };
}

export const capacitorAppLifecycle: AppLifecycle = createAppLifecycle({ addListener: (eventName, listener) => App.addListener(eventName, listener) });
