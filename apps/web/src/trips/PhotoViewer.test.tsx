// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { itineraryId } from "./itinerary-test-fixture.js";
import { PhotoViewer, type PhotoViewerProps } from "./PhotoViewer.js";
import type { GalleryPhoto } from "./trip-gallery-api.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
const tripId = itineraryId(1);
const photo = (n: number): GalleryPhoto => ({ id: itineraryId(n), postId: itineraryId(500 + n), order: 0, uploadedAt: "2026-11-10T01:30:00.000Z", uploaderId: itineraryId(600 + n),
  url: `https://s3.test/${n}?sig=SECRET`, expiresAtMs: 1, post: { createdAt: "2026-11-10T01:00:00.000Z", authorId: itineraryId(700), rootActivityId: null, rootTransportId: null } });
const photos = [photo(3), photo(2), photo(1)];
const props = (over: Partial<PhotoViewerProps> = {}): PhotoViewerProps => ({ photos, photoId: itineraryId(2), hasMore: false, loadingMore: false, timeZone: "America/Argentina/Buenos_Aires",
  authorOf: (item) => item.id === itineraryId(2) ? "Ana" : "Vos", postHref: (item) => `/trips/${tripId}/memories/${item.postId}`,
  onSelect: vi.fn(), onLoadMore: vi.fn(), onClose: vi.fn(), onOpenPost: vi.fn(), onImageError: vi.fn(), onRetryImage: vi.fn(), failed: false, ...over });
async function mount(p: PhotoViewerProps) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  const render = (next: PhotoViewerProps) => act(async () => root.render(<PhotoViewer {...next} />));
  await render(p);
  return { container, render };
}
const button = (name: string) => Array.from(document.querySelectorAll("button")).find((item) => item.textContent === name || item.getAttribute("aria-label") === name) as HTMLButtonElement;
const key = (target: Element, name: string) => act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })); });

describe("PhotoViewer", () => {
  it("is a dialog titled with the position and shows the enlarged photo with a descriptive alt in the local zone", async () => {
    await mount(props());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.querySelector("h2")?.textContent).toBe("Foto 2 de 3");
    const img = dialog.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("https://s3.test/2?sig=SECRET");
    expect(img.getAttribute("alt")).toBe("Foto de Ana del 9 de nov de 2026"); // 01:30Z is still the 9th in Buenos Aires
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(img.hasAttribute("crossorigin")).toBe(false);
    expect(dialog.textContent).toContain("Ana");
    expect(dialog.textContent).toContain("9 de nov de 2026, 22:30");
  });
  it("says «cargadas» while there are more pages", async () => {
    await mount(props({ hasMore: true }));
    expect(document.querySelector("h2")?.textContent).toBe("Foto 2 de 3 cargadas");
  });
  it("closes with the button and with Escape", async () => {
    const p = props();
    await mount(p);
    await act(async () => button("Cerrar").click());
    expect(p.onClose).toHaveBeenCalledTimes(1);
    await key(document.querySelector('[role="dialog"]')!, "Escape");
    expect(p.onClose).toHaveBeenCalledTimes(2);
  });
  it("goes to the previous and next loaded photo", async () => {
    const p = props();
    await mount(p);
    await act(async () => button("Anterior").click());
    expect(p.onSelect).toHaveBeenLastCalledWith(itineraryId(3));
    await act(async () => button("Siguiente").click());
    expect(p.onSelect).toHaveBeenLastCalledWith(itineraryId(1));
  });
  it("marks the first and last photo with aria-disabled, ignores the click and keeps the focus on the button", async () => {
    const first = props({ photoId: itineraryId(3) });
    await mount(first);
    const previous = button("Anterior");
    expect(previous.getAttribute("aria-disabled")).toBe("true");
    expect(previous.disabled).toBe(false);
    previous.focus();
    await act(async () => previous.click());
    expect(first.onSelect).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(previous);
    expect(button("Siguiente").getAttribute("aria-disabled")).toBeNull();
    document.body.replaceChildren();
    const last = props({ photoId: itineraryId(1) });
    await mount(last);
    const next = button("Siguiente");
    expect(next.getAttribute("aria-disabled")).toBe("true");
    next.focus();
    await act(async () => next.click());
    expect(last.onSelect).not.toHaveBeenCalled();
    expect(last.onLoadMore).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(next);
  });
  it("moves with the arrow keys as an auxiliary shortcut and not at the ends", async () => {
    const p = props();
    await mount(p);
    await key(document.body, "ArrowLeft");
    expect(p.onSelect).toHaveBeenLastCalledWith(itineraryId(3));
    await key(document.body, "ArrowRight");
    expect(p.onSelect).toHaveBeenLastCalledWith(itineraryId(1));
    document.body.replaceChildren();
    const end = props({ photoId: itineraryId(3) });
    await mount(end);
    await key(document.body, "ArrowLeft");
    expect(end.onSelect).not.toHaveBeenCalled();
  });
  it("on the last loaded photo with more pages «Siguiente» loads more and then moves to the first new photo", async () => {
    const p = props({ photoId: itineraryId(1), hasMore: true });
    const { render } = await mount(p);
    const next = button("Siguiente");
    expect(next.getAttribute("aria-disabled")).toBeNull();
    next.focus();
    await act(async () => next.click());
    expect(p.onLoadMore).toHaveBeenCalledTimes(1);
    expect(p.onSelect).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(next);
    await render({ ...p, loadingMore: true });
    await act(async () => button("Siguiente").click());
    expect(p.onLoadMore).toHaveBeenCalledTimes(1);
    await render({ ...p, loadingMore: false, hasMore: false, photos: [...photos, photo(0)] });
    expect(p.onSelect).toHaveBeenCalledTimes(1);
    expect(p.onSelect).toHaveBeenCalledWith(itineraryId(0));
  });
  it("offers «Ver recuerdo» pointing to the post and reports the click", async () => {
    const p = props();
    await mount(p);
    const link = Array.from(document.querySelectorAll("a")).find((item) => item.textContent === "Ver recuerdo")!;
    expect(link.getAttribute("href")).toBe(`/trips/${tripId}/memories/${itineraryId(502)}`);
    await act(async () => link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })));
    expect(p.onOpenPost).toHaveBeenCalledWith(photos[1]);
  });
  it("shows a placeholder with retry when the photo cannot load and reports image errors", async () => {
    const p = props();
    const { render } = await mount(p);
    await act(async () => document.querySelector("img")!.dispatchEvent(new Event("error")));
    expect(p.onImageError).toHaveBeenCalledWith(itineraryId(2));
    await render({ ...p, failed: true });
    expect(document.querySelector("img")).toBeNull();
    expect(document.body.textContent).toContain("No se pudo cargar la imagen");
    await act(async () => button("Reintentar").click());
    expect(p.onRetryImage).toHaveBeenCalledWith(itineraryId(2));
  });
  it("shows the notice as the single alert of the dialog, without aria-live next to it, and retries from inside", async () => {
    const onRetryNotice = vi.fn();
    const { render } = await mount(props({ notice: "No pudimos cargar las fotos.", onRetryNotice }));
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(dialog.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(dialog.querySelector('[role="alert"]')?.textContent).toBe("No pudimos cargar las fotos.");
    expect(dialog.querySelector('[role="alert"][aria-live]')).toBeNull();
    await act(async () => button("Reintentar").click());
    expect(onRetryNotice).toHaveBeenCalledTimes(1);
    await render(props());
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(0);
  });
  it("announces the load of more photos inside the dialog as a status", async () => {
    await mount(props({ photoId: itineraryId(1), hasMore: true, loadingMore: true }));
    const status = Array.from(document.querySelectorAll('[role="dialog"] [role="status"]')).find((item) => item.textContent === "Cargando más fotos…");
    expect(status).toBeTruthy();
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(0);
  });
  it("renders nothing for a photo that is not loaded", async () => {
    await mount(props({ photoId: itineraryId(77) }));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
