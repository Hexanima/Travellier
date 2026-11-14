// @vitest-environment jsdom
import { NativeCapabilityError } from "app-domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserPhotoAccept, createBrowserPhotoSource } from "./browser-photo-source.js";

afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); vi.restoreAllMocks(); });
const fileOf = (name: string, type: string) => new File([new Uint8Array(3)], name, { type });
const setup = () => {
  const created: File[] = [];
  const source = createBrowserPhotoSource({ doc: document, createObjectUrl: (file) => { created.push(file); return `blob:photo-${created.length}`; } });
  return { source, created };
};
/** El input vive en el documento solo mientras el selector está abierto. */
const picker = () => document.querySelector<HTMLInputElement>('input[type="file"]');
const chooseFiles = (input: HTMLInputElement, files: readonly File[]) => {
  Object.defineProperty(input, "files", { configurable: true, value: files });
  input.dispatchEvent(new Event("change"));
};

describe("browser photo source", () => {
  it("no consulta permisos: en el navegador el selector los pide por sí mismo", async () => {
    expect(await setup().source.checkPermission("gallery")).toEqual({ ok: true, value: "granted" });
    expect(await setup().source.checkPermission("camera")).toEqual({ ok: true, value: "granted" });
  });
  it("abre un selector múltiple de los tres formatos y devuelve cada archivo con su object url y su formato", async () => {
    const { source, created } = setup();
    const selection = source.select("gallery");
    const input = picker();
    expect(input).not.toBeNull();
    expect(input!.accept).toBe("image/jpeg,image/png,image/webp");
    expect(browserPhotoAccept).toBe("image/jpeg,image/png,image/webp");
    expect(input!.multiple).toBe(true);
    expect(input!.getAttribute("capture")).toBeNull();
    const files = [fileOf("a.jpg", "image/jpeg"), fileOf("b.png", "image/png")];
    chooseFiles(input!, files);
    expect(await selection).toEqual({ ok: true, value: [
      { reference: "blob:photo-1", previewUrl: "blob:photo-1", format: "image/jpeg" },
      { reference: "blob:photo-2", previewUrl: "blob:photo-2", format: "image/png" },
    ] });
    expect(created).toEqual(files);
    expect(picker()).toBeNull();
  });
  it("no queda visible ni altera el layout, y se retira al terminar", async () => {
    const { source } = setup();
    const selection = source.select("gallery");
    const input = picker();
    expect(input!.hidden).toBe(true);
    expect(input!.style.display).toBe("none");
    chooseFiles(input!, []);
    await selection;
    expect(document.body.children).toHaveLength(0);
  });
  it("pide la cámara trasera y un solo archivo cuando la fuente es la cámara", async () => {
    const { source } = setup();
    const selection = source.select("camera");
    const input = picker();
    expect(input!.getAttribute("capture")).toBe("environment");
    expect(input!.multiple).toBe(false);
    expect(input!.accept).toBe("image/jpeg,image/png,image/webp");
    chooseFiles(input!, [fileOf("c.webp", "image/webp")]);
    expect(await selection).toEqual({ ok: true, value: [{ reference: "blob:photo-1", previewUrl: "blob:photo-1", format: "image/webp" }] });
  });
  it("omite el formato cuando el navegador no informa el tipo del archivo", async () => {
    const { source } = setup();
    const selection = source.select("gallery");
    chooseFiles(picker()!, [fileOf("d.bin", "")]);
    expect(await selection).toEqual({ ok: true, value: [{ reference: "blob:photo-1", previewUrl: "blob:photo-1" }] });
  });
  it("informa cancelled con el evento cancel del selector, sin crear object urls", async () => {
    const { source, created } = setup();
    const selection = source.select("gallery");
    picker()!.dispatchEvent(new Event("cancel"));
    const result = await selection;
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toBeInstanceOf(NativeCapabilityError);
    expect(!result.ok && result.error.kind).toBe("cancelled");
    expect(created).toEqual([]);
    expect(picker()).toBeNull();
  });
  it("informa cancelled cuando el change llega sin archivos", async () => {
    const { source } = setup();
    const selection = source.select("gallery");
    chooseFiles(picker()!, []);
    const result = await selection;
    expect(!result.ok && result.error.kind).toBe("cancelled");
  });
  it("informa cancelled si el navegador no avisa y la página recupera el foco sin elección", async () => {
    vi.useFakeTimers();
    const { source } = setup();
    const selection = source.select("gallery");
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(1000);
    const result = await selection;
    expect(!result.ok && result.error.kind).toBe("cancelled");
    expect(picker()).toBeNull();
  });
  it("el regreso del foco no descarta una elección que llega enseguida", async () => {
    vi.useFakeTimers();
    const { source } = setup();
    const selection = source.select("gallery");
    const input = picker()!;
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(100);
    chooseFiles(input, [fileOf("e.jpg", "image/jpeg")]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await selection).toEqual({ ok: true, value: [{ reference: "blob:photo-1", previewUrl: "blob:photo-1", format: "image/jpeg" }] });
  });
});
