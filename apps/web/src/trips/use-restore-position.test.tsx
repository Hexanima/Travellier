// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { itineraryId } from "./itinerary-test-fixture.js";
import { useRestorePosition } from "./use-restore-position.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); vi.restoreAllMocks(); });
const id = itineraryId(5);
const seen: unknown[] = [];
function Screen({ ready }: { ready: boolean }) {
  const location = useLocation();
  seen.push(location.state);
  useRestorePosition(ready);
  return <ul><li data-memory={id} tabIndex={-1}>memoria</li><li data-photo={id} tabIndex={-1}>foto</li></ul>;
}
async function mount(state: unknown, ready = true) {
  seen.length = 0;
  const scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView;
  const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={[{ pathname: "/x", state }]}><Screen ready={ready} /></MemoryRouter>));
  return { container, scrollIntoView, scrollTo, root, rerender: (next: boolean) => act(async () => root.render(<MemoryRouter initialEntries={[{ pathname: "/x", state }]}><Screen ready={next} /></MemoryRouter>)) };
}

describe("useRestorePosition", () => {
  it("scrolls to the anchor, focuses it and clears the whole state when nothing else is kept", async () => {
    const { container, scrollIntoView } = await mount({ restore: { anchor: `data-memory=${id}`, scrollY: 40 } });
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    expect(document.activeElement).toBe(container.querySelector("[data-memory]"));
    expect(seen[seen.length - 1]).toBeNull();
  });
  it("falls back to the saved scroll when the anchor is not in the page", async () => {
    const other = itineraryId(77);
    const { scrollTo } = await mount({ restore: { anchor: `data-memory=${other}`, scrollY: 40 } });
    expect(scrollTo).toHaveBeenCalledWith(0, 40);
  });
  it("waits for the screen to be ready", async () => {
    const { scrollIntoView, rerender } = await mount({ restore: { anchor: `data-memory=${id}`, scrollY: 40 } }, false);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(seen[seen.length - 1]).toEqual({ restore: { anchor: `data-memory=${id}`, scrollY: 40 } });
    await rerender(true);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });
  it("removes only the restore key and keeps the open photo", async () => {
    await mount({ photo: id, restore: { anchor: `data-photo=${id}`, scrollY: 10, panel: "photos" } });
    expect(seen[seen.length - 1]).toEqual({ photo: id });
  });
  it("does not focus the grid when the viewer is open, it only scrolls", async () => {
    const { container, scrollIntoView } = await mount({ photo: id, restore: { anchor: `data-photo=${id}`, scrollY: 10 } });
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    expect(document.activeElement).not.toBe(container.querySelector("[data-photo]"));
  });
  it("does nothing without a valid restore", async () => {
    const { scrollIntoView, scrollTo } = await mount({ photo: id });
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
    expect(seen[seen.length - 1]).toEqual({ photo: id });
  });
});
