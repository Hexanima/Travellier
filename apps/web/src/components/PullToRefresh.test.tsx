// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PullToRefresh } from "./PullToRefresh.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
beforeEach(() => { Object.defineProperty(window, "scrollY", { configurable: true, writable: true, value: 0 }); });

const touch = (target: Element, type: "touchstart" | "touchmove" | "touchend", y?: number, extra = 1) => act(async () => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const points = y === undefined ? [] : Array.from({ length: extra }, () => ({ clientY: y, clientX: 0 }));
  Object.defineProperty(event, "touches", { value: points });
  Object.defineProperty(event, "changedTouches", { value: points });
  target.dispatchEvent(event);
});
const pull = async (target: Element, from: number, to: number) => { await touch(target, "touchstart", from); await touch(target, "touchmove", to); await touch(target, "touchend"); };
async function mount(onRefresh: () => Promise<unknown> | void) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<PullToRefresh onRefresh={onRefresh}><ul><li data-row>Item</li></ul></PullToRefresh>));
  return container.querySelector("[data-row]")!;
}
const status = () => document.querySelector('[role="status"]');

describe("PullToRefresh", () => {
  it("refreshes once when the pull passes the threshold at the top of the page", async () => {
    const onRefresh = vi.fn(async () => undefined);
    const row = await mount(onRefresh);
    await pull(row, 100, 180);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
  it("does not refresh below the threshold", async () => {
    const onRefresh = vi.fn(async () => undefined);
    const row = await mount(onRefresh);
    await pull(row, 100, 150);
    expect(onRefresh).not.toHaveBeenCalled();
  });
  it("does not refresh when the page is scrolled (scrollY > 0) or the pull goes up", async () => {
    const onRefresh = vi.fn(async () => undefined);
    const row = await mount(onRefresh);
    (window as { scrollY: number }).scrollY = 120;
    await pull(row, 100, 300);
    (window as { scrollY: number }).scrollY = 0;
    await pull(row, 300, 100);
    expect(onRefresh).not.toHaveBeenCalled();
  });
  it("ignores a gesture with several fingers", async () => {
    const onRefresh = vi.fn(async () => undefined);
    const row = await mount(onRefresh);
    await touch(row, "touchstart", 100, 2); await touch(row, "touchmove", 300, 2); await touch(row, "touchend");
    expect(onRefresh).not.toHaveBeenCalled();
  });
  it("a gesture that scrolls the page before it ends is cancelled", async () => {
    const onRefresh = vi.fn(async () => undefined);
    const row = await mount(onRefresh);
    await touch(row, "touchstart", 100);
    (window as { scrollY: number }).scrollY = 30;
    await touch(row, "touchmove", 220); await touch(row, "touchend");
    expect(onRefresh).not.toHaveBeenCalled();
  });
  it("announces the state politely and does not start another refresh while one runs", async () => {
    let finish!: () => void;
    const onRefresh = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const row = await mount(onRefresh);
    expect(status()).not.toBeNull();
    expect(status()?.textContent).toBe("");
    const region = status();
    await touch(row, "touchstart", 100); await touch(row, "touchmove", 140);
    expect(status()?.textContent).toBe("");
    await touch(row, "touchmove", 190);
    expect(status()?.getAttribute("aria-live")).toBe("polite");
    expect(status()?.textContent).toContain("Soltá para actualizar");
    await touch(row, "touchend");
    expect(status()?.textContent).toContain("Actualizando");
    await pull(row, 100, 200);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(status()?.textContent).toBe("");
    expect(status()).toBe(region);
  });
  it("a refresh that fails does not leave the indicator stuck", async () => {
    const row = await mount(async () => { throw new Error("boom"); });
    await pull(row, 100, 200);
    expect(status()?.textContent).toBe("");
  });
});
