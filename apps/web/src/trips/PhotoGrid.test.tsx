// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { itineraryId } from "./itinerary-test-fixture.js";
import { PhotoGrid, type PhotoGridItem } from "./PhotoGrid.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
const item = (n: number, extra: Partial<PhotoGridItem> = {}): PhotoGridItem => ({ id: itineraryId(n), src: `https://s3.test/${n}?sig=x`, name: `Foto ${n} de 2. De Ana, 10 nov 2026`,
  caption: "Ana, 10 nov 2026", onOpen: vi.fn(), onError: vi.fn(), onRetry: vi.fn(), ...extra });
async function mount(items: PhotoGridItem[]) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<PhotoGrid label="Fotos del viaje" items={items} />));
  return container;
}

describe("PhotoGrid", () => {
  it("is a labelled list with one item per photo, in the given order, each with a named button", async () => {
    const container = await mount([item(2), item(1)]);
    const list = container.querySelector("ul.photo-grid");
    expect(list?.getAttribute("aria-label")).toBe("Fotos del viaje");
    const entries = Array.from(list!.querySelectorAll(":scope > li"));
    expect(entries.map((entry) => entry.getAttribute("data-photo"))).toEqual([itineraryId(2), itineraryId(1)]);
    const button = entries[0]!.querySelector("button")!;
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("aria-label")).toBe("Foto 2 de 2. De Ana, 10 nov 2026");
    expect(entries[0]!.textContent).toContain("Ana, 10 nov 2026");
  });
  it("renders a decorative lazy image that sends no referrer and no credentials mode", async () => {
    const container = await mount([item(1)]);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("https://s3.test/1?sig=x");
    expect(img.getAttribute("alt")).toBe("");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("decoding")).toBe("async");
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(img.hasAttribute("crossorigin")).toBe(false);
  });
  it("opens a photo and reports image errors", async () => {
    const first = item(1);
    const container = await mount([first]);
    await act(async () => container.querySelector("button")!.click());
    expect(first.onOpen).toHaveBeenCalledTimes(1);
    await act(async () => container.querySelector("img")!.dispatchEvent(new Event("error")));
    expect(first.onError).toHaveBeenCalledTimes(1);
  });
  it("shows a failed photo as a placeholder with a retry and no image", async () => {
    const failed = item(1, { failed: true });
    const container = await mount([failed, item(2)]);
    const entry = container.querySelector(`[data-photo="${itineraryId(1)}"]`)!;
    expect(entry.querySelector("img")).toBeNull();
    expect(entry.textContent).toContain("No se pudo cargar la imagen");
    const retry = Array.from(entry.querySelectorAll("button")).find((button) => button.textContent === "Reintentar")!;
    await act(async () => retry.click());
    expect(failed.onRetry).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });
  it("keeps the order and data-photo of a single photo, of many and of mixed caption lengths", async () => {
    const single = await mount([item(1)]);
    expect(Array.from(single.querySelectorAll("ul.photo-grid > li")).map((entry) => entry.getAttribute("data-photo"))).toEqual([itineraryId(1)]);
    const long = `${"Una autora con un nombre larguísimo ".repeat(6)}10 nov 2026`;
    const many = await mount([item(9, { caption: long }), item(8, { caption: undefined }), item(7, { caption: "Ana" }), ...[6, 5, 4, 3, 2, 1].map((n) => item(n))]);
    const entries = Array.from(many.querySelectorAll("ul.photo-grid > li"));
    expect(entries.map((entry) => entry.getAttribute("data-photo"))).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1].map((n) => itineraryId(n)));
    expect(entries[0]!.querySelector(".photo-grid__caption")?.textContent).toBe(long);
    expect(entries[1]!.querySelector(".photo-grid__caption")).toBeNull();
    expect(entries.every((entry) => entry.classList.contains("photo-grid__item"))).toBe(true);
  });
  it("a failed photo keeps its slot and does not change the other ones", async () => {
    const container = await mount([item(3), item(2, { failed: true }), item(1)]);
    const entries = Array.from(container.querySelectorAll("ul.photo-grid > li"));
    expect(entries.map((entry) => entry.getAttribute("data-photo"))).toEqual([3, 2, 1].map((n) => itineraryId(n)));
    expect(entries.map((entry) => entry.querySelector("img") !== null)).toEqual([true, false, true]);
    expect(entries[1]!.querySelector(".photo-grid__failed button")?.textContent).toBe("Reintentar");
  });
  it("renders no items for an empty list", async () => {
    const container = await mount([]);
    expect(container.querySelectorAll("li")).toHaveLength(0);
    expect(container.querySelector("img")).toBeNull();
  });
});
