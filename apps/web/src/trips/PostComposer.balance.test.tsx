// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation, useNavigate, type NavigateFunction } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PostComposer } from "./PostComposer.js";
import { ignoreRetryIds } from "./post-composer-test-api.js";
import { MemoriesLayout } from "./TripMemoriesScreen.js";
import { itineraryFixture, itineraryId } from "./itinerary-test-fixture.js";
import type { PostResponse } from "./trip-post-api.js";

// Defers «navigate(-1)» as BrowserRouter does (history.go is asynchronous) to reproduce the window before the popstate arrives.
const gate = vi.hoisted(() => ({ defer: false, back: [] as (() => void)[] }));
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => {
    const navigate = actual.useNavigate();
    return ((...args: unknown[]) => {
      if (gate.defer && args[0] === -1) gate.back.push(() => (navigate as (delta: number) => void)(-1));
      else (navigate as (...rest: unknown[]) => void)(...args);
    }) as NavigateFunction;
  } };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { gate.defer = false; gate.back.length = 0; await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
const tripId = itineraryId(1), postId = itineraryId(30), expenseId = itineraryId(40);
const balancePath = `/trips/${tripId}/balance`, editPath = `/trips/${tripId}/memories/${postId}/edit`;
const anchor = `data-balance-expense=${expenseId}`;
const origin = { path: balancePath, label: "balance", anchor, scrollY: 120 };
const saved = (extra: Partial<PostResponse> = {}): PostResponse => ({ id: postId, tripId, authorId: itineraryId(20), description: "Cena", mapsUrl: null,
  activityId: null, parentPostId: null, transportId: null, createdAt: "2026-01-02T15:30:00.000Z", ...extra });
function BalanceStub() { const location = useLocation(); return <p data-testid="balance">BALANCE {JSON.stringify(location.state)}</p>; }
function Listing() { const location = useLocation(); return <p data-testid="listing">LISTADO {JSON.stringify(location.state)}</p>; }
function Back() { const navigate = useNavigate(); return <button type="button" onClick={() => navigate(-1)}>atras</button>; }
function Forward() { const navigate = useNavigate(); return <button type="button" onClick={() => navigate(1)}>adelante</button>; }
type Entry = { pathname: string; search?: string; state?: unknown };
async function render(entries: Entry[], mocks: { update?: ReturnType<typeof vi.fn> } = {}) {
  const itinerary = { get: vi.fn().mockResolvedValue({ ok: true, value: itineraryFixture() }) };
  const update = mocks.update ?? vi.fn().mockResolvedValue({ ok: true, value: saved({ description: "Editado" }) });
  const get = vi.fn().mockResolvedValue({ ok: true, value: { post: saved(), parent: null, children: [], rootActivityId: null } });
  const composer = <PostComposer posts={ignoreRetryIds({ create: vi.fn(), update, get })} itinerary={itinerary} timeZone="America/Argentina/Buenos_Aires" />;
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={entries}><Back /><Forward /><Routes>
    <Route path="/trips/:tripId/balance" element={<BalanceStub />} />
    <Route path="/trips/:tripId/memories" element={<MemoriesLayout />}>
      <Route index element={<Listing />} /><Route path=":postId/edit" element={composer} />
    </Route></Routes></MemoryRouter>));
  return { container, update };
}
async function field(container: HTMLElement, name: string, value: string) {
  const element = container.querySelector(`[name="${name}"]`) as HTMLTextAreaElement;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); });
}
const submit = async (container: HTMLElement) => act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
const button = (container: ParentNode, label: string) => Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.trim() === label) as HTMLButtonElement | undefined;
const click = async (element: Element | undefined) => { expect(element).toBeDefined(); await act(async () => element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))); };
const balanceEntry: Entry = { pathname: balancePath, state: { restore: { anchor, scrollY: 120 } } };
const editEntry = (focus?: string): Entry => ({ pathname: editPath, state: { origin, ...(focus ? { focus } : {}) } });
const shown = (container: HTMLElement) => container.querySelector('[data-testid="balance"]')?.textContent ?? "";
const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement | null;
const forward = () => click(button(document.body, "adelante"));

describe("PostComposer opened from the balance (T85)", () => {
  it("puts the focus on «Pagos y reparto» when asked with focus split", async () => {
    const { container } = await render([balanceEntry, editEntry("split")]);
    expect(document.activeElement).toBe(container.querySelector('button[name="split"]'));
  });
  it("puts the focus on the currency button when asked with focus expense", async () => {
    const { container } = await render([balanceEntry, editEntry("expense")]);
    expect(document.activeElement).toBe(container.querySelector('button[name="expense"]'));
  });
  it("saving returns to the balance entry with one step back, keeping its restore state", async () => {
    const { container, update } = await render([balanceEntry, editEntry("split")]);
    await field(container, "description", "Editado"); await submit(container);
    expect(update).toHaveBeenCalledOnce();
    expect(shown(container)).toContain('"restore"');
    expect(container.querySelector('[data-testid="listing"]')).toBeNull();
    await forward();
    expect(container.querySelector('[name="description"]')).not.toBeNull(); // a step back, not a replace
  });
  it("saving from a deep link replaces the entry with the balance, marks that nothing is behind and keeps the place", async () => {
    const { container } = await render([editEntry("split")]);
    await field(container, "description", "Editado"); await submit(container);
    expect(shown(container)).toContain('"noBack":true');
    expect(shown(container)).toContain(`"restore":{"anchor":"${anchor}","scrollY":120}`);
    await forward();
    expect(container.querySelector('[name="description"]')).toBeNull();
  });
  it("a failed save stays in the editor", async () => {
    const update = vi.fn().mockResolvedValue({ ok: false, error: { kind: "network" } });
    const { container } = await render([balanceEntry, editEntry("split")], { update });
    await field(container, "description", "Editado"); await submit(container);
    expect(container.querySelector('[data-testid="balance"]')).toBeNull();
    expect(container.querySelector('[name="description"]')).not.toBeNull();
  });
  it("Cancelar without changes steps back to the balance", async () => {
    const { container } = await render([balanceEntry, editEntry()]);
    await click(button(container, "Cancelar"));
    expect(shown(container)).toContain('"restore"');
    await forward();
    expect(container.querySelector('[name="description"]')).not.toBeNull();
  });
  it("Cancelar without history replaces the entry with the balance", async () => {
    const { container } = await render([editEntry()]);
    await click(button(container, "Cancelar"));
    expect(shown(container)).toContain('"noBack":true');
  });
  it("Descartar without history replaces the entry with the balance", async () => {
    const { container } = await render([editEntry()]);
    await field(container, "description", "Borrador"); await click(button(container, "Cancelar"));
    await click(button(dialog()!, "Descartar"));
    expect(shown(container)).toContain('"noBack":true');
  });
  it("Descartar with history steps back once", async () => {
    const { container } = await render([balanceEntry, editEntry()]);
    await field(container, "description", "Borrador"); await click(button(container, "Cancelar"));
    await click(button(dialog()!, "Descartar"));
    expect(shown(container)).toContain('"restore"');
    await forward();
    expect(container.querySelector('[name="description"]')).not.toBeNull();
  });
  it("a double Cancelar while the step back is pending steps back only once", async () => {
    const { container } = await render([balanceEntry, editEntry()]);
    gate.defer = true;
    await act(async () => { const cancel = button(container, "Cancelar")!; cancel.click(); cancel.click(); });
    expect(gate.back).toHaveLength(1);
    await act(async () => { gate.back.splice(0).forEach((run) => run()); });
    expect(shown(container)).toContain('"restore"');
  });
  it("a double Descartar while the step back is pending steps back only once", async () => {
    const { container } = await render([balanceEntry, editEntry()]);
    await field(container, "description", "Borrador"); await click(button(container, "Cancelar"));
    gate.defer = true;
    await act(async () => { const discard = button(dialog()!, "Descartar")!; discard.click(); discard.click(); });
    expect(gate.back).toHaveLength(1);
  });

  describe("other origins are unchanged", () => {
    it("an edit without origin saves to the diary with the notice", async () => {
      const { container } = await render([{ pathname: editPath }]);
      await field(container, "description", "Editado"); await submit(container);
      expect(container.querySelector('[data-testid="listing"]')?.textContent).toContain('"notice":"updated"');
      expect(container.querySelector('[data-testid="balance"]')).toBeNull();
    });
    it("an edit with a diary origin cancels to the diary, not to the balance", async () => {
      const { container } = await render([balanceEntry, { pathname: editPath, state: { origin: { path: `/trips/${tripId}/memories`, label: "diario" } } }]);
      await click(button(container, "Cancelar"));
      expect(container.querySelector('[data-testid="listing"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="balance"]')).toBeNull();
    });
    it("a balance origin of another trip is ignored and falls back to the diary", async () => {
      const { container } = await render([{ pathname: editPath, state: { origin: { path: `/trips/${itineraryId(2)}/balance`, label: "balance" } } }]);
      await click(button(container, "Cancelar"));
      expect(container.querySelector('[data-testid="listing"]')).not.toBeNull();
    });
  });
});
