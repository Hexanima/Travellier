// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublishedPhotosSection } from "./PublishedPhotosSection.js";
import type { PublishedPhoto } from "./trip-photo-api.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
const A = "0000000000000000000000a1", B = "0000000000000000000000a2", C = "0000000000000000000000a3";
const photos: PublishedPhoto[] = [{ id: A, order: 1, url: "https://cdn.test/a.jpg?sig=1" }, { id: B, order: 2 }, { id: C, order: 3, url: "https://cdn.test/c.jpg?sig=1" }];
function Host({ items = photos, busy = false, onToggle }: { items?: PublishedPhoto[]; busy?: boolean; onToggle?: (id: string) => void }) {
  const [marked, setMarked] = useState<string[]>([]);
  return <PublishedPhotosSection items={items} marked={marked} busy={busy}
    onToggle={(id) => { onToggle?.(id); setMarked((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }} />;
}
async function render(element: React.ReactElement) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(element));
  return container;
}
const click = async (element: Element | null | undefined) => { expect(element).toBeTruthy(); await act(async () => element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))); };
const row = (container: HTMLElement, id: string) => container.querySelector(`[data-published-photo="${id}"]`) as HTMLElement;
const action = (container: HTMLElement, id: string) => row(container, id).querySelector("button") as HTMLButtonElement;

describe("PublishedPhotosSection", () => {
  it("lists the published photos with a thumbnail when there is a url and a placeholder otherwise", async () => {
    const container = await render(<Host />);
    expect(container.querySelector("h2")?.textContent).toBe("Fotos publicadas");
    expect(Array.from(container.querySelectorAll("li")).length).toBe(3);
    expect(row(container, A).querySelector("img")?.getAttribute("src")).toBe("https://cdn.test/a.jpg?sig=1");
    expect(row(container, A).querySelector("img")?.getAttribute("alt")).toBe("Foto publicada 1 de 3");
    expect(row(container, B).querySelector("img")).toBeNull();
    expect(row(container, B).querySelector(".post-photo-placeholder")?.getAttribute("aria-label")).toBe("Foto publicada 2 de 3");
  });
  it("falls back to the placeholder when the thumbnail fails to load", async () => {
    const container = await render(<Host />);
    await act(async () => { row(container, C).querySelector("img")!.dispatchEvent(new Event("error")); });
    expect(row(container, C).querySelector("img")).toBeNull();
    expect(row(container, C).querySelector(".post-photo-placeholder")).not.toBeNull();
    expect(row(container, A).querySelector("img")).not.toBeNull();
  });
  it("marks a photo with «Quitar», shows it will be removed and undoes it with «Deshacer»", async () => {
    const onToggle = vi.fn();
    const container = await render(<Host onToggle={onToggle} />);
    expect(action(container, B).textContent).toBe("Quitar");
    expect(action(container, B).getAttribute("aria-label")).toBe("Quitar foto publicada 2 de 3");
    expect(row(container, B).textContent).not.toContain("Se quitará al guardar");
    await click(action(container, B));
    expect(onToggle).toHaveBeenCalledWith(B);
    expect(row(container, B).textContent).toContain("Se quitará al guardar");
    expect(action(container, B).textContent).toBe("Deshacer");
    expect(action(container, B).getAttribute("aria-label")).toBe("Deshacer quitar foto publicada 2 de 3");
    expect(row(container, A).textContent).not.toContain("Se quitará al guardar");
    await click(action(container, B));
    expect(row(container, B).textContent).not.toContain("Se quitará al guardar");
    expect(action(container, B).textContent).toBe("Quitar");
  });
  it("keeps the focus on the row's action after toggling", async () => {
    const container = await render(<Host />);
    action(container, A).focus();
    await click(action(container, A));
    expect(document.activeElement).toBe(action(container, A));
  });
  it("ignores the press while busy and exposes aria-disabled", async () => {
    const onToggle = vi.fn();
    const container = await render(<Host busy onToggle={onToggle} />);
    expect(action(container, A).getAttribute("aria-disabled")).toBe("true");
    await click(action(container, A));
    expect(onToggle).not.toHaveBeenCalled();
  });
  it("renders nothing without photos", async () => {
    const container = await render(<Host items={[]} />);
    expect(container.querySelector("section")).toBeNull();
  });
});
