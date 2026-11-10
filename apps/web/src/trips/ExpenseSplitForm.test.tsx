// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExpenseSplitForm } from "./ExpenseSplitForm.js";
import { MemoriesLayout } from "./TripMemoriesScreen.js";
import { itineraryId } from "./itinerary-test-fixture.js";
import type { ExpenseDraft } from "./expense-draft.js";
import type { PostDraft } from "./post-draft.js";
import type { SplitDraft } from "./expense-split.js";
import type { SavedExpenseView } from "./trip-post-api.js";
import { usePostDraft } from "./use-post-drafts.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
const tripId = itineraryId(1), postId = itineraryId(5);
const [me, beto, caro, dani] = [itineraryId(30), itineraryId(31), itineraryId(32), itineraryId(33)];
const newPath = `/trips/${tripId}/memories/new`, editPath = `/trips/${tripId}/memories/${postId}/edit`;
const filled: ExpenseDraft = { amount: "100", currency: "ARS", breakdown: "" };
const seeded = (expense: ExpenseDraft | null = filled, split: SplitDraft = { payments: null, shares: null }): PostDraft =>
  ({ values: { description: "Texto tipeado", mapsUrl: "" }, extras: { link: null, transportId: null, newActivity: null, photos: [], expense, split } });
let seed: PostDraft = seeded();
const members = (ids: string[] = [me, beto, caro]) => ({ ok: true, value: { currentUserId: me,
  members: ids.map((userId, index) => ({ id: itineraryId(100 + index), userId, name: ["Ana", "Beto", "Caro", "Dani"][index] ?? null, role: "participant", joinedAt: "2026-01-01T00:00:00.000Z" })) } });
const view = (extra: Partial<SavedExpenseView> = {}): SavedExpenseView => ({ postId, totalAmount: 100, currency: "ARS", breakdown: null, payments: [], shares: [],
  completeness: { status: "incomplete", reasons: [] }, formerMemberIds: [], ...extra });
const detail = (expense?: SavedExpenseView) => ({ ok: true, value: { post: { id: postId }, parent: null, children: [], rootActivityId: null, ...(expense ? { expense } : {}) } });

function Probe() {
  const { postId: id } = useParams(); const handle = usePostDraft(id ? `edit:${id}` : "new");
  const location = useLocation(); const navigate = useNavigate();
  return <div>
    <p data-testid="probe">{JSON.stringify({ draft: handle.draft ?? null, state: location.state, path: location.pathname, returned: handle.returned ?? null })}</p>
    <button type="button" onClick={() => handle.setDraft(seed)}>sembrar</button>
    <button type="button" onClick={() => navigate(`${location.pathname}/expense/split`, { state: { fromComposer: true } })}>ir</button>
    <button type="button" onClick={() => navigate(`${location.pathname}/expense/split`, { state: { fromComposer: true,
      rowErrors: { [seed.extras.split.shares?.[0]?.key ?? "x"]: "Esta persona no es válida." }, listErrors: {} } })}>ir con errores</button>
    <button type="button" onClick={() => navigate(`${location.pathname}/expense/split`, { state: { fromComposer: true, rowErrors: {}, listErrors: { payments: "x" } } })}>ir con error de lista</button>
    <button type="button" onClick={() => navigate(`${location.pathname}/expense/split`, { state: { fromComposer: true, rowErrors: {}, listErrors: { payments: "Error de pagos.", shares: "Error de reparto." } } })}>ir con errores de listas</button>
  </div>;
}
type Probed = { draft: PostDraft | null; state: { focus?: string } | null; path: string; returned: { focus?: string } | null };
const probe = (container: HTMLElement) => JSON.parse(container.querySelector('[data-testid="probe"]')!.textContent!) as Probed;
type Deps = { get: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn> };
async function render(path: string, deps: Deps) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  const form = <ExpenseSplitForm posts={{ get: deps.get }} members={{ list: deps.list }} />;
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/trips/:tripId/memories" element={<MemoriesLayout />}>
      <Route path="new" element={<Probe />} /><Route path="new/expense/split" element={form} />
      <Route path=":postId/edit" element={<Probe />} /><Route path=":postId/edit/expense/split" element={form} />
    </Route></Routes></MemoryRouter>));
  return container;
}
const button = (container: ParentNode, label: string) => Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.trim() === label) as HTMLButtonElement | undefined;
const click = async (element: Element | undefined | null) => { expect(element).toBeTruthy(); await act(async () => element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))); };
const type = async (element: HTMLInputElement, value: string) => {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); });
};
const choose = async (element: HTMLSelectElement, value: string) => {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("change", { bubbles: true })); });
};
const rows = (container: ParentNode, section: "payments" | "shares") => Array.from(container.querySelectorAll<HTMLElement>(`[data-section="${section}"] [data-row]`));
const unitOf = (row: HTMLElement) => row.querySelector<HTMLSelectElement>("select")!;
const valueOf = (row: HTMLElement) => row.querySelector<HTMLInputElement>('input[inputmode="decimal"]')!;
async function open(options: { path?: string; draft?: PostDraft; saved?: SavedExpenseView; ids?: string[]; direct?: boolean; get?: ReturnType<typeof vi.fn>; list?: ReturnType<typeof vi.fn>; action?: string } = {}) {
  const path = options.path ?? newPath;
  seed = options.draft ?? seeded();
  const deps = { get: options.get ?? vi.fn().mockResolvedValue(detail(options.saved)), list: options.list ?? vi.fn().mockResolvedValue(members(options.ids)) };
  const container = await render(path, deps);
  await click(button(container, "sembrar")); await click(button(container, options.action ?? "ir"));
  return { container, deps };
}

describe("ExpenseSplitForm", () => {
  it("redirects to the composer when there is no draft", async () => {
    const container = await render(`${newPath}/expense/split`, { get: vi.fn(), list: vi.fn() });
    expect(container.querySelector('[data-testid="probe"]')).not.toBeNull();
    expect(container.querySelector("[data-section]")).toBeNull();
  });

  it("is blocked until amount and currency exist, without an editor", async () => {
    const { container } = await open({ draft: seeded(null) });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Cargá primero importe y moneda del gasto");
    expect(container.querySelector("[data-section]")).toBeNull();
    await click(button(container, "Cancelar"));
    expect(probe(container).path).toBe(newPath);
  });

  it("creating proposes a remainder row per current member, never a payer, with an unconfirmed banner, and persists nothing on Cancel", async () => {
    const { container, deps } = await open();
    expect(document.activeElement).toBe(container.querySelector("h1"));
    expect(deps.get).not.toHaveBeenCalled();
    expect(rows(container, "payments")).toHaveLength(0);
    const shares = rows(container, "shares");
    expect(shares).toHaveLength(3);
    expect(shares.map((row) => unitOf(row).value)).toEqual(["remainder", "remainder", "remainder"]);
    expect(container.textContent).toContain("Propuesta sin confirmar: el resto se reparte en partes iguales entre los integrantes");
    await click(button(container, "Cancelar"));
    const result = probe(container);
    expect(result.draft?.extras.split).toEqual({ payments: null, shares: null });
    expect(result.returned).toEqual({ focus: "split" });
  });

  it("Accept confirms the proposal in the draft only (no network write) and returns to the composer", async () => {
    const { container } = await open();
    await click(button(container, "Aceptar"));
    const result = probe(container);
    expect(result.path).toBe(newPath);
    expect(result.draft?.extras.split.payments).toBeNull();
    expect(result.draft?.extras.split.shares?.map((row) => [row.userId, row.unit])).toEqual([[me, "remainder"], [beto, "remainder"], [caro, "remainder"]]);
    expect(result.draft?.extras.expense).toEqual(filled);
    expect(result.draft?.values).toEqual(seeded().values);
  });

  it("shows the current member names and «Vos» for me, and the remainder amount of each person", async () => {
    const { container } = await open();
    expect(container.textContent).toContain("Vos");
    expect(container.textContent).toContain("Beto");
    expect(container.textContent).toMatch(/ARS 33,34/);
  });

  it("payments and shares are independent: editing one does not touch the other", async () => {
    const { container } = await open();
    await choose(container.querySelector<HTMLSelectElement>('select[name="payments-add"]')!, beto);
    await click(button(container, "Agregar pago"));
    const [payment] = rows(container, "payments");
    await type(valueOf(payment!), "40");
    await click(button(container, "Aceptar"));
    const split = probe(container).draft!.extras.split;
    expect(split.payments).toHaveLength(1);
    expect(split.payments![0]).toMatchObject({ userId: beto, unit: "amount", value: "40" });
    expect(split.shares).toHaveLength(3);
  });

  it("an incomplete split shows what is missing and can be accepted", async () => {
    const { container } = await open();
    await choose(container.querySelector<HTMLSelectElement>('select[name="payments-add"]')!, me);
    await click(button(container, "Agregar pago"));
    await type(valueOf(rows(container, "payments")[0]!), "40");
    expect(container.textContent).toContain("Faltan ARS 60,00");
    await click(button(container, "Aceptar"));
    expect(probe(container).path).toBe(newPath);
    expect(probe(container).draft?.extras.split.payments).toHaveLength(1);
  });

  it("an invalid split (excess) is blocked: one alert, the first bad field focused, nothing written", async () => {
    const { container } = await open();
    await choose(unitOf(rows(container, "shares")[0]!), "percent");
    await type(valueOf(rows(container, "shares")[0]!), "150");
    await click(button(container, "Aceptar"));
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(container.querySelector("[aria-live]")).toBeNull();
    expect(document.activeElement).toBe(valueOf(rows(container, "shares")[0]!));
    expect(valueOf(rows(container, "shares")[0]!).getAttribute("aria-invalid")).toBe("true");
    expect(container.querySelector("[data-section]")).not.toBeNull();
    await click(button(container, "Cancelar"));
    expect(probe(container).draft?.extras.split).toEqual({ payments: null, shares: null });
  });

  it("rejects more than two decimals and a non-numeric value with a row error", async () => {
    const { container } = await open();
    await choose(unitOf(rows(container, "shares")[0]!), "amount");
    await type(valueOf(rows(container, "shares")[0]!), "1,234");
    await click(button(container, "Aceptar"));
    expect(container.textContent).toContain("hasta 2 decimales");
    expect(container.querySelector("[data-section]")).not.toBeNull();
  });

  it("fixed amounts exceeding the total block with «Sobran»", async () => {
    const { container } = await open();
    await choose(unitOf(rows(container, "shares")[0]!), "amount");
    await type(valueOf(rows(container, "shares")[0]!), "130");
    expect(container.textContent).toContain("Sobran ARS 30,00");
    await click(button(container, "Aceptar"));
    expect(container.querySelector("[data-section]")).not.toBeNull();
  });

  it("a saved split is not proposed over; members without a row are listed and can be included explicitly, never duplicated", async () => {
    const saved = view({ shares: [{ userId: me, unit: "percent", value: 50 }] });
    const { container } = await open({ path: editPath, saved, draft: seeded(null) });
    expect(container.textContent).not.toContain("Propuesta sin confirmar");
    expect(rows(container, "shares")).toHaveLength(1);
    expect(container.textContent).toContain("Integrantes sin parte");
    await click(button(container, "Incluir a Beto"));
    expect(rows(container, "shares")).toHaveLength(2);
    expect(unitOf(rows(container, "shares")[1]!).value).toBe("remainder");
    expect(button(container, "Incluir a Beto")).toBeUndefined();
    await click(button(container, "Incluir a todos"));
    expect(rows(container, "shares")).toHaveLength(3);
    expect(button(container, "Incluir a todos")?.getAttribute("aria-disabled")).toBe("true");
    await click(button(container, "Incluir a todos"));
    expect(rows(container, "shares")).toHaveLength(3);
  });

  it("an untouched saved split stores nothing in the draft (so nothing is sent)", async () => {
    const saved = view({ payments: [{ userId: me, unit: "amount", value: 40 }], shares: [{ userId: me, unit: "remainder", value: null }] });
    const { container, deps } = await open({ path: editPath, saved, draft: seeded(null) });
    expect(deps.get).toHaveBeenCalledWith(tripId, postId);
    await click(button(container, "Aceptar"));
    expect(probe(container).path).toBe(editPath);
    expect(probe(container).draft?.extras.split).toEqual({ payments: null, shares: null });
  });

  it("a former member is labelled, cannot be removed, and can be edited or set to «No participa»", async () => {
    const saved = view({ payments: [{ userId: dani, unit: "amount", value: 10 }], shares: [{ userId: dani, unit: "amount", value: 10 }, { userId: me, unit: "remainder", value: null }] });
    const { container } = await open({ path: editPath, saved, draft: seeded(null), ids: [me, beto] });
    const payment = rows(container, "payments")[0]!, formerShare = rows(container, "shares")[0]!;
    expect(payment.textContent).toContain("Ex integrante 1");
    expect(formerShare.textContent).toContain("Ex integrante 1");
    expect(payment.querySelector("button")).toBeNull();
    expect(formerShare.querySelector("button")).toBeNull();
    expect(rows(container, "shares")[1]!.querySelector("button")).not.toBeNull();
    await type(valueOf(payment), "0");
    await choose(unitOf(formerShare), "excluded");
    await click(button(container, "Aceptar"));
    const split = probe(container).draft!.extras.split;
    expect(split.payments![0]).toMatchObject({ userId: dani, value: "0" });
    expect(split.shares![0]).toMatchObject({ userId: dani, unit: "excluded" });
    expect(split.shares).toHaveLength(2);
  });

  it("includes new members without removing the former members already there", async () => {
    const saved = view({ shares: [{ userId: dani, unit: "amount", value: 10 }] });
    const { container } = await open({ path: editPath, saved, draft: seeded(null), ids: [me, beto] });
    await click(button(container, "Incluir a todos"));
    expect(rows(container, "shares").map((row) => row.textContent?.includes("Ex integrante 1"))).toEqual([true, false, false]);
  });

  it("allows several payments by the same person and rejects a repeated person in the shares", async () => {
    const { container } = await open();
    for (let index = 0; index < 2; index += 1) {
      await choose(container.querySelector<HTMLSelectElement>('select[name="payments-add"]')!, me);
      await click(button(container, "Agregar pago"));
    }
    await type(valueOf(rows(container, "payments")[0]!), "10"); await type(valueOf(rows(container, "payments")[1]!), "20");
    await click(button(container, "Aceptar"));
    expect(probe(container).draft?.extras.split.payments).toHaveLength(2);
  });

  it("a duplicated person in the shares is a row error", async () => {
    const dup = { payments: null, shares: [{ key: "n1", userId: me, unit: "remainder" as const, value: "" }, { key: "n2", userId: me, unit: "remainder" as const, value: "" }] };
    const { container } = await open({ draft: seeded(filled, dup) });
    await click(button(container, "Aceptar"));
    expect(container.textContent).toContain("ya tiene una parte");
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
  });

  it("removes a row of a current member and moves the focus to the add control", async () => {
    const { container } = await open();
    await click(rows(container, "shares")[0]!.querySelector("button"));
    expect(rows(container, "shares")).toHaveLength(2);
    expect(container.textContent).toContain("Integrantes sin parte");
  });

  it("removing a share moves the focus to the next row, then the previous one, then the section heading", async () => {
    const { container } = await open();
    const removeAt = (index: number) => click(rows(container, "shares")[index]!.querySelector("button"));
    await removeAt(0);
    expect(rows(container, "shares")[0]!.contains(document.activeElement)).toBe(true);
    await removeAt(1);
    expect(rows(container, "shares")).toHaveLength(1);
    expect(rows(container, "shares")[0]!.contains(document.activeElement)).toBe(true);
    await removeAt(0);
    expect(rows(container, "shares")).toHaveLength(0);
    expect(document.activeElement).toBe(container.querySelector("#split-shares-title"));
  });

  it("removing the only payment moves the focus to its own «Agregar pago»", async () => {
    const saved = view({ payments: [{ userId: me, unit: "percent", value: 100 }] });
    const { container } = await open({ path: editPath, saved, draft: seeded(null) });
    await click(rows(container, "payments")[0]!.querySelector("button"));
    expect(rows(container, "payments")).toHaveLength(0);
    expect(document.activeElement).toBe(button(container, "Agregar pago"));
  });

  it("including a member keeps the focus inside the list: next «Incluir…», then the section heading", async () => {
    const saved = view({ shares: [{ userId: me, unit: "percent", value: 50 }] });
    const { container } = await open({ path: editPath, saved, draft: seeded(null) });
    await click(button(container, "Incluir a Beto"));
    expect(document.activeElement).toBe(button(container, "Incluir a Caro"));
    await click(button(container, "Incluir a Caro"));
    expect(document.activeElement).toBe(container.querySelector("#split-shares-title"));
  });

  it("a server error only on a list moves the focus to the alert", async () => {
    const { container } = await open({ action: "ir con error de lista" });
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(document.activeElement).toBe(container.querySelector('[role="alert"]'));
  });

  describe("list errors from the server", () => {
    const stored = () => view({ payments: [{ userId: me, unit: "amount", value: 10 }], shares: [{ userId: me, unit: "amount", value: 10 }, { userId: beto, unit: "remainder", value: null }] });
    const openLists = () => open({ path: editPath, saved: stored(), draft: seeded(null), action: "ir con errores de listas" });
    const alertsIn = (container: HTMLElement) => container.querySelectorAll('[role="alert"]');

    it("editing a payment clears the payments notice, keeps the shares one and a single alert", async () => {
      const { container } = await openLists();
      expect(container.textContent).toContain("Error de pagos.");
      expect(container.textContent).toContain("Error de reparto.");
      await type(valueOf(rows(container, "payments")[0]!), "8");
      expect(container.textContent).not.toContain("Error de pagos.");
      expect(container.textContent).toContain("Error de reparto.");
      expect(alertsIn(container)).toHaveLength(1);
    });

    it("the general alert goes away once no server error is left, and the summary no longer contradicts", async () => {
      const { container } = await openLists();
      await type(valueOf(rows(container, "payments")[0]!), "8");
      await type(valueOf(rows(container, "shares")[0]!), "8");
      expect(alertsIn(container)).toHaveLength(0);
      expect(container.textContent).not.toContain("Error de");
    });

    it("removing a payment or including a member also clears the notice of its section", async () => {
      const { container } = await openLists();
      await click(rows(container, "payments")[0]!.querySelector("button"));
      expect(container.textContent).not.toContain("Error de pagos.");
      expect(container.textContent).toContain("Error de reparto.");
      await click(button(container, "Incluir a Caro"));
      expect(container.textContent).not.toContain("Error de reparto.");
      expect(alertsIn(container)).toHaveLength(0);
    });

    it("adding a payment clears the payments notice", async () => {
      const { container } = await openLists();
      await choose(container.querySelector('select[name="payments-add"]') as HTMLSelectElement, beto);
      await click(button(container, "Agregar pago"));
      expect(container.textContent).not.toContain("Error de pagos.");
      expect(container.textContent).toContain("Error de reparto.");
    });
  });

  it("an expense detail that could not be read shows the retry state, and recovers", async () => {
    const unreadable = { ok: true, value: { post: { id: postId }, parent: null, children: [], rootActivityId: null, expenseUnreadable: true } };
    const get = vi.fn().mockResolvedValueOnce(unreadable).mockResolvedValue(detail(view()));
    const { container } = await open({ path: editPath, get, draft: seeded(null) });
    expect(container.querySelector("[data-section]")).toBeNull();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    await click(button(container, "Reintentar"));
    expect(container.querySelector("[data-section]")).not.toBeNull();
  });

  it("shows server row errors with the focus on the first one and a single alert", async () => {
    const split = { payments: null, shares: [{ key: "k1", userId: me, unit: "remainder" as const, value: "" }, { key: "k2", userId: beto, unit: "remainder" as const, value: "" }] };
    const { container } = await open({ draft: seeded(filled, split), action: "ir con errores" });
    expect(container.textContent).toContain("Esta persona no es válida.");
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(rows(container, "shares")[0]!.contains(document.activeElement)).toBe(true);
  });

  it("shows a retry without editor when the expense cannot be read, and recovers", async () => {
    const get = vi.fn().mockResolvedValueOnce({ ok: false, error: { kind: "network" } }).mockResolvedValue(detail(view()));
    const { container } = await open({ path: editPath, get, draft: seeded(null) });
    expect(container.querySelector("[data-section]")).toBeNull();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    await click(button(container, "Reintentar"));
    expect(container.querySelector("[data-section]")).not.toBeNull();
  });

  it("shows a retry without editor when the members cannot be read", async () => {
    const list = vi.fn().mockResolvedValueOnce({ ok: false, error: { kind: "network" } }).mockResolvedValue(members());
    const { container } = await open({ list });
    expect(container.querySelector("[data-section]")).toBeNull();
    await click(button(container, "Reintentar"));
    expect(container.querySelector("[data-section]")).not.toBeNull();
  });

  it("a double tap on Accept leaves only once", async () => {
    const { container } = await open();
    const accept = button(container, "Aceptar")!;
    await act(async () => {
      accept.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      accept.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(probe(container).path).toBe(newPath);
  });

  it("explains that percentages follow the total and fixed amounts do not change", async () => {
    const { container } = await open();
    await choose(unitOf(rows(container, "shares")[0]!), "percent");
    expect(container.textContent).toContain("Los porcentajes se recalculan sobre el total mostrado; los montos fijos no cambian");
  });
});
