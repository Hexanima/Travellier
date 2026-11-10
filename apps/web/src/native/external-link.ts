import { NativeCapabilityError, err, ok, type ExternalLinkPort } from "app-domain";
import { parseMapsLink } from "../trips/maps-link.js";

/** `window.open`-shaped opener. @capacitor/app 8 has no openUrl and @capacitor/browser is not installed, so the webview handles the external navigation. */
export interface ExternalLinkDependencies {
  open(url: string, target: string, features: string): unknown;
}
/**
 * Construction has no effects. The url is revalidated here (defense in depth) and the normalized href is opened; it is never logged.
 * With `noopener` a browser returns null even on success, so a null window is not a failure; only a throwing opener is.
 */
export function createExternalLink(dependencies: ExternalLinkDependencies): ExternalLinkPort {
  return {
    open: async (url) => {
      const link = parseMapsLink(url);
      if (link.kind !== "valid") return err(new NativeCapabilityError("unsupported"));
      try {
        dependencies.open(link.url, "_blank", "noopener,noreferrer");
        return ok(undefined);
      } catch {
        return err(new NativeCapabilityError("native"));
      }
    },
  };
}
