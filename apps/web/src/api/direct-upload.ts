/** `expired`: S3 answered 403 (the presigned PUT is no longer valid); `rejected`: any other non-2xx; `timeout`: the per-file wait ran out, apart from `network` so the person reads the cause. */
export type UploadFailureCode = "network" | "timeout" | "aborted" | "expired" | "rejected";
export type UploadOutcome = { ok: true } | { ok: false; code: UploadFailureCode };
export type PutOptions = { onProgress?: (fraction: number) => void; signal?: AbortSignal };
/**
 * Sends a binary straight to a presigned URL. It deliberately does not use the API `HttpClient`: that one prepends the API base url,
 * adds `Authorization`, parses JSON and has no progress. The API token must never reach S3.
 */
export type DirectUpload = { put: (url: string, headers: Readonly<Record<string, string>>, blob: Blob, options: PutOptions) => Promise<UploadOutcome> };
export type DirectUploadDependencies = { createXhr: () => XMLHttpRequest; timeoutMs?: number };
/** The browser sets these itself or they would leak credentials: they are never copied from the presign. */
const forbidden = new Set(["content-length", "host", "authorization", "cookie"]);

export const createDirectUpload = ({ createXhr, timeoutMs = 120_000 }: DirectUploadDependencies): DirectUpload => ({
  put: (url, headers, blob, { onProgress, signal }) => new Promise<UploadOutcome>((resolve) => {
    if (signal?.aborted) { resolve({ ok: false, code: "aborted" }); return; }
    let xhr: XMLHttpRequest;
    try {
      xhr = createXhr();
      xhr.open("PUT", url);
      xhr.withCredentials = false;
      xhr.timeout = timeoutMs;
      for (const [name, value] of Object.entries(headers)) if (!forbidden.has(name.toLowerCase())) xhr.setRequestHeader(name, value);
    } catch { resolve({ ok: false, code: "network" }); return; }
    const onAbort = () => xhr.abort();
    const finish = (outcome: UploadOutcome) => { signal?.removeEventListener("abort", onAbort); resolve(outcome); };
    signal?.addEventListener("abort", onAbort, { once: true });
    xhr.upload.onprogress = (event) => { if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total); };
    xhr.onload = () => finish(xhr.status >= 200 && xhr.status < 300 ? { ok: true }
      : xhr.status === 0 ? { ok: false, code: "network" } : xhr.status === 403 ? { ok: false, code: "expired" } : { ok: false, code: "rejected" });
    xhr.onerror = () => finish({ ok: false, code: "network" });
    xhr.ontimeout = () => finish({ ok: false, code: "timeout" });
    xhr.onabort = () => finish({ ok: false, code: "aborted" });
    try { xhr.send(blob); } catch { finish({ ok: false, code: "network" }); }
  }),
});
