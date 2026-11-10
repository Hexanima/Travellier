// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PostPhotosSection, type PostPhotosSectionProps } from "./PostPhotosSection.js";
import type { PhotoDraftItem } from "./post-draft.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
const photo = (n: number, extra: Partial<PhotoDraftItem> = {}): PhotoDraftItem =>
  ({ localId: `p${n}`, reference: `ref${n}`, previewUrl: `https://localhost/p${n}.jpg`, contentType: "image/jpeg", sizeBytes: 10, status: "selected", ...extra });
type Overrides = Partial<PostPhotosSectionProps> & { initial?: PhotoDraftItem[] };
async function render({ initial = [photo(1), photo(2), photo(3)], ...overrides }: Overrides = {}) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  const calls = { add: vi.fn(async (): Promise<"added" | "cancelled"> => "added"), retry: vi.fn() };
  function Harness() {
    const [items, setItems] = useState(initial);
    return <PostPhotosSection items={items} active={[]} progress={{}} summary="" busy={false} focusRetry={0}
      onAdd={calls.add} onRetry={calls.retry}
      onRemove={(id) => setItems((current) => current.filter((item) => item.localId !== id))}
      onMove={(id, delta) => setItems((current) => { const index = current.findIndex((item) => item.localId === id); const next = [...current]; [next[index], next[index + delta]] = [next[index + delta]!, next[index]!]; return next; })}
      {...overrides} />;
  }
  await act(async () => root.render(<Harness />));
  return { container, ...calls };
}
const btn = (container: ParentNode, label: string) => Array.from(container.querySelectorAll("button")).find((item) => item.getAttribute("aria-label") === label || item.textContent === label) as HTMLButtonElement;
const click = async (element: Element | undefined) => { expect(element).toBeDefined(); await act(async () => element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))); };

describe("PostPhotosSection", () => {
  it("names each photo «Foto N de M» and offers both sources", async () => {
    const { container } = await render();
    expect(Array.from(container.querySelectorAll("img")).map((img) => img.alt)).toEqual(["Foto 1 de 3", "Foto 2 de 3", "Foto 3 de 3"]);
    expect(btn(container, "Agregar fotos")).toBeDefined(); expect(btn(container, "Sacar foto")).toBeDefined();
    expect(container.querySelectorAll("ul > li")).toHaveLength(3);
  });
  it("shows Lista, Subiendo with its percentage and No se subió with the reason as plain text", async () => {
    const { container } = await render({ initial: [photo(1), photo(2), photo(3, { status: "failed", failure: "expired" })], active: ["p2"], progress: { p2: 0.45 } });
    const statuses = Array.from(container.querySelectorAll(".post-photo-status")).map((item) => item.textContent);
    expect(statuses).toEqual(["Lista", "Subiendo 45 %", "No se subió. El permiso de subida venció."]);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it("has a single polite status and a single alert, even with several failed photos", async () => {
    const failed = (n: number) => photo(n, { status: "failed", failure: "network" });
    const { container } = await render({ initial: [failed(1), failed(2)], summary: "Subiendo fotos: 2 de 5", alert: "2 fotos no se subieron." });
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Subiendo fotos: 2 de 5");
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(container.querySelector("[aria-live]")).toBeNull();
    expect(container.querySelectorAll("[data-photo-retry]")).toHaveLength(2);
  });
  it("keeps the controls focusable but inert while busy", async () => {
    const onMove = vi.fn(), onRemove = vi.fn(), onRetry = vi.fn();
    const { container, add } = await render({ busy: true, onMove, onRemove, onRetry, initial: [photo(1, { status: "failed" }), photo(2)] });
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons.every((item) => item.getAttribute("aria-disabled") === "true" && !item.disabled)).toBe(true);
    for (const item of buttons) await click(item);
    expect(add).not.toHaveBeenCalled(); expect(onMove).not.toHaveBeenCalled(); expect(onRemove).not.toHaveBeenCalled(); expect(onRetry).not.toHaveBeenCalled();
  });
  it("disables moving the first photo up and the last one down", async () => {
    const { container } = await render();
    expect(btn(container, "Subir foto 1 de 3").getAttribute("aria-disabled")).toBe("true");
    expect(btn(container, "Bajar foto 3 de 3").getAttribute("aria-disabled")).toBe("true");
    expect(btn(container, "Subir foto 2 de 3").getAttribute("aria-disabled")).toBeNull();
  });
  it("moves the focus to the next photo after removing, and to «Agregar fotos» after removing the last one", async () => {
    const { container } = await render({ initial: [photo(1), photo(2)] });
    await click(btn(container, "Quitar foto 1 de 2"));
    expect(document.activeElement).toBe(btn(container, "Quitar foto 1 de 1"));
    expect(container.querySelector("img")?.getAttribute("src")).toContain("p2.jpg");
    await click(btn(container, "Quitar foto 1 de 1"));
    expect(document.activeElement).toBe(btn(container, "Agregar fotos"));
  });
  it("keeps the focus on the moved photo, falling back to the other direction at an edge", async () => {
    const { container } = await render();
    await click(btn(container, "Subir foto 2 de 3"));
    expect(Array.from(container.querySelectorAll("img")).map((img) => img.getAttribute("src")?.split("/").pop())).toEqual(["p2.jpg", "p1.jpg", "p3.jpg"]);
    expect(document.activeElement).toBe(btn(container, "Bajar foto 1 de 3"));
  });
  it("returns the focus to the button that opened the picker when it is cancelled, and not otherwise", async () => {
    const { container, add } = await render({ initial: [] });
    add.mockResolvedValueOnce("cancelled");
    await click(btn(container, "Sacar foto"));
    expect(add).toHaveBeenCalledWith("camera");
    expect(document.activeElement).toBe(btn(container, "Sacar foto"));
    (document.activeElement as HTMLElement).blur();
    await click(btn(container, "Agregar fotos"));
    expect(add).toHaveBeenLastCalledWith("gallery");
    expect(document.activeElement).not.toBe(btn(container, "Agregar fotos"));
  });
  it("focuses the first Reintentar when the retry token changes", async () => {
    const failed = (n: number) => photo(n, { status: "failed", failure: "network" });
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container); roots.push(root);
    const props = { items: [photo(1), failed(2), failed(3)], active: [], progress: {}, summary: "", busy: false, onAdd: vi.fn(), onRemove: vi.fn(), onMove: vi.fn(), onRetry: vi.fn() };
    await act(async () => root.render(<PostPhotosSection {...props} focusRetry={0} />));
    expect(document.activeElement).toBe(document.body);
    await act(async () => root.render(<PostPhotosSection {...props} focusRetry={1} />));
    expect(document.activeElement).toBe(btn(container, "Reintentar foto 2 de 3"));
  });
});
