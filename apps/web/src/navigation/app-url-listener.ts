import { resolveDeepLinkUrl } from "./deep-link.js";

type AppUrlOpenEvent = { url: string };

type AppUrlListenerHandle = {
  remove: () => Promise<void>;
};

export type NativeAppUrlApi = {
  addListener: (
    eventName: "appUrlOpen",
    listener: (event: AppUrlOpenEvent) => void,
  ) => Promise<AppUrlListenerHandle>;
  getLaunchUrl: () => Promise<{ url: string } | undefined>;
};

export async function initializeAppUrlListener(
  nativeApp: NativeAppUrlApi,
  navigate: (path: string) => void,
): Promise<() => Promise<void>> {
  const navigateToUrl = (url: string) => {
    const path = resolveDeepLinkUrl(url);

    if (path) {
      navigate(path);
    }
  };
  const listenerHandle = await nativeApp.addListener("appUrlOpen", (event) => {
    navigateToUrl(event.url);
  });
  const launchUrl = await nativeApp.getLaunchUrl();

  if (launchUrl) {
    navigateToUrl(launchUrl.url);
  }

  return () => listenerHandle.remove();
}
