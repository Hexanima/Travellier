import { NativeCapabilityError, err, ok, type ExternalLinkPort } from "app-domain";
import type { AppLauncherPlugin } from "@capacitor/app-launcher";
import { parseMapsLink } from "../trips/maps-link.js";
import type { NativePlatform } from "./capabilities.js";

/** On android/ios `@capacitor/app-launcher` hands the link to the OS, which picks the maps app; elsewhere the `window.open`-shaped opener lets the webview navigate. */
export interface ExternalLinkDependencies {
  launcher: Pick<AppLauncherPlugin, "openUrl">;
  open(url: string, target: string, features: string): unknown;
}
/**
 * Construction has no effects. The url is revalidated here (defense in depth) and only the normalized href reaches the launcher or the opener; it is never logged.
 * Native: `completed: false` means the OS refused to open the link (no handler) and is reported as a native failure; `true` only means it accepted it, not that a maps app rendered the place.
 * Web/dev: with `noopener` a browser returns null even on success, so a null window is not a failure; only a throwing opener is.
 */
export function createExternalLink(dependencies: ExternalLinkDependencies, platform: NativePlatform): ExternalLinkPort {
  return {
    open: async (url) => {
      const link = parseMapsLink(url);
      if (link.kind !== "valid") return err(new NativeCapabilityError("unsupported"));
      const name = platform();
      try {
        if (name === "android" || name === "ios") {
          const { completed } = await dependencies.launcher.openUrl({ url: link.url });
          return completed ? ok(undefined) : err(new NativeCapabilityError("native"));
        }
        dependencies.open(link.url, "_blank", "noopener,noreferrer");
        return ok(undefined);
      } catch {
        return err(new NativeCapabilityError("native"));
      }
    },
  };
}
