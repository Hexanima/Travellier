import { describe, expect, it, vi } from "vitest";
import { downloadIcs, type DownloadDeps } from "./download-ics.js";

class FakeBlob {
  parts: unknown[];
  options: { type?: string };
  constructor(parts: unknown[], options: { type?: string }) { this.parts = parts; this.options = options; }
}
function setup(overrides: Partial<{ createObjectURL: () => string; click: () => void }> = {}) {
  const calls: string[] = [];
  const anchor = { href: "", download: "", rel: "", style: { display: "" }, click: vi.fn(() => { calls.push("click"); overrides.click?.(); }), remove: vi.fn(() => calls.push("remove")) };
  const deferred: (() => void)[] = [];
  const created: FakeBlob[] = [];
  const deps: DownloadDeps = {
    Blob: FakeBlob as unknown as typeof Blob,
    url: {
      createObjectURL: vi.fn((blob: Blob) => { calls.push("create"); created.push(blob as unknown as FakeBlob); return overrides.createObjectURL ? overrides.createObjectURL() : "blob:fake-1"; }),
      revokeObjectURL: vi.fn(() => calls.push("revoke")),
    },
    document: { createElement: vi.fn(() => anchor as unknown as HTMLAnchorElement), body: { append: vi.fn(() => calls.push("append")) } as unknown as HTMLElement },
    defer: (task) => { deferred.push(task); },
  };
  return { deps, anchor, calls, deferred, created };
}

describe("downloadIcs", () => {
  it("downloads a text/calendar blob through a temporary anchor and revokes the URL later", () => {
    const { deps, anchor, calls, deferred, created } = setup();
    expect(downloadIcs("BEGIN:VCALENDAR\r\n", "travellier-viaje.ics", deps)).toEqual({ ok: true });
    expect(created[0].options).toEqual({ type: "text/calendar;charset=utf-8" });
    expect(created[0].parts).toEqual(["BEGIN:VCALENDAR\r\n"]);
    expect(anchor.href).toBe("blob:fake-1");
    expect(anchor.download).toBe("travellier-viaje.ics");
    expect(anchor.rel).toBe("noopener");
    expect(calls).toEqual(["create", "append", "click", "remove"]);
    expect(deps.url!.revokeObjectURL).not.toHaveBeenCalled();
    deferred.forEach((task) => task());
    expect(deps.url!.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:fake-1");
  });
  it.each([["../../etc/passwd", "etc-passwd.ics"], ["a/b\\c:d*e?.ics", "a-b-c-d-e.ics"], ["", "travellier-viaje.ics"], ["..", "travellier-viaje.ics"], ["nombre", "nombre.ics"],
    ["x\u0000\n.ics", "x.ics"]])("sanitizes the file name %j -> %s", (name, expected) => {
    const { deps, anchor } = setup();
    downloadIcs("x", name, deps);
    expect(anchor.download).toBe(expected);
  });
  it("returns ok:false without throwing when createObjectURL fails, and creates no anchor", () => {
    const { deps, anchor } = setup({ createObjectURL: () => { throw new Error("boom"); } });
    expect(downloadIcs("x", "a.ics", deps)).toEqual({ ok: false });
    expect(anchor.click).not.toHaveBeenCalled();
    expect(deps.url!.revokeObjectURL).not.toHaveBeenCalled();
  });
  it("returns ok:false when the click fails, removes the anchor and revokes the URL", () => {
    const { deps, anchor } = setup({ click: () => { throw new Error("blocked"); } });
    expect(downloadIcs("x", "a.ics", deps)).toEqual({ ok: false });
    expect(anchor.remove).toHaveBeenCalled();
    expect(deps.url!.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:fake-1");
  });
  it("returns ok:false when the platform has no Blob or URL support", () => {
    const { deps } = setup();
    expect(downloadIcs("x", "a.ics", { ...deps, url: undefined })).toEqual({ ok: false });
  });
});
