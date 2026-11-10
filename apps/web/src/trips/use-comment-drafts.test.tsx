// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommentDraftsProvider, useCommentDraft } from "./use-comment-drafts.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
function Probe({ name }: { name: string }) {
  const { text, setText, clear } = useCommentDraft(name);
  return <div data-probe={name}>
    <output>{text === undefined ? "none" : `[${text}]`}</output>
    <button type="button" data-action="set" onClick={() => setText(`texto ${name}`)}>set</button>
    <button type="button" data-action="empty" onClick={() => setText("")}>empty</button>
    <button type="button" data-action="clear" onClick={clear}>clear</button>
  </div>;
}
function Host({ names }: { names: string[] }) {
  const [visible, setVisible] = useState(true);
  return <CommentDraftsProvider>
    <button type="button" data-action="toggle" onClick={() => setVisible((value) => !value)}>toggle</button>
    {visible ? names.map((name) => <Probe key={name} name={name} />) : null}
  </CommentDraftsProvider>;
}
async function render(names: string[]) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<Host names={names} />));
  return container;
}
const click = async (container: HTMLElement, selector: string) => act(async () => { container.querySelector<HTMLElement>(selector)?.click(); });
const shown = (container: HTMLElement, name: string) => container.querySelector(`[data-probe="${name}"] output`)?.textContent;

describe("comment drafts context", () => {
  it("starts without a draft", async () => expect(shown(await render(["new:a"]), "new:a")).toBe("none"));
  it("sets and clears a draft by key", async () => {
    const container = await render(["new:a"]);
    await click(container, '[data-probe="new:a"] [data-action="set"]');
    expect(shown(container, "new:a")).toBe("[texto new:a]");
    await click(container, '[data-probe="new:a"] [data-action="clear"]');
    expect(shown(container, "new:a")).toBe("none");
  });
  it("keeps an empty text as a draft until it is cleared", async () => {
    const container = await render(["new:a"]);
    await click(container, '[data-probe="new:a"] [data-action="empty"]');
    expect(shown(container, "new:a")).toBe("[]");
  });
  it("keeps each key isolated", async () => {
    const container = await render(["new:a", "new:b", "edit:c"]);
    await click(container, '[data-probe="new:a"] [data-action="set"]');
    expect(shown(container, "new:b")).toBe("none"); expect(shown(container, "edit:c")).toBe("none");
    await click(container, '[data-probe="edit:c"] [data-action="set"]');
    await click(container, '[data-probe="new:a"] [data-action="clear"]');
    expect(shown(container, "new:a")).toBe("none"); expect(shown(container, "edit:c")).toBe("[texto edit:c]");
  });
  it("survives the remount of the child under the same provider", async () => {
    const container = await render(["new:a"]);
    await click(container, '[data-probe="new:a"] [data-action="set"]');
    await click(container, '[data-action="toggle"]');
    expect(container.querySelector('[data-probe="new:a"]')).toBeNull();
    await click(container, '[data-action="toggle"]');
    expect(shown(container, "new:a")).toBe("[texto new:a]");
  });
  it("fails clearly without a provider", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const container = document.createElement("div"); document.body.append(container);
    const uncaught: unknown[] = [];
    const root = createRoot(container, { onUncaughtError: (thrown) => { uncaught.push(thrown); } });
    roots.push(root);
    try {
      // Según el entorno, act puede rechazar o React reporta por onUncaughtError: se acepta ambos y se afirma sobre el error capturado.
      await act(async () => root.render(<Probe name="x" />));
    } catch (thrown) {
      uncaught.push(thrown);
    } finally {
      error.mockRestore();
    }
    expect(uncaught.length).toBeGreaterThan(0);
    for (const thrown of uncaught) {
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toBe("useCommentDraft requires a CommentDraftsProvider");
    }
  });
});
