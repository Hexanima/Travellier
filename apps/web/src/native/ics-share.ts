import { Directory, Encoding, type FilesystemPlugin } from "@capacitor/filesystem";
import type { SharePlugin } from "@capacitor/share";
import { safeFileName, type DownloadResult } from "../calendar/download-ics.js";
import type { NativePlatform } from "./capabilities.js";

/**
 * `shared`: the share sheet was launched (Android resolves on launch, iOS on close): it does not prove the user chose a destination or that an app imported the file.
 * `downloaded`: web/dev fallback through Blob. The reason never carries paths or uris.
 */
export type IcsShareOutcome = { ok: true; via: "shared" | "downloaded" } | { ok: false; reason: "cancelled" | "failed" };
export type IcsFileSharer = { save(text: string, fileName: string): Promise<IcsShareOutcome> };
export type IcsSharerDeps = {
  filesystem: Pick<FilesystemPlugin, "writeFile" | "deleteFile">;
  share: Pick<SharePlugin, "canShare" | "share">;
  platform: NativePlatform;
  fallback: (text: string, fileName: string) => DownloadResult | Promise<DownloadResult>;
};

/** An itinerary `.ics` is a few KB; this only stops absurd inputs before writing. */
export const MAX_ICS_BYTES = 1_000_000;
const failed = { ok: false, reason: "failed" } as const;

/**
 * Writes the `.ics` to the app cache and opens the share sheet (the user picks «Guardar en archivos» or an app there).
 * The temporary file is NOT deleted after sharing: the target app may read it after `share` resolves, and the OS purges the cache.
 * The next export overwrites the same name; a file with a different name from a previous export is removed best-effort, never altering the result.
 */
export function createNativeIcsSharer({ filesystem, share, platform, fallback }: IcsSharerDeps): IcsFileSharer {
  let previousName: string | undefined;
  return {
    async save(text, fileName) {
      const name = platform();
      if (name !== "android" && name !== "ios") {
        try { return (await fallback(text, fileName)).ok ? { ok: true, via: "downloaded" } : failed; } catch { return failed; }
      }
      if (new TextEncoder().encode(text).length > MAX_ICS_BYTES) return failed;
      const path = safeFileName(fileName);
      let uri: string;
      try {
        uri = (await filesystem.writeFile({ path, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 })).uri;
      } catch { return failed; }
      const stale = previousName !== undefined && previousName !== path ? previousName : undefined;
      previousName = path;
      if (stale) { try { await filesystem.deleteFile({ path: stale, directory: Directory.Cache }); } catch { /* best effort */ } }
      try {
        if (!(await share.canShare()).value) return failed;
        await share.share({ title: path, files: [uri] });
        return { ok: true, via: "shared" };
      } catch (error) {
        const message = typeof error === "object" && error !== null && "message" in error ? String(error.message) : "";
        return /cancel/i.test(message) ? { ok: false, reason: "cancelled" } : failed;
      }
    },
  };
}
