// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Tabs } from "./Tabs.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
const items = [{ id: "a", label: "Uno" }, { id: "b", label: "Dos" }, { id: "c", label: "Tres" }];

async function mount(onSelect = vi.fn(), initial = "a") {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  function Harness() {
    const [selected, setSelected] = useState(initial);
    return <Tabs idPrefix="t" label="Secciones" items={items} selected={selected} onSelect={(id) => { onSelect(id); setSelected(id); }}><p>contenido {selected}</p></Tabs>;
  }
  await act(async () => root.render(<Harness />));
  return container;
}
const tabs = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>("[role=tab]")];
const key = (el: HTMLElement, name: string) => act(async () => { el.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })); });

describe("Tabs", () => {
  it("exposes tablist, tabs and one tabpanel wired to the selected tab", async () => {
    const c = await mount(vi.fn(), "b");
    const list = c.querySelector("[role=tablist]")!;
    expect(list.getAttribute("aria-label")).toBe("Secciones");
    expect(tabs(c).map((t) => t.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
    expect(tabs(c).map((t) => t.tabIndex)).toEqual([-1, 0, -1]);
    const panel = c.querySelector("[role=tabpanel]")!;
    expect(panel.getAttribute("aria-labelledby")).toBe(tabs(c)[1]!.id);
    expect(tabs(c).every((t) => t.getAttribute("aria-controls") === panel.id)).toBe(true);
    expect(panel.textContent).toBe("contenido b");
  });
  it("selects on click, Enter and Space (native button)", async () => {
    const onSelect = vi.fn();
    const c = await mount(onSelect);
    await act(async () => tabs(c)[2]!.click());
    expect(onSelect).toHaveBeenLastCalledWith("c");
    expect(tabs(c)[2]!.getAttribute("aria-selected")).toBe("true");
  });
  it("moves with arrows, Home and End, wrapping around, and moves focus", async () => {
    const onSelect = vi.fn();
    const c = await mount(onSelect);
    tabs(c)[0]!.focus();
    await key(tabs(c)[0]!, "ArrowLeft");
    expect(onSelect).toHaveBeenLastCalledWith("c"); expect(document.activeElement).toBe(tabs(c)[2]);
    await key(tabs(c)[2]!, "ArrowRight");
    expect(onSelect).toHaveBeenLastCalledWith("a"); expect(document.activeElement).toBe(tabs(c)[0]);
    await key(tabs(c)[0]!, "End");
    expect(onSelect).toHaveBeenLastCalledWith("c");
    await key(tabs(c)[2]!, "Home");
    expect(onSelect).toHaveBeenLastCalledWith("a");
    await key(tabs(c)[0]!, "ArrowDown");
    expect(onSelect).toHaveBeenCalledTimes(4); // other keys do nothing
  });
  it("keeps the same tab nodes when the selection changes", async () => {
    const c = await mount();
    const before = tabs(c);
    await act(async () => tabs(c)[1]!.click());
    expect(tabs(c)).toEqual(before);
  });
});
