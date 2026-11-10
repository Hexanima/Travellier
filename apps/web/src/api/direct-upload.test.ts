import { describe, expect, it, vi } from "vitest";
import { createDirectUpload } from "./direct-upload.js";

class FakeXhr {
  static last: FakeXhr;
  method = ""; url = ""; headers: [string, string][] = []; body: unknown; withCredentials = true; timeout = 0; status = 0; aborted = false;
  upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null; onerror: (() => void) | null = null; ontimeout: (() => void) | null = null; onabort: (() => void) | null = null;
  constructor() { FakeXhr.last = this; }
  open(method: string, url: string) { this.method = method; this.url = url; }
  setRequestHeader(name: string, value: string) { this.headers.push([name, value]); }
  send(body: unknown) { this.body = body; }
  abort() { this.aborted = true; this.onabort?.(); }
}
const blob = new Blob([new Uint8Array(10)], { type: "image/jpeg" });
const setup = (options: { timeoutMs?: number } = {}) => ({ upload: createDirectUpload({ createXhr: () => new FakeXhr() as unknown as XMLHttpRequest, ...options }) });
const url = "https://bucket.s3.test/k?sig=1";

describe("direct upload", () => {
  it("PUTs the same blob to the signed url with only the signed headers, without credentials", async () => {
    const { upload } = setup();
    const result = upload.put(url, { "content-type": "image/jpeg", "x-amz-meta-a": "b" }, blob, {});
    const xhr = FakeXhr.last;
    xhr.status = 200; xhr.onload?.();
    expect(await result).toEqual({ ok: true });
    expect(xhr.method).toBe("PUT"); expect(xhr.url).toBe(url); expect(xhr.body).toBe(blob);
    expect(xhr.withCredentials).toBe(false);
    expect(xhr.headers).toEqual([["content-type", "image/jpeg"], ["x-amz-meta-a", "b"]]);
  });
  it("never sends Authorization, Cookie, Host or Content-Length even if the presign lists them", async () => {
    const { upload } = setup();
    const result = upload.put(url, { Authorization: "Bearer x", COOKIE: "a=b", Host: "h", "Content-Length": "10", "content-type": "image/png" }, blob, {});
    FakeXhr.last.status = 204; FakeXhr.last.onload?.(); await result;
    expect(FakeXhr.last.headers).toEqual([["content-type", "image/png"]]);
  });
  it("reports the progress as a fraction", async () => {
    const onProgress = vi.fn();
    const { upload } = setup();
    const result = upload.put(url, {}, blob, { onProgress });
    FakeXhr.last.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 });
    FakeXhr.last.upload.onprogress?.({ lengthComputable: false, loaded: 7, total: 0 });
    FakeXhr.last.status = 200; FakeXhr.last.onload?.(); await result;
    expect(onProgress).toHaveBeenCalledExactlyOnceWith(0.5);
  });
  it("maps statuses and events to codes", async () => {
    const run = async (finish: (xhr: FakeXhr) => void) => { const result = setup().upload.put(url, {}, blob, {}); finish(FakeXhr.last); return result; };
    expect(await run((xhr) => { xhr.status = 403; xhr.onload?.(); })).toEqual({ ok: false, code: "expired" });
    expect(await run((xhr) => { xhr.status = 400; xhr.onload?.(); })).toEqual({ ok: false, code: "rejected" });
    expect(await run((xhr) => { xhr.status = 500; xhr.onload?.(); })).toEqual({ ok: false, code: "rejected" });
    expect(await run((xhr) => { xhr.status = 0; xhr.onload?.(); })).toEqual({ ok: false, code: "network" });
    expect(await run((xhr) => xhr.onerror?.())).toEqual({ ok: false, code: "network" });
    expect(await run((xhr) => xhr.ontimeout?.())).toEqual({ ok: false, code: "network" });
  });
  it("applies the per-file timeout, default and custom", async () => {
    const first = setup().upload.put(url, {}, blob, {}); expect(FakeXhr.last.timeout).toBe(120_000); FakeXhr.last.onerror?.(); await first;
    const second = setup({ timeoutMs: 5000 }).upload.put(url, {}, blob, {}); expect(FakeXhr.last.timeout).toBe(5000); FakeXhr.last.onerror?.(); await second;
  });
  it("aborts the request when the signal fires and does not start when already aborted", async () => {
    const controller = new AbortController();
    const result = setup().upload.put(url, {}, blob, { signal: controller.signal });
    const xhr = FakeXhr.last;
    controller.abort();
    expect(xhr.aborted).toBe(true);
    expect(await result).toEqual({ ok: false, code: "aborted" });
    const before = FakeXhr.last;
    const late = await setup().upload.put(url, {}, blob, { signal: controller.signal });
    expect(late).toEqual({ ok: false, code: "aborted" });
    expect(FakeXhr.last).toBe(before);
  });
  it("maps a thrown xhr failure to network", async () => {
    const upload = createDirectUpload({ createXhr: () => { throw new Error("no xhr"); } });
    expect(await upload.put(url, {}, blob, {})).toEqual({ ok: false, code: "network" });
  });
});
