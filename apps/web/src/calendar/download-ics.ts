/** Download of a generated `.ics` as a Blob through a temporary `<a download>`. Web only: sharing or saving on the device is not covered. */
export type DownloadDeps = {
  Blob: typeof Blob;
  url?: Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;
  document: Pick<Document, "createElement"> & { body: Pick<HTMLElement, "append"> };
  /** Runs `task` later; the object URL must outlive the click. */
  defer: (task: () => void) => void;
};
export type DownloadResult = { ok: true } | { ok: false };

/** Reads globals through `globalThis` so a missing `Blob` or `URL` is `undefined` (handled below) instead of a ReferenceError. */
const defaultDeps = (): DownloadDeps => ({
  Blob: globalThis.Blob, url: globalThis.URL, document: globalThis.document, defer: (task) => { setTimeout(task, 1000); },
});

/** Never trusts the name: only letters, digits, `_` and `-` survive, plus the fixed `.ics` extension. */
function safeFileName(name: string): string {
  const base = name.replace(/\.ics$/i, "").replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 100).replace(/-+$/, "");
  return `${base || "travellier-viaje"}.ics`;
}

/** Returns `{ ok: false }` instead of throwing when the platform cannot create or open the file. */
export function downloadIcs(text: string, fileName: string, deps?: DownloadDeps): DownloadResult {
  let objectUrl: string;
  try {
    deps ??= defaultDeps();
    if (!deps.url || !deps.Blob || typeof deps.url.createObjectURL !== "function") return { ok: false };
    objectUrl = deps.url.createObjectURL(new deps.Blob([text], { type: "text/calendar;charset=utf-8" }));
  } catch { return { ok: false }; }
  const release = () => deps.defer(() => { try { deps.url?.revokeObjectURL(objectUrl); } catch { /* nothing left to release */ } });
  let anchor: HTMLAnchorElement | undefined;
  try {
    anchor = deps.document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = safeFileName(fileName);
    anchor.rel = "noopener";
    anchor.style.display = "none";
    deps.document.body.append(anchor);
    anchor.click();
    anchor.remove();
    release();
    return { ok: true };
  } catch {
    try { anchor?.remove(); } catch { /* detached already */ }
    // The click never happened: free the URL right away instead of waiting.
    try { deps.url.revokeObjectURL(objectUrl); } catch { /* nothing left to release */ }
    return { ok: false };
  }
}
