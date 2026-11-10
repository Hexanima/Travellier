// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NativeCapabilityError, err, ok, type ExternalLinkPort } from "app-domain";
import { ExternalLinkContext } from "./external-link-context.js";
import { LocationPreview } from "./LocationPreview.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });

type OpenResult = Awaited<ReturnType<ExternalLinkPort["open"]>>;
const placeUrl = "https://www.google.com/maps/place/Torre+Eiffel/@48.85,2.29,17z";
async function render(value: string | null | undefined, port?: ExternalLinkPort, context: "activity" | "memory" | "composer" = "activity") {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  const show = async (next: string | null | undefined) => act(async () => root.render(
    <ExternalLinkContext.Provider value={port}><LocationPreview value={next} context={context} /></ExternalLinkContext.Provider>));
  await show(value);
  return { container, show };
}
const openButton = (container: Element) => container.querySelector("button") as HTMLButtonElement;
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; };
const failing = (kind: "native" | "unsupported" | "denied" | "cancelled") => vi.fn(async (): Promise<OpenResult> => err(new NativeCapabilityError(kind)));

describe("LocationPreview", () => {
  it.each([null, undefined, "", "   "])("renders nothing for an absent location (%j)", async (value) => {
    const { container } = await render(value, { open: vi.fn() });
    expect(container.innerHTML).toBe("");
    expect(container.querySelector("img, iframe, canvas, [role=img], button, a")).toBeNull();
  });

  it.each(["http://maps.google.com/x", "javascript:alert(1)", "https://evil.example/maps", "https://maps.google.com.evil.com"])("shows a discreet status for an invalid link (%s)", async (value) => {
    const { container } = await render(value, { open: vi.fn() });
    expect(container.querySelector("[role=status]")?.textContent).toBe("Vínculo de Maps no válido");
    expect(container.querySelector("[role=alert], button, a")).toBeNull();
    expect(container.querySelector("img, iframe, canvas")).toBeNull();
  });

  it("shows the place text and an accessible open button for a valid link", async () => {
    const { container } = await render(placeUrl, { open: vi.fn() });
    expect(container.textContent).toContain("Torre Eiffel");
    expect(openButton(container).textContent).toBe("Abrir en Maps");
    expect(openButton(container).getAttribute("aria-label")).toBe("Abrir en Maps: Torre Eiffel");
    expect(container.querySelector("[aria-hidden=true]")).not.toBeNull();
    expect(container.querySelector("img, iframe, canvas, [role=img], [role=alert]")).toBeNull();
  });

  it("falls back to the host when the link has no place", async () => {
    const { container } = await render("https://maps.google.com/", { open: vi.fn() });
    expect(openButton(container).getAttribute("aria-label")).toBe("Abrir en Maps: maps.google.com");
    expect(container.textContent).toContain("maps.google.com");
  });

  it("does not show coordinates and marks shorteners as open-only", async () => {
    const { container } = await render("https://maps.app.goo.gl/abc", { open: vi.fn() });
    expect(container.textContent).toContain("maps.app.goo.gl");
    expect(container.textContent).toContain("Enlace corto: se abre sin vista previa.");
    expect(container.textContent).not.toMatch(/\d+\.\d+/);
    const regular = await render("https://maps.google.com/?q=48.85,2.29", { open: vi.fn() });
    expect(regular.container.textContent).not.toContain("48.85");
    expect(regular.container.textContent).not.toContain("Enlace corto");
  });

  it("renders place text as text, never as markup", async () => {
    const { container } = await render("https://www.google.com/maps/place/%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E", { open: vi.fn() });
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("opens with one call carrying the normalized url", async () => {
    const open = vi.fn(async (): Promise<OpenResult> => ok(undefined));
    const { container } = await render("  https://MAPS.GOOGLE.COM/?q=Plaza  ", { open });
    await act(async () => openButton(container).click());
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith("https://maps.google.com/?q=Plaza");
    expect(container.querySelector("[role=alert]")).toBeNull();
    expect(openButton(container).getAttribute("aria-disabled")).toBeNull();
  });

  it("does not reenter while opening and keeps focus on the button", async () => {
    const pending = deferred<OpenResult>();
    const open = vi.fn(() => pending.promise);
    const { container } = await render(placeUrl, { open });
    const button = openButton(container); button.focus();
    await act(async () => { button.click(); button.click(); });
    expect(open).toHaveBeenCalledTimes(1);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.disabled).toBe(false);
    expect(document.activeElement).toBe(button);
    await act(async () => { pending.resolve(ok(undefined)); });
    expect(button.getAttribute("aria-disabled")).toBeNull();
    await act(async () => button.click());
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("treats a user cancellation as no error and re-enables the button", async () => {
    const { container } = await render(placeUrl, { open: failing("cancelled") });
    await act(async () => openButton(container).click());
    expect(container.querySelector("[role=alert], [role=status]")).toBeNull();
    expect(openButton(container).getAttribute("aria-disabled")).toBeNull();
  });

  it.each(["native", "unsupported", "denied"] as const)("shows a single recoverable alert on a %s error", async (kind) => {
    const open = failing(kind);
    const { container } = await render(placeUrl, { open });
    await act(async () => openButton(container).click());
    const alerts = container.querySelectorAll("[role=alert]");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.textContent).toBe("No pudimos abrir Maps. Probá de nuevo.");
    expect(openButton(container).getAttribute("aria-disabled")).toBeNull();
    await act(async () => openButton(container).click());
    expect(container.querySelectorAll("[role=alert]")).toHaveLength(1);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("treats a rejected promise as the same recoverable error", async () => {
    const open = vi.fn(async (): Promise<OpenResult> => { throw new Error("boom"); });
    const { container } = await render(placeUrl, { open });
    await act(async () => openButton(container).click());
    expect(container.querySelectorAll("[role=alert]")).toHaveLength(1);
  });

  it("clears the error when the link changes", async () => {
    const { container, show } = await render(placeUrl, { open: failing("native") });
    await act(async () => openButton(container).click());
    expect(container.querySelector("[role=alert]")).not.toBeNull();
    await show("https://maps.google.com/?q=Otro");
    expect(container.querySelector("[role=alert]")).toBeNull();
  });

  it("uses a safe anchor when there is no port", async () => {
    const { container } = await render(placeUrl, undefined);
    const anchor = container.querySelector("a") as HTMLAnchorElement;
    expect(container.querySelector("button")).toBeNull();
    expect(anchor.getAttribute("href")).toBe(placeUrl);
    expect(anchor.getAttribute("target")).toBe("_blank");
    expect(anchor.getAttribute("rel")).toBe("noopener noreferrer");
    expect(anchor.getAttribute("aria-label")).toBe("Abrir en Maps: Torre Eiffel");
    expect(anchor.textContent).toBe("Abrir en Maps");
  });

  it("does not render an anchor for an invalid link without a port", async () => {
    const { container } = await render("javascript:alert(1)", undefined);
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("[role=status]")).not.toBeNull();
  });
});
