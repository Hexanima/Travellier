import { describe, expect, it, vi } from "vitest";
import { createNativeIcsSharer, type IcsSharerDeps } from "./ics-share.js";

const URI = "file:///data/user/0/app/cache/travellier-viaje.ics";
type Overrides = Partial<{ platform: string; write: () => Promise<{ uri: string }>; canShare: () => Promise<{ value: boolean }>; share: () => Promise<unknown>; del: () => Promise<unknown> }>;
function setup(overrides: Overrides = {}) {
  const calls: string[] = [];
  const writeFile = vi.fn<(options: unknown) => Promise<{ uri: string }>>(async () => { calls.push("write"); return overrides.write ? overrides.write() : { uri: URI }; });
  const deleteFile = vi.fn<(options: unknown) => Promise<unknown>>(async () => { calls.push("delete"); return overrides.del ? overrides.del() : {}; });
  const canShare = vi.fn(async () => { calls.push("canShare"); return overrides.canShare ? overrides.canShare() : { value: true }; });
  const share = vi.fn<(options: unknown) => Promise<unknown>>(async () => { calls.push("share"); return overrides.share ? overrides.share() : {}; });
  const fallback = vi.fn<(text: string, name: string) => { ok: boolean }>(() => ({ ok: true }));
  const deps = { filesystem: { writeFile, deleteFile }, share: { canShare, share }, platform: () => overrides.platform ?? "android", fallback } as unknown as IcsSharerDeps;
  return { sharer: createNativeIcsSharer(deps), writeFile, deleteFile, canShare, share, fallback, calls };
}

describe("createNativeIcsSharer", () => {
  it("writes to Cache as UTF-8 with a safe name, then shares the returned uri", async () => {
    const { sharer, writeFile, share, calls } = setup();
    const result = await sharer.save("BEGIN:VCALENDAR\r\nSUMMARY:Córdoba", "../x/..");
    expect(result).toEqual({ ok: true, via: "shared" });
    expect(writeFile).toHaveBeenCalledTimes(1);
    const options = writeFile.mock.calls[0][0] as { path: string; data: string; directory: string; encoding: string };
    expect(options.directory).toBe("CACHE");
    expect(options.encoding).toBe("utf8");
    expect(options.data).toContain("Córdoba");
    expect(options.path).toMatch(/^[\p{L}\p{N}_-]+\.ics$/u);
    expect(options.path).not.toContain("..");
    expect(share).toHaveBeenCalledTimes(1);
    expect((share.mock.calls[0][0] as { files: string[] }).files).toEqual([URI]);
    expect(calls).toEqual(["write", "canShare", "share"]);
  });
  it("fails without sharing when the write is rejected", async () => {
    const { sharer, share } = setup({ write: async () => { throw new Error("EACCES /secret/path"); } });
    expect(await sharer.save("x", "a.ics")).toEqual({ ok: false, reason: "failed" });
    expect(share).not.toHaveBeenCalled();
  });
  it("fails when the device cannot share", async () => {
    const { sharer, share } = setup({ canShare: async () => ({ value: false }) });
    expect(await sharer.save("x", "a.ics")).toEqual({ ok: false, reason: "failed" });
    expect(share).not.toHaveBeenCalled();
  });
  it("fails when canShare itself rejects", async () => {
    const { sharer } = setup({ canShare: async () => { throw new Error("boom"); } });
    expect(await sharer.save("x", "a.ics")).toEqual({ ok: false, reason: "failed" });
  });
  it("reports a dismissed sheet as cancelled", async () => {
    const { sharer } = setup({ share: async () => { throw new Error("Share canceled"); } });
    expect(await sharer.save("x", "a.ics")).toEqual({ ok: false, reason: "cancelled" });
  });
  it("reports any other share rejection as failed", async () => {
    const { sharer } = setup({ share: async () => { throw new Error("Cannot share while sharing is in progress"); } });
    expect(await sharer.save("x", "a.ics")).toEqual({ ok: false, reason: "failed" });
  });
  it("never lets a cleanup failure change the result and never leaks paths", async () => {
    const { sharer, deleteFile } = setup({ del: async () => { throw new Error("cannot delete " + URI); } });
    expect(await sharer.save("x", "a.ics")).toEqual({ ok: true, via: "shared" });
    expect(await sharer.save("x", "b.ics")).toEqual({ ok: true, via: "shared" });
    expect(deleteFile).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await sharer.save("x", "b.ics"))).not.toContain("cache");
  });
  it("does not delete the file right after sharing", async () => {
    const { sharer, deleteFile } = setup();
    await sharer.save("x", "a.ics");
    expect(deleteFile).not.toHaveBeenCalled();
  });
  it("rejects text over the size cap without writing", async () => {
    const { sharer, writeFile } = setup();
    expect(await sharer.save("é".repeat(600_000), "a.ics")).toEqual({ ok: false, reason: "failed" });
    expect(writeFile).not.toHaveBeenCalled();
  });
  it("delegates to the download fallback outside Android and iOS", async () => {
    const { sharer, writeFile, fallback } = setup({ platform: "web" });
    expect(await sharer.save("x", "a.ics")).toEqual({ ok: true, via: "downloaded" });
    expect(fallback).toHaveBeenCalledWith("x", "a.ics");
    expect(writeFile).not.toHaveBeenCalled();
  });
  it("reports a failed fallback as failed", async () => {
    const { sharer, fallback } = setup({ platform: "web" });
    fallback.mockReturnValueOnce({ ok: false });
    expect(await sharer.save("x", "a.ics")).toEqual({ ok: false, reason: "failed" });
  });
  it("has no side effects on construction", () => {
    const { writeFile, share, canShare, deleteFile, fallback } = setup();
    for (const fn of [writeFile, share, canShare, deleteFile, fallback]) expect(fn).not.toHaveBeenCalled();
  });
});
