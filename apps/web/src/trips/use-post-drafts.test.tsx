// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { PostDraft } from "./post-draft.js";
import { PostDraftsProvider, useHasPostDrafts, usePostDraft } from "./use-post-drafts.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
const draft = (description: string): PostDraft => ({ values: { description, mapsUrl: "" }, extras: { link: null, transportId: null, newActivity: null, photos: [], expense: null, split: { payments: null, shares: null }, removePhotoIds: [], removeExpense: false } });
function Probe({ name }: { name: string }) {
  const handle = usePostDraft(name);
  return <div data-probe={name}>
    <output>{handle.draft ? handle.draft.values.description : "none"}</output>
    <button type="button" data-action="set" onClick={() => handle.setDraft(draft(`texto ${name}`))}>set</button>
    <button type="button" data-action="clear" onClick={handle.clear}>clear</button>
    <span data-returned>{handle.returned ? `${handle.returned.focus}|${handle.returned.notice}` : "none"}</span>
    <button type="button" data-action="return" onClick={() => handle.setReturned({ focus: "link", notice: `aviso ${name}` })}>return</button>
    <button type="button" data-action="clear-return" onClick={handle.clearReturned}>clear-return</button>
    <button type="button" data-action="blob" onClick={() => handle.blobs.set(`foto-${name}`, new Blob([name]))}>blob</button>
    <span data-blobs>{handle.blobs.ids().join(",") || "none"}</span>
  </div>;
}
function Host({ names }: { names: string[] }) {
  const [visible, setVisible] = useState(true);
  return <PostDraftsProvider>
    <button type="button" data-action="toggle" onClick={() => setVisible((value) => !value)}>toggle</button>
    {visible ? names.map((name) => <Probe key={name} name={name} />) : null}
  </PostDraftsProvider>;
}
async function render(names: string[]) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<Host names={names} />));
  return container;
}
const click = async (container: HTMLElement, selector: string) => act(async () => { container.querySelector<HTMLElement>(selector)?.click(); });
const shown = (container: HTMLElement, name: string) => container.querySelector(`[data-probe="${name}"] output`)?.textContent;

describe("post drafts context", () => {
  it("starts without a draft", async () => expect(shown(await render(["new"]), "new")).toBe("none"));
  it("keeps the selector return signal per key until it is cleared, apart from the draft", async () => {
    const container = await render(["new", "edit:a"]);
    const returned = (name: string) => container.querySelector(`[data-probe="${name}"] [data-returned]`)?.textContent;
    expect(returned("new")).toBe("none");
    await click(container, '[data-probe="new"] [data-action="return"]');
    expect(returned("new")).toBe("link|aviso new"); expect(returned("edit:a")).toBe("none");
    await click(container, '[data-probe="new"] [data-action="clear"]');
    expect(returned("new")).toBe("link|aviso new");
    await click(container, '[data-probe="new"] [data-action="clear-return"]');
    expect(returned("new")).toBe("none");
  });
  it("keeps the draft when the composer unmounts and mounts again inside the same provider", async () => {
    const container = await render(["new"]);
    await click(container, '[data-probe="new"] [data-action="set"]');
    expect(shown(container, "new")).toBe("texto new");
    await click(container, '[data-action="toggle"]'); expect(container.querySelector("[data-probe]")).toBeNull();
    await click(container, '[data-action="toggle"]'); expect(shown(container, "new")).toBe("texto new");
  });
  it("discards the draft with clear", async () => {
    const container = await render(["new"]);
    await click(container, '[data-probe="new"] [data-action="set"]');
    expect(shown(container, "new")).toBe("texto new");
    await click(container, '[data-probe="new"] [data-action="clear"]');
    expect(shown(container, "new")).toBe("none");
  });
  it("does not share drafts between the new key and each edit key", async () => {
    const container = await render(["new", "edit:a", "edit:b"]);
    await click(container, '[data-probe="edit:a"] [data-action="set"]');
    expect(shown(container, "edit:a")).toBe("texto edit:a");
    expect(shown(container, "new")).toBe("none"); expect(shown(container, "edit:b")).toBe("none");
    await click(container, '[data-probe="new"] [data-action="set"]');
    await click(container, '[data-probe="new"] [data-action="clear"]');
    expect(shown(container, "edit:a")).toBe("texto edit:a");
  });
  it("keeps the binaries per key across unmount and remount and empties them with clear, without touching other keys", async () => {
    const container = await render(["new", "edit:a"]);
    const blobs = (name: string) => container.querySelector(`[data-probe="${name}"] [data-blobs]`)?.textContent;
    await click(container, "[data-probe=\"new\"] [data-action=\"blob\"]");
    await click(container, "[data-probe=\"edit:a\"] [data-action=\"blob\"]");
    await click(container, "[data-action=\"toggle\"]"); await click(container, "[data-action=\"toggle\"]");
    expect(blobs("new")).toBe("foto-new"); expect(blobs("edit:a")).toBe("foto-edit:a");
    await click(container, "[data-probe=\"new\"] [data-action=\"clear\"]");
    await click(container, "[data-action=\"toggle\"]"); await click(container, "[data-action=\"toggle\"]");
    expect(blobs("new")).toBe("none");
    expect(blobs("edit:a")).toBe("foto-edit:a");
  });
});

describe("useHasPostDrafts", () => {
  function Has() { return <output>{String(useHasPostDrafts())}</output>; }
  const mount = async (element: React.ReactNode) => {
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container); roots.push(root);
    await act(async () => root.render(element));
    return container.querySelector("output")?.textContent;
  };
  it("is false without a provider and true under one", async () => {
    expect(await mount(<Has />)).toBe("false");
    expect(await mount(<PostDraftsProvider><Has /></PostDraftsProvider>)).toBe("true");
  });
});
