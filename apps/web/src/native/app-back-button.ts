import { App } from "@capacitor/app";

/** Port of the hardware/gesture back button: the host tells when it is pressed and can close the app (there is no browser history to fall back on). */
export type AppBackButton = { onBack(listener: () => void): () => void; exitApp(): void };
type Handle = { remove: () => Promise<void> };
export type NativeBackButtonApi = {
  addListener: (eventName: "backButton", listener: () => void) => Promise<Handle>;
  exitApp: () => Promise<void>;
};

/**
 * Adapter over `backButton`. Registering it replaces the Capacitor default, so every press must end in an action.
 * The returned stop is safe even if the native registration is still pending, and a failed registration is inert.
 */
export function createAppBackButton(native: NativeBackButtonApi): AppBackButton {
  return {
    onBack: (listener) => {
      let stopped = false;
      let handle: Handle | undefined;
      native.addListener("backButton", () => { if (!stopped) listener(); })
        .then((registered) => { if (stopped) void registered.remove(); else handle = registered; })
        .catch(() => undefined);
      return () => { stopped = true; if (handle) { void handle.remove(); handle = undefined; } };
    },
    exitApp: () => { try { void native.exitApp().catch(() => undefined); } catch { /* the plugin is unavailable: nothing to close */ } },
  };
}

export const capacitorAppBackButton: AppBackButton = createAppBackButton({
  addListener: (eventName, listener) => App.addListener(eventName, listener),
  exitApp: () => App.exitApp(),
});
