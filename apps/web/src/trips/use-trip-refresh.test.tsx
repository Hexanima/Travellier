// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTripRefresh } from "./use-trip-refresh.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
let visibility: "visible" | "hidden" = "visible";
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z")); visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
});
afterEach(async () => { vi.useRealTimers(); await act(async () => roots.splice(0).forEach((root) => root.unmount())); delete (document as { visibilityState?: unknown }).visibilityState; });

function Probe({ refresh, intervalMs }: { refresh: () => void | Promise<unknown>; intervalMs?: number }) { useTripRefresh(refresh, intervalMs === undefined ? undefined : { intervalMs }); return null; }
const mount = async (refresh: () => void | Promise<unknown>, intervalMs?: number) => {
  const root = createRoot(document.createElement("div")); roots.push(root);
  await act(async () => root.render(<Probe refresh={refresh} intervalMs={intervalMs} />));
  return root;
};
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const show = async () => { visibility = "visible"; await act(async () => { document.dispatchEvent(new Event("visibilitychange")); }); };
const hide = async () => { visibility = "hidden"; await act(async () => { document.dispatchEvent(new Event("visibilitychange")); }); };

describe("useTripRefresh", () => {
  it("does nothing on mount: the screen loads by itself", async () => {
    const refresh = vi.fn(); await mount(refresh);
    expect(refresh).not.toHaveBeenCalled();
  });
  it("refreshes every 45 seconds while visible", async () => {
    const refresh = vi.fn(); await mount(refresh);
    await advance(44_999); expect(refresh).not.toHaveBeenCalled();
    await advance(1); expect(refresh).toHaveBeenCalledTimes(1);
    await advance(45_000); expect(refresh).toHaveBeenCalledTimes(2);
  });
  it("never refreshes in the background: neither on the interval nor on a stray focus", async () => {
    const refresh = vi.fn(); await mount(refresh);
    await hide();
    await advance(200_000);
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(refresh).not.toHaveBeenCalled();
  });
  it("refreshes when the app becomes visible again, and the interval keeps going", async () => {
    const refresh = vi.fn(); await mount(refresh);
    await hide(); await advance(100_000);
    await show();
    expect(refresh).toHaveBeenCalledTimes(1);
    await advance(45_000); expect(refresh).toHaveBeenCalledTimes(2);
  });
  it("does not refresh when visibilitychange reports hidden", async () => {
    const refresh = vi.fn(); await mount(refresh);
    await hide();
    expect(refresh).not.toHaveBeenCalled();
  });
  it("refreshes on focus while visible", async () => {
    const refresh = vi.fn(); await mount(refresh);
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it("collapses focus and visibilitychange fired together into one refresh", async () => {
    const refresh = vi.fn(); await mount(refresh);
    await show(); await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(refresh).toHaveBeenCalledTimes(1);
    await advance(1_500);
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(refresh).toHaveBeenCalledTimes(2);
  });
  it("does not start another refresh while one is still in flight", async () => {
    let finish!: () => void;
    const refresh = vi.fn().mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    await mount(refresh);
    await advance(45_000); expect(refresh).toHaveBeenCalledTimes(1);
    await advance(45_000); expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); });
    await advance(45_000); expect(refresh).toHaveBeenCalledTimes(2);
  });
  it("keeps working after a refresh that fails", async () => {
    const refresh = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined);
    await mount(refresh);
    await advance(45_000); await advance(45_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
  it("uses the latest refresh function without restarting the interval", async () => {
    const first = vi.fn(), second = vi.fn();
    const root = await mount(first);
    await advance(30_000);
    await act(async () => root.render(<Probe refresh={second} />));
    await advance(15_000);
    expect(first).not.toHaveBeenCalled(); expect(second).toHaveBeenCalledTimes(1);
  });
  it("accepts another interval", async () => {
    const refresh = vi.fn(); await mount(refresh, 1_000);
    await advance(3_000);
    expect(refresh).toHaveBeenCalledTimes(3);
  });
  it("removes the listeners and the interval when unmounted", async () => {
    const refresh = vi.fn(); const root = await mount(refresh);
    await act(async () => root.unmount()); roots.splice(0);
    await advance(200_000);
    await show(); await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(refresh).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
