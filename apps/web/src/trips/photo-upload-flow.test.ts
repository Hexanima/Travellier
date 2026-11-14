import { describe, expect, it, vi } from "vitest";
import type { UploadOutcome } from "../api/direct-upload.js";
import type { PhotoDraftItem } from "./post-draft.js";
import { MAX_RESERVED_AGE_MS, RESERVE_MARGIN_MS, uploadPending } from "./photo-upload-flow.js";
import type { PhotoFileDescriptor, UploadTarget } from "./trip-photo-api.js";
import type { TripResult } from "./trip-management-api.js";

const tripId = "0000000000000000000000a1";
const NOW = Date.UTC(2026, 10, 10, 12, 0, 0);
const HOUR = 3_600_000;
const item = (n: number, extra: Partial<PhotoDraftItem> = {}): PhotoDraftItem =>
  ({ localId: `p${n}`, reference: `ref${n}`, contentType: "image/jpeg", sizeBytes: 100 + n, status: "selected", ...extra });
const done = (n: number, uploadedAt = NOW): PhotoDraftItem => item(n, { status: "uploaded", key: `trips/${tripId}/photos/old-${n}`, uploadedAt });
const blobs = (ids: string[]) => { const map = new Map(ids.map((id) => [id, new Blob([id], { type: "image/jpeg" })])); return { get: (id: string) => map.get(id), map }; };
let counter = 0;
const target = (expiresIn = 900_000): UploadTarget => { counter += 1; return { key: `trips/${tripId}/photos/new-${counter}`, uploadUrl: `https://s3.test/${counter}`, headers: { "content-type": "image/jpeg" }, expiresAt: NOW + expiresIn }; };
const fakeApi = (expiresIn?: number) => ({ reserve: vi.fn(async (_trip: string, files: readonly PhotoFileDescriptor[]): Promise<TripResult<UploadTarget[]>> =>
  ({ ok: true, value: files.map(() => target(expiresIn)) })) });
const okTransfer = () => ({ put: vi.fn(async (): Promise<UploadOutcome> => ({ ok: true })) });
const run = (items: PhotoDraftItem[], extra: Partial<Parameters<typeof uploadPending>[0]> = {}) => {
  const store = blobs(items.map((entry) => entry.localId));
  return uploadPending({ tripId, items, blobs: store, api: fakeApi(), transfer: okTransfer(), now: () => NOW, ...extra });
};

describe("uploadPending", () => {
  it("reserves every photo without a valid key in one single batch, in order, and keeps the fresh ones", async () => {
    const api = fakeApi(), transfer = okTransfer();
    const report = await run([item(1), done(2), item(3)], { api, transfer });
    expect(api.reserve).toHaveBeenCalledExactlyOnceWith(tripId, [{ contentType: "image/jpeg", sizeBytes: 101 }, { contentType: "image/jpeg", sizeBytes: 103 }]);
    expect(transfer.put).toHaveBeenCalledTimes(2);
    expect(report.items.map((entry) => entry.status)).toEqual(["uploaded", "uploaded", "uploaded"]);
    expect(report.items[1]!.key).toBe(`trips/${tripId}/photos/old-2`);
    expect(report.items[0]!.key).toMatch(/new-/);
    expect(report.items[0]).toMatchObject({ uploadedAt: NOW });
    expect(report.aborted).toBe(false);
    expect(report.reserveError).toBeUndefined();
  });
  it("sends the stored blob with the reserved url and headers", async () => {
    const transfer = okTransfer(), store = blobs(["p1"]);
    await uploadPending({ tripId, items: [item(1)], blobs: store, api: fakeApi(), transfer, now: () => NOW });
    const [url, headers, blob] = transfer.put.mock.calls[0] as unknown as [string, Record<string, string>, Blob];
    expect(url).toMatch(/^https:\/\/s3\.test\//);
    expect(headers).toEqual({ "content-type": "image/jpeg" });
    expect(blob).toBe(store.map.get("p1"));
  });
  it("does nothing when every photo is already uploaded and fresh", async () => {
    const api = fakeApi(), transfer = okTransfer();
    const report = await run([done(1), done(2)], { api, transfer });
    expect(api.reserve).not.toHaveBeenCalled();
    expect(transfer.put).not.toHaveBeenCalled();
    expect(report.items.every((entry) => entry.status === "uploaded")).toBe(true);
  });
  it("uploads with a concurrency of at most 2", async () => {
    let active = 0, peak = 0;
    const releases: (() => void)[] = [];
    const transfer = { put: vi.fn(() => { active += 1; peak = Math.max(peak, active); return new Promise<UploadOutcome>((resolve) => { releases.push(() => { active -= 1; resolve({ ok: true }); }); }); }) };
    const pending = run([item(1), item(2), item(3), item(4), item(5)], { transfer });
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    expect(transfer.put).toHaveBeenCalledTimes(2);
    for (let guard = 0; guard < 20; guard += 1) { releases.splice(0).forEach((release) => release()); for (let i = 0; i < 20; i += 1) await Promise.resolve(); }
    const report = await pending;
    expect(peak).toBe(2);
    expect(report.items.every((entry) => entry.status === "uploaded")).toBe(true);
  });
  it("a failed photo does not cancel the others and carries its code", async () => {
    const transfer = { put: vi.fn(async (url: string): Promise<UploadOutcome> => url.endsWith("/2") || url.endsWith("/5") ? { ok: false, code: "network" } : { ok: true }) };
    counter = 0;
    const report = await run([item(1), item(2), item(3)], { transfer });
    expect(report.items.map((entry) => entry.status)).toEqual(["uploaded", "failed", "uploaded"]);
    expect(report.items[1]).toMatchObject({ failure: "network" });
    expect(report.items[1]!.key).toBeUndefined();
  });
  it("maps a 403 on the PUT to expired", async () => {
    const transfer = { put: vi.fn(async (): Promise<UploadOutcome> => ({ ok: false, code: "expired" })) };
    expect((await run([item(1)], { transfer })).items[0]).toMatchObject({ status: "failed", failure: "expired" });
  });
  it("retrying only re-uploads the failed photo and always reserves a new key for it", async () => {
    const api = fakeApi(), transfer = okTransfer();
    const failed = item(2, { status: "failed", failure: "network", key: undefined });
    const report = await run([done(1), failed], { api, transfer });
    expect(api.reserve).toHaveBeenCalledExactlyOnceWith(tripId, [{ contentType: "image/jpeg", sizeBytes: 102 }]);
    expect(transfer.put).toHaveBeenCalledTimes(1);
    expect(report.items[0]!.key).toBe(`trips/${tripId}/photos/old-1`);
    expect(report.items[1]).toMatchObject({ status: "uploaded", uploadedAt: NOW });
    expect(report.items[1]!.failure).toBeUndefined();
  });
  it("re-reserves a photo whose reserved url is about to expire, right before the PUT", async () => {
    const calls: string[] = [];
    let n = 0;
    const api = { reserve: vi.fn(async (_t: string, files: readonly PhotoFileDescriptor[]): Promise<TripResult<UploadTarget[]>> => {
      n += 1; calls.push(`reserve:${files.length}`);
      return { ok: true, value: files.map(() => ({ key: `trips/${tripId}/photos/r${n}`, uploadUrl: `https://s3.test/r${n}`, headers: {}, expiresAt: n === 1 ? NOW + RESERVE_MARGIN_MS - 1 : NOW + 900_000 })) };
    }) };
    const transfer = { put: vi.fn(async (url: string): Promise<UploadOutcome> => { calls.push(`put:${url}`); return { ok: true }; }) };
    const report = await run([item(1)], { api, transfer });
    expect(calls).toEqual(["reserve:1", "reserve:1", "put:https://s3.test/r2"]);
    expect(report.items[0]!.key).toBe(`trips/${tripId}/photos/r2`);
  });
  it("distingue la espera agotada de la conexión caída al volver a reservar antes del PUT", async () => {
    const soon = (): UploadTarget => ({ key: `trips/${tripId}/photos/soon`, uploadUrl: "https://s3.test/soon", headers: {}, expiresAt: NOW + RESERVE_MARGIN_MS - 1 });
    for (const [error, failure] of [[{ kind: "network", code: "TimeoutError" }, "timeout"], [{ kind: "network", code: "NetworkError" }, "network"]] as const) {
      let first = true;
      const api = { reserve: vi.fn(async (): Promise<TripResult<UploadTarget[]>> => {
        if (first) { first = false; return { ok: true, value: [soon()] }; }
        return { ok: false, error };
      }) };
      const transfer = okTransfer();
      const report = await run([item(1)], { api, transfer });
      expect(api.reserve).toHaveBeenCalledTimes(2);
      expect(transfer.put).not.toHaveBeenCalled();
      expect(report.items[0]).toMatchObject({ status: "failed", failure });
      expect(report.reserveError).toBeUndefined();
    }
  });
  it("does not re-reserve when the url is valid for exactly the margin", async () => {
    const api = fakeApi(RESERVE_MARGIN_MS);
    await run([item(1)], { api });
    expect(api.reserve).toHaveBeenCalledTimes(1);
  });
  it("discards uploaded photos older than the reuse window and keeps the newer ones", async () => {
    const api = fakeApi(), transfer = okTransfer();
    const report = await run([done(1, NOW - MAX_RESERVED_AGE_MS - 1), done(2, NOW - MAX_RESERVED_AGE_MS + 1)], { api, transfer });
    expect(api.reserve).toHaveBeenCalledExactlyOnceWith(tripId, [{ contentType: "image/jpeg", sizeBytes: 101 }]);
    expect(report.items[0]!.key).not.toContain("old-1");
    expect(report.items[1]!.key).toContain("old-2");
    expect(MAX_RESERVED_AGE_MS).toBe(12 * HOUR);
  });
  it("returns the reservation error without uploading or changing anything", async () => {
    const api = { reserve: vi.fn(async (): Promise<TripResult<UploadTarget[]>> => ({ ok: false, error: { kind: "not-found" } })) }, transfer = okTransfer();
    const items = [item(1), item(2)];
    const report = await run(items, { api, transfer });
    expect(report.reserveError).toEqual({ kind: "not-found" });
    expect(transfer.put).not.toHaveBeenCalled();
    expect(report.items).toEqual(items);
  });
  it("marks the photos named by a per-file validation error as failed and does not upload", async () => {
    const api = { reserve: vi.fn(async (): Promise<TripResult<UploadTarget[]>> => ({ ok: false, error: { kind: "validation", fields: [{ field: "files[1].sizeBytes", code: "too_large", message: "m" }] } })) };
    const transfer = okTransfer();
    const report = await run([item(1), item(2)], { api, transfer });
    expect(report.items.map((entry) => entry.status)).toEqual(["selected", "failed"]);
    expect(report.items[1]).toMatchObject({ failure: "too_large" });
    expect(report.reserveError?.kind).toBe("validation");
    expect(transfer.put).not.toHaveBeenCalled();
  });
  it("fails a photo whose binary is gone without blocking the others", async () => {
    const transfer = okTransfer();
    const store = blobs(["p1"]);
    const report = await uploadPending({ tripId, items: [item(1), item(2)], blobs: store, api: fakeApi(), transfer, now: () => NOW });
    expect(report.items.map((entry) => entry.status)).toEqual(["uploaded", "failed"]);
    expect(report.items[1]).toMatchObject({ failure: "missing" });
  });
  it("stops on abort without marking in-flight photos as failed and keeps what was uploaded", async () => {
    const controller = new AbortController();
    const transfer = { put: vi.fn(async (url: string): Promise<UploadOutcome> => {
      if (url.endsWith("/2")) { controller.abort(); return { ok: false, code: "aborted" }; }
      return { ok: true };
    }) };
    counter = 0;
    const report = await run([item(1), item(2), item(3)], { transfer, signal: controller.signal });
    expect(report.aborted).toBe(true);
    expect(report.items[0]!.status).toBe("uploaded");
    expect(report.items[1]!.status).toBe("selected");
    expect(report.items[2]!.status).toBe("selected");
    expect(transfer.put).toHaveBeenCalledTimes(2);
  });
  it("reports each settled photo and the progress as it happens", async () => {
    const onUpdate = vi.fn(), onProgress = vi.fn();
    const transfer = { put: vi.fn(async (_u: string, _h: unknown, _b: Blob, options: { onProgress?: (fraction: number) => void }): Promise<UploadOutcome> => { options.onProgress?.(0.5); return { ok: true }; }) };
    await run([item(1)], { transfer: transfer as never, onUpdate, onProgress });
    expect(onProgress).toHaveBeenCalledWith("p1", 0.5);
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith("p1", expect.objectContaining({ status: "uploaded", uploadedAt: NOW }));
  });
});
