// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExpenseForm } from "./ExpenseForm.js";
import { ExpenseSplitForm } from "./ExpenseSplitForm.js";
import { PostComposer } from "./PostComposer.js";
import { ignoreRetryIds } from "./post-composer-test-api.js";
import { PostLinkPicker } from "./PostLinkPicker.js";
import { SpontaneousActivityForm } from "./SpontaneousActivityForm.js";
import { MemoriesLayout } from "./TripMemoriesScreen.js";
import { itineraryFixture, itineraryId } from "./itinerary-test-fixture.js";
import type { PostResponse, SavedExpenseView } from "./trip-post-api.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { vi.useRealTimers(); await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
const zone = "America/Argentina/Buenos_Aires";
const tripId = itineraryId(1), withExpenseId = itineraryId(10), withoutExpenseId = itineraryId(11);
const saved = (id: string, extra: Partial<PostResponse> = {}): PostResponse => ({ id, tripId, authorId: itineraryId(20), description: "Atardecer", mapsUrl: null,
  activityId: null, parentPostId: null, transportId: null, createdAt: "2026-09-25T13:00:00.123Z", ...extra });
function Listing() { const location = useLocation(); return <p data-testid="listing">LISTADO {JSON.stringify(location.state)}</p>; }
type Mocks = Partial<Record<"create" | "update" | "itineraryGet" | "get", ReturnType<typeof vi.fn>>> & { storedExpense?: SavedExpenseView };
const [me, beto, dani] = [itineraryId(30), itineraryId(31), itineraryId(33)];
const membersList = vi.fn().mockResolvedValue({ ok: true, value: { currentUserId: me, members: [{ id: itineraryId(100), userId: me, name: "Ana", role: "admin", joinedAt: "2026-01-01T00:00:00.000Z" },
  { id: itineraryId(101), userId: beto, name: "Beto", role: "participant", joinedAt: "2026-01-01T00:00:00.000Z" }] } });
async function render(path: string, mocks: Mocks = {}) {
  const itineraryGet = mocks.itineraryGet ?? vi.fn().mockResolvedValue({ ok: true, value: itineraryFixture() });
  const itinerary = { get: itineraryGet };
  const create = mocks.create ?? vi.fn().mockResolvedValue({ ok: true, value: saved(itineraryId(60)) });
  const update = mocks.update ?? vi.fn().mockResolvedValue({ ok: true, value: saved(withExpenseId) });
  const get = mocks.get ?? vi.fn().mockImplementation(async (_trip: string, id: string) => ({ ok: true, value: { post: saved(id), parent: null, children: [], rootActivityId: null,
    ...(mocks.storedExpense ? { expense: mocks.storedExpense } : {}) } }));
  const composer = <PostComposer posts={ignoreRetryIds({ create, update, get })} itinerary={itinerary} timeZone={zone} />;
  const expenseForm = <ExpenseForm itinerary={itinerary} />;
  const splitForm = <ExpenseSplitForm posts={{ get }} members={{ list: membersList }} />;
  const picker = <PostLinkPicker posts={{ list: vi.fn().mockResolvedValue({ ok: true, value: [] }), get: vi.fn() }} itinerary={itinerary} timeZone={zone} spontaneousActivity />;
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}>
    <nav><Link to={`/trips/${tripId}/memories/new/activity`}>nav-activity</Link></nav><Routes>
    <Route path="/trips/:tripId/memories" element={<MemoriesLayout />}>
      <Route index element={<Listing />} />
      <Route path="new" element={composer} /><Route path=":postId/edit" element={composer} />
      <Route path="new/link" element={picker} /><Route path=":postId/edit/link" element={picker} />
      <Route path="new/expense" element={expenseForm} /><Route path=":postId/edit/expense" element={expenseForm} />
      <Route path="new/expense/split" element={splitForm} /><Route path=":postId/edit/expense/split" element={splitForm} />
      <Route path="new/activity" element={<SpontaneousActivityForm itinerary={itinerary} timeZone={zone} />} />
    </Route></Routes></MemoryRouter>));
  return { container, create, update, itineraryGet, get };
}
async function type(container: HTMLElement, name: string, value: string) {
  const element = container.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLTextAreaElement;
  expect(element, `Field ${name}`).not.toBeNull();
  const proto = element.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); });
}
const choose = async (container: HTMLElement, value: string) => {
  const element = container.querySelector('select[name="currency"]') as HTMLSelectElement;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("change", { bubbles: true })); });
};
const submit = async (container: HTMLElement) => act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
const button = (container: ParentNode, label: string) => Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.trim() === label) as HTMLButtonElement | undefined;
const click = async (element: Element | undefined | null) => { expect(element).toBeTruthy(); await act(async () => element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))); };
const expenseButton = (container: HTMLElement) => container.querySelector('button[name="expense"]') as HTMLButtonElement;
const alerts = (container: HTMLElement) => Array.from(container.querySelectorAll('[role="alert"]')).map((item) => item.textContent);
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
const newPath = `/trips/${tripId}/memories/new`, editPath = (id: string) => `/trips/${tripId}/memories/${id}/edit`;
/** Opens the subform from the composer, fills it and accepts: back in the composer. */
async function addExpense(container: HTMLElement, amount = "25,50", currency = "ARS", breakdown = "") {
  await click(expenseButton(container));
  await type(container, "amount", amount); await choose(container, currency);
  if (breakdown) await type(container, "breakdown", breakdown);
  await click(button(container, "Aceptar"));
}

describe("PostComposer expense (create)", () => {
  it("shows an empty Gasto section with Agregar gasto and nothing to remove", async () => {
    const { container, itineraryGet } = await render(newPath);
    expect(container.querySelector('section[aria-label="Gasto"]')?.textContent).toContain("Sin gasto");
    expect(expenseButton(container).textContent).toBe("Agregar gasto");
    expect(button(container, "Quitar gasto")).toBeUndefined();
    expect(itineraryGet).not.toHaveBeenCalled();
  });
  it("opens the subform keeping the typed text, and comes back with the summary, the focus on the button and the draft intact", async () => {
    const { container } = await render(newPath);
    await type(container, "description", "Cena rica");
    await addExpense(container, "25,5", "ARS", "vino");
    expect(container.querySelector("h1")?.textContent).toBe("Nuevo recuerdo");
    expect((container.querySelector('[name="description"]') as HTMLTextAreaElement).value).toBe("Cena rica");
    expect(container.querySelector('section[aria-label="Gasto"]')?.textContent).toContain("Gasto: ARS 25,50 · vino");
    expect(expenseButton(container).textContent).toBe("Editar gasto");
    expect(document.activeElement).toBe(expenseButton(container));
    // Entering again preloads what was typed.
    await click(expenseButton(container));
    expect((container.querySelector('[name="amount"]') as HTMLInputElement).value).toBe("25,5");
    await click(button(container, "Cancelar"));
    expect(container.querySelector('section[aria-label="Gasto"]')?.textContent).toContain("ARS 25,50");
  });
  it("removes a new expense and gives the focus to the button", async () => {
    const { container } = await render(newPath);
    await addExpense(container);
    await click(button(container, "Quitar gasto"));
    expect(container.querySelector('section[aria-label="Gasto"]')?.textContent).toContain("Sin gasto");
    expect(expenseButton(container).textContent).toBe("Agregar gasto");
    expect(button(container, "Quitar gasto")).toBeUndefined();
  });
  it("Descartar after adding an expense discards it with the draft", async () => {
    const { container } = await render(newPath);
    await type(container, "description", "Cena");
    await addExpense(container);
    await click(button(container, "Cancelar"));
    await click(button(container, "Descartar"));
    expect(container.querySelector('[data-testid="listing"]')).not.toBeNull();
  });
  it("publishes text and expense in a single POST", async () => {
    const { container, create } = await render(newPath);
    await type(container, "description", "Cena rica");
    await addExpense(container, "25,50", "EUR", "vino");
    await submit(container);
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { description: "Cena rica", expense: { totalAmount: 25.5, currency: "EUR", breakdown: "vino" } });
    expect(container.querySelector('[data-testid="listing"]')).not.toBeNull();
  });
  it("publishes text, a new activity and an expense in a single POST", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-25T15:30:00.000Z"));
    const { container, create } = await render(newPath);
    await type(container, "description", "Cena rica");
    await addExpense(container);
    await click(Array.from(container.querySelectorAll("a")).find((link) => link.textContent === "nav-activity"));
    await type(container, "title", "Cena");
    await click(button(container, "Aceptar"));
    expect(container.querySelector("#post-link-summary")?.textContent).toContain("Actividad nueva: Cena");
    expect(container.querySelector('section[aria-label="Gasto"]')?.textContent).toContain("ARS 25,50");
    await submit(container);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![1]).toEqual({ description: "Cena rica", newActivity: { title: "Cena", scheduledAt: "2026-09-25T15:30:00.000Z" }, expense: { totalAmount: 25.5, currency: "ARS" } });
  });
  it("an expense alone does not count as content", async () => {
    const { container, create } = await render(newPath);
    await addExpense(container);
    await submit(container);
    expect(create).not.toHaveBeenCalled();
    expect(alerts(container)).toEqual(["Escribí un texto o agregá una ubicación."]);
  });
  it("a network failure keeps the draft, warns to check before retrying and a retry sends the same input", async () => {
    const create = vi.fn().mockResolvedValueOnce({ ok: false, error: { kind: "network" } }).mockResolvedValueOnce({ ok: true, value: saved(itineraryId(60)) });
    const { container } = await render(newPath, { create });
    await type(container, "description", "Cena");
    await addExpense(container);
    await submit(container);
    expect(container.textContent).toContain("Podés reintentar: el recuerdo no se va a publicar dos veces.");
    expect(container.querySelector('section[aria-label="Gasto"]')?.textContent).toContain("ARS 25,50");
    await submit(container);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1]![1]).toEqual(create.mock.calls[0]![1]);
  });
  it("is a server failure, not a success, when the response does not confirm the expense", async () => {
    const create = vi.fn().mockResolvedValue({ ok: false, error: { kind: "server" } });
    const { container } = await render(newPath, { create });
    await type(container, "description", "Cena");
    await addExpense(container);
    await submit(container);
    expect(container.querySelector('[data-testid="listing"]')).toBeNull();
    expect(container.querySelector('section[aria-label="Gasto"]')?.textContent).toContain("ARS 25,50");
  });
  it.each([
    [[{ field: "expense.totalAmount", code: "invalid", message: "x" }], "Revisá el importe del gasto."],
    [[{ field: "expense.totalAmount", code: "required", message: "x" }], "Revisá el importe del gasto."],
    [[{ field: "expense.totalAmount", code: "exceeds_max", message: "x" }], "El importe no puede superar 999.999.999.999,99. No lo redondeamos por vos."],
    [[{ field: "expense.currency", code: "required", message: "x" }], "Elegí la moneda del gasto."],
    [[{ field: "expense.currency", code: "invalid", message: "x" }], "Elegí la moneda del gasto."],
    [[{ field: "expense.breakdown", code: "invalid", message: "x" }], "No pudimos guardar el gasto. Revisá sus datos."],
    [[{ field: "expense.breakdown", code: "too_long", message: "x" }], "El desglose del gasto supera el máximo de 2000 caracteres. Editá el gasto."],
  ])("maps a 422 %j to one alert and focuses the expense button, keeping the draft", async (fields, message) => {
    const create = vi.fn().mockResolvedValue({ ok: false, error: { kind: "validation", fields } });
    const { container } = await render(newPath, { create });
    await type(container, "description", "Cena");
    await addExpense(container);
    await submit(container);
    expect(alerts(container)).toEqual([message]);
    expect(document.activeElement).toBe(expenseButton(container));
    expect(container.querySelector('section[aria-label="Gasto"]')?.textContent).toContain("ARS 25,50");
    expect(container.querySelector("[aria-live]")).toBeNull();
  });
});

describe("PostComposer expense (edit)", () => {
  it("while the saved expense loads the button is aria-disabled without losing focus, the text stays editable and the message is shown", async () => {
    const pending = deferred<unknown>();
    const { container, update } = await render(editPath(withExpenseId), { itineraryGet: vi.fn().mockReturnValue(pending.promise) });
    expect(container.querySelector('section[aria-label="Gasto"] [role="status"]')?.textContent).toContain("Cargando gasto");
    expect(expenseButton(container).getAttribute("aria-disabled")).toBe("true");
    expect(expenseButton(container).disabled).toBe(false);
    expenseButton(container).focus();
    await click(expenseButton(container));
    expect(document.activeElement).toBe(expenseButton(container));
    expect(container.querySelector('input[name="amount"]')).toBeNull();
    await type(container, "description", "Editado");
    expect((container.querySelector('[name="description"]') as HTMLTextAreaElement).value).toBe("Editado");
    await submit(container);
    expect(update).toHaveBeenCalledExactlyOnceWith(tripId, withExpenseId, { description: "Editado" });
  });
  it("shows the saved expense once loaded, offers Editar gasto and Quitar gasto, and no longer says it cannot be removed", async () => {
    const { container } = await render(editPath(withExpenseId));
    const section = container.querySelector('section[aria-label="Gasto"]')!;
    expect(section.textContent).toContain("Gasto: ARS 25,50 · Almuerzo");
    expect(expenseButton(container).textContent).toBe("Editar gasto");
    expect(expenseButton(container).getAttribute("aria-disabled")).toBeNull();
    expect(button(container, "Quitar gasto")).toBeTruthy();
    expect(section.textContent).not.toContain("no se puede quitar");
  });
  it("a memory without expense offers Agregar gasto", async () => {
    const { container } = await render(editPath(withoutExpenseId));
    expect(expenseButton(container).textContent).toBe("Agregar gasto");
    expect(container.querySelector('section[aria-label="Gasto"]')?.textContent).toContain("Sin gasto");
  });
  it("an itinerary error shows a single alert with Reintentar and recovers; the text stays editable", async () => {
    const itineraryGet = vi.fn().mockResolvedValueOnce({ ok: false, error: { kind: "network" } }).mockResolvedValueOnce({ ok: true, value: itineraryFixture() });
    const { container } = await render(editPath(withExpenseId), { itineraryGet });
    expect(alerts(container)).toHaveLength(1);
    expect(alerts(container)[0]).toContain("No pudimos cargar el gasto");
    expect(expenseButton(container).getAttribute("aria-disabled")).toBe("true");
    await type(container, "description", "Editado");
    await click(button(container, "Reintentar"));
    expect(itineraryGet).toHaveBeenCalledTimes(2);
    expect(alerts(container)).toEqual([]);
    expect(container.querySelector('section[aria-label="Gasto"]')?.textContent).toContain("ARS 25,50");
    expect((container.querySelector('[name="description"]') as HTMLTextAreaElement).value).toBe("Editado");
  });
  it("a rejected itinerary request is an error too", async () => {
    const { container } = await render(editPath(withExpenseId), { itineraryGet: vi.fn().mockRejectedValue(new Error("down")) });
    expect(alerts(container)[0]).toContain("No pudimos cargar el gasto");
  });
  it("changing only the expense saves it in a PATCH with just the changed keys, and keeps payments out of it", async () => {
    const { container, update } = await render(editPath(withExpenseId));
    await click(expenseButton(container));
    expect((container.querySelector('[name="amount"]') as HTMLInputElement).value).toBe("25,50");
    await type(container, "amount", "30");
    await click(button(container, "Aceptar"));
    expect(container.querySelector('section[aria-label="Gasto"]')?.textContent).toContain("ARS 30,00");
    await submit(container);
    expect(update).toHaveBeenCalledExactlyOnceWith(tripId, withExpenseId, { expense: { totalAmount: 30 } });
  });
  it("saves text and expense together in one PATCH", async () => {
    const { container, update } = await render(editPath(withExpenseId));
    await type(container, "description", "Editado");
    await click(expenseButton(container));
    await type(container, "breakdown", "Almuerzo y postre");
    await click(button(container, "Aceptar"));
    await submit(container);
    expect(update).toHaveBeenCalledExactlyOnceWith(tripId, withExpenseId, { description: "Editado", expense: { breakdown: "Almuerzo y postre" } });
  });
  it("adding an expense to a memory without one sends the whole expense", async () => {
    const { container, update } = await render(editPath(withoutExpenseId));
    await addExpense(container, "10", "USD");
    await submit(container);
    expect(update).toHaveBeenCalledExactlyOnceWith(tripId, withoutExpenseId, { expense: { totalAmount: 10, currency: "USD" } });
  });
  it("opening the subform and accepting without changes sends nothing", async () => {
    const { container, update } = await render(editPath(withExpenseId));
    await click(expenseButton(container));
    await click(button(container, "Aceptar"));
    await submit(container);
    expect(update).not.toHaveBeenCalled();
    expect(container.textContent).toContain("No hay cambios para guardar.");
  });
  it("Cancelar with no expense change does not ask to discard", async () => {
    const { container } = await render(editPath(withExpenseId));
    await click(expenseButton(container));
    await click(button(container, "Aceptar"));
    await click(button(container, "Cancelar"));
    expect(container.querySelector('[data-testid="listing"]')).not.toBeNull();
  });
  it("Cancelar with a changed expense asks before discarding", async () => {
    const { container } = await render(editPath(withExpenseId));
    await click(expenseButton(container));
    await type(container, "amount", "30"); await click(button(container, "Aceptar"));
    await click(button(container, "Cancelar"));
    expect(document.body.textContent).toContain("Descartar cambios");
  });
  it("a payments conflict (exceeds_total) shows its specific message, keeps the draft and focuses the button", async () => {
    const update = vi.fn().mockResolvedValue({ ok: false, error: { kind: "validation", fields: [{ field: "expense.payments", code: "exceeds_total", message: "x" }] } });
    const { container } = await render(editPath(withExpenseId), { update });
    await click(expenseButton(container));
    await type(container, "amount", "1"); await click(button(container, "Aceptar"));
    await submit(container);
    expect(alerts(container)).toEqual(["El nuevo importe queda por debajo de pagos o partes fijas ya registrados. Ajustalos en Pagos y reparto."]);
    expect(container.querySelector('section[aria-label="Gasto"]')?.textContent).toContain("ARS 1,00");
    expect(document.activeElement).toBe(expenseButton(container));
  });
  it("a shares conflict uses the same message", async () => {
    const update = vi.fn().mockResolvedValue({ ok: false, error: { kind: "validation", fields: [{ field: "expense.shares", code: "exceeds_total", message: "x" }] } });
    const { container } = await render(editPath(withExpenseId), { update });
    await click(expenseButton(container));
    await type(container, "amount", "1"); await click(button(container, "Aceptar"));
    await submit(container);
    expect(alerts(container)[0]).toContain("pagos o partes fijas");
  });
  it("sends no expense when the draft expense is not confirmed against the saved one (still loading)", async () => {
    const itineraryGet = vi.fn().mockResolvedValueOnce({ ok: true, value: itineraryFixture() }).mockResolvedValueOnce({ ok: true, value: itineraryFixture() }).mockReturnValue(new Promise(() => undefined));
    const { container, update } = await render(editPath(withExpenseId), { itineraryGet });
    await click(expenseButton(container));
    await type(container, "amount", "30"); await click(button(container, "Aceptar"));
    await submit(container);
    // Back from the subform the composer reads the saved expense again: until it is ready the change is not sent.
    expect(update).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Esperá a que cargue el gasto guardado");
  });

  describe("attributed date", () => {
    const withAttribution = (source: "activity" | "publication", occurredAt: string, publishedAt: string) => vi.fn().mockImplementation(async () => {
      const value = itineraryFixture();
      value.expenses[0] = { ...value.expenses[0]!, source, occurredAt, publishedAt };
      return { ok: true, value };
    });
    it("shows both dates, read only, when the attributed local day differs from the publication one", async () => {
      const { container } = await render(editPath(withExpenseId), { itineraryGet: withAttribution("activity", "2026-09-26T15:00:00.000Z", "2026-09-25T13:00:00.123Z") });
      const text = container.querySelector('section[aria-label="Gasto"]')!.textContent!;
      expect(text).toMatch(/Gasto atribuido al 26 .* 2026 \(actividad\) · Publicado el 25 .* 2026/);
    });
    it("compares the local day, not the UTC one: 01:30Z and 23:00Z of the day before are the same local day", async () => {
      const { container } = await render(editPath(withExpenseId), { itineraryGet: withAttribution("activity", "2026-09-26T01:30:00.000Z", "2026-09-25T13:00:00.123Z") });
      expect(container.querySelector('section[aria-label="Gasto"]')!.textContent).not.toContain("Gasto atribuido");
    });
    it("shows nothing when the attribution is by publication, even if the days differ", async () => {
      const { container } = await render(editPath(withExpenseId), { itineraryGet: withAttribution("publication", "2026-09-26T15:00:00.000Z", "2026-09-25T13:00:00.123Z") });
      expect(container.querySelector('section[aria-label="Gasto"]')!.textContent).not.toContain("Gasto atribuido");
    });
    it("stops showing the saved attribution once the draft changes the link, since it is recalculated on save", async () => {
      const { container } = await render(editPath(withExpenseId), { itineraryGet: withAttribution("activity", "2026-09-26T15:00:00.000Z", "2026-09-25T13:00:00.123Z") });
      expect(container.querySelector('section[aria-label="Gasto"]')!.textContent).toContain("Gasto atribuido");
      await click(button(container, "Vincular a"));
      const radio = (label: string) => Array.from(container.querySelectorAll("label")).find((item) => item.textContent?.trim().startsWith(label))?.querySelector('input[type="radio"]');
      await click(radio("Actividad")); await click(radio("Paseo por el centro")); await click(button(container, "Aceptar"));
      const section = container.querySelector('section[aria-label="Gasto"]')!.textContent!;
      expect(section).not.toContain("Gasto atribuido");
      expect(section).toContain("Se recalcula al guardar");
    });
    it("shows nothing when both dates are the same day", async () => {
      const { container } = await render(editPath(withExpenseId));
      expect(container.querySelector('section[aria-label="Gasto"]')!.textContent).not.toContain("Gasto atribuido");
    });
  });
});

describe("PostComposer payments and shares (T84)", () => {
  const splitButton = (container: HTMLElement) => container.querySelector('button[name="split"]') as HTMLButtonElement;
  const stored = (extra: Partial<SavedExpenseView> = {}): SavedExpenseView => ({ postId: withExpenseId, totalAmount: 25.5, currency: "ARS", breakdown: "Almuerzo",
    payments: [{ userId: me, unit: "amount", value: 10 }], shares: [{ userId: me, unit: "remainder", value: null }],
    completeness: { status: "incomplete", reasons: [] }, formerMemberIds: [], ...extra });
  const rowsOf = (container: HTMLElement, section: string) => Array.from(container.querySelectorAll<HTMLElement>(`[data-section="${section}"] [data-row]`));
  const valueIn = (row: HTMLElement) => row.querySelector<HTMLInputElement>('input[inputmode="decimal"]')!;
  const setValue = async (element: HTMLInputElement, value: string) => {
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); });
  };
  const pick = async (container: HTMLElement, name: string, value: string) => {
    const element = container.querySelector(`select[name="${name}"]`) as HTMLSelectElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("change", { bubbles: true })); });
  };

  it("opens the editor from the Gasto section, and with no expense yet it asks for amount and currency first", async () => {
    const { container } = await render(newPath);
    expect(splitButton(container).textContent).toBe("Pagos y reparto");
    await click(splitButton(container));
    expect(container.textContent).toContain("Cargá primero importe y moneda del gasto");
    await click(button(container, "Cancelar"));
    expect(splitButton(container)).not.toBeNull();
    expect(document.activeElement).toBe(splitButton(container));
  });

  it("creating: the confirmed proposal travels with the expense in the POST", async () => {
    const { container, create } = await render(newPath);
    await type(container, "description", "Cena");
    await addExpense(container, "100", "ARS");
    await click(splitButton(container));
    expect(container.textContent).toContain("Propuesta sin confirmar");
    await click(button(container, "Aceptar"));
    await submit(container);
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { description: "Cena", expense: { totalAmount: 100, currency: "ARS",
      shares: [{ userId: me, unit: "remainder", value: null }, { userId: beto, unit: "remainder", value: null }] } });
  });

  it("cancelling the editor sends nothing about the split (the proposal is not persisted)", async () => {
    const { container, create } = await render(newPath);
    await type(container, "description", "Cena");
    await addExpense(container, "100", "ARS");
    await click(splitButton(container));
    await click(button(container, "Cancelar"));
    await submit(container);
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { description: "Cena", expense: { totalAmount: 100, currency: "ARS" } });
  });

  it("removing a new expense also drops its payments and shares", async () => {
    const { container, create } = await render(newPath);
    await type(container, "description", "Cena");
    await addExpense(container, "100", "ARS");
    await click(splitButton(container)); await click(button(container, "Aceptar"));
    await click(button(container, "Quitar gasto"));
    await submit(container);
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { description: "Cena" });
  });

  it("editing: a save with no change in payments and shares does not send them, so they are kept when the mode changes", async () => {
    const { container, update } = await render(editPath(withExpenseId), { storedExpense: stored() });
    await type(container, "description", "Editado");
    await click(splitButton(container)); await click(button(container, "Aceptar"));
    await submit(container);
    expect(update).toHaveBeenCalledExactlyOnceWith(tripId, withExpenseId, { description: "Editado" });
  });

  it("editing: only the list that changed is sent", async () => {
    const { container, update } = await render(editPath(withExpenseId), { storedExpense: stored() });
    await click(splitButton(container));
    await setValue(valueIn(rowsOf(container, "payments")[0]!), "12,50");
    await click(button(container, "Aceptar"));
    await submit(container);
    expect(update).toHaveBeenCalledExactlyOnceWith(tripId, withExpenseId, { expense: { payments: [{ userId: me, unit: "amount", value: 12.5 }] } });
  });

  it("editing: a former member row is kept as it came when the other rows change", async () => {
    const withFormer = stored({ payments: [{ userId: dani, unit: "amount", value: 10 }], shares: [{ userId: dani, unit: "amount", value: 5 }] });
    const { container, update } = await render(editPath(withExpenseId), { storedExpense: withFormer });
    await click(splitButton(container));
    await pick(container, "payments-add", beto); await click(button(container, "Agregar pago"));
    await setValue(valueIn(rowsOf(container, "payments")[1]!), "5");
    await click(button(container, "Aceptar"));
    await submit(container);
    expect(update).toHaveBeenCalledExactlyOnceWith(tripId, withExpenseId, { expense: { payments: [{ userId: dani, unit: "amount", value: 10 }, { userId: beto, unit: "amount", value: 5 }] } });
  });

  describe("with an unreadable stored expense", () => {
    const unreadable = () => vi.fn().mockImplementation(async (_trip: string, id: string) => ({ ok: true, value: { post: saved(id), parent: null, children: [], rootActivityId: null, expenseUnreadable: true } }));

    it("the composer loads and saves a text change without payments or shares", async () => {
      const { container, update } = await render(editPath(withExpenseId), { get: unreadable() });
      await type(container, "description", "Editado");
      await submit(container);
      expect(update).toHaveBeenCalledExactlyOnceWith(tripId, withExpenseId, { description: "Editado" });
    });

    it("saving an amount sends no payments or shares", async () => {
      const { container, update } = await render(editPath(withExpenseId), { get: unreadable() });
      await click(expenseButton(container));
      await type(container, "amount", "30"); await choose(container, "ARS");
      await click(button(container, "Aceptar"));
      await submit(container);
      expect(update).toHaveBeenCalledTimes(1);
      const body = update.mock.calls[0]![2] as { expense?: Record<string, unknown> };
      expect(body.expense).toBeDefined();
      expect(body.expense).not.toHaveProperty("payments");
      expect(body.expense).not.toHaveProperty("shares");
    });

    it("Pagos y reparto shows the error state with a retry and no editor", async () => {
      const { container } = await render(editPath(withExpenseId), { get: unreadable() });
      await type(container, "description", "Editado");
      await click(splitButton(container));
      expect(container.querySelector("[data-section]")).toBeNull();
      expect(alerts(container)).toHaveLength(1);
      expect(button(container, "Reintentar")).toBeDefined();
    });
  });

  it("a 422 on a row opens the editor with that row marked, keeps the draft and the person fixes it", async () => {
    const update = vi.fn().mockResolvedValue({ ok: false, error: { kind: "validation", fields: [{ field: "expense.payments[1].userId", code: "not_member", message: "x" }] } });
    const { container } = await render(editPath(withExpenseId), { storedExpense: stored(), update });
    await click(splitButton(container));
    await pick(container, "payments-add", beto); await click(button(container, "Agregar pago"));
    await setValue(valueIn(rowsOf(container, "payments")[1]!), "5");
    await click(button(container, "Aceptar"));
    await submit(container);
    expect(alerts(container)).toEqual(["Revisá pagos y reparto: no pudimos guardar algunas filas."]);
    await click(button(container, "Ajustar pagos y reparto"));
    expect(container.textContent).toContain("Esta persona ya no integra el viaje");
    expect(rowsOf(container, "payments")).toHaveLength(2);
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(rowsOf(container, "payments")[1]!.contains(document.activeElement)).toBe(true);
  });

  it("a 422 on a list (total lowered below the fixed amounts) opens the editor with the new total showing the excess", async () => {
    const update = vi.fn().mockResolvedValue({ ok: false, error: { kind: "validation", fields: [{ field: "expense.payments", code: "exceeds_total", message: "x" }] } });
    const { container } = await render(editPath(withExpenseId), { storedExpense: stored({ payments: [{ userId: me, unit: "amount", value: 20 }] }), update });
    await click(expenseButton(container));
    await type(container, "amount", "15"); await click(button(container, "Aceptar"));
    await submit(container);
    expect(alerts(container)).toEqual(["El nuevo importe queda por debajo de pagos o partes fijas ya registrados. Ajustalos en Pagos y reparto."]);
    await click(button(container, "Ajustar pagos y reparto"));
    expect(container.textContent).toContain("Sobran ARS 5,00");
  });

  it("a 422 about the split keeps the edited rows in the draft", async () => {
    const update = vi.fn().mockResolvedValue({ ok: false, error: { kind: "validation", fields: [{ field: "expense.shares[0].value", code: "invalid_value", message: "x" }] } });
    const { container } = await render(editPath(withExpenseId), { storedExpense: stored(), update });
    await click(splitButton(container));
    await click(button(container, "Incluir a Beto"));
    await click(button(container, "Aceptar"));
    await submit(container);
    expect(alerts(container)).toHaveLength(1);
    await click(button(container, "Ajustar pagos y reparto"));
    expect(rowsOf(container, "shares")).toHaveLength(2);
  });

  it("a 422 on an expense field that is not payments or shares keeps the general message and no adjust button", async () => {
    const update = vi.fn().mockResolvedValue({ ok: false, error: { kind: "validation", fields: [{ field: "expense.totalAmount", code: "invalid", message: "x" }] } });
    const { container } = await render(editPath(withExpenseId), { storedExpense: stored(), update });
    await click(expenseButton(container));
    await type(container, "amount", "30"); await click(button(container, "Aceptar"));
    await submit(container);
    expect(alerts(container)).toEqual(["Revisá el importe del gasto."]);
    expect(button(container, "Ajustar pagos y reparto")).toBeUndefined();
  });

  it("a failed save keeps the edited split in the draft", async () => {
    const update = vi.fn().mockResolvedValue({ ok: false, error: { kind: "network" } });
    const { container } = await render(editPath(withExpenseId), { storedExpense: stored(), update });
    await click(splitButton(container));
    await setValue(valueIn(rowsOf(container, "payments")[0]!), "11");
    await click(button(container, "Aceptar"));
    await submit(container);
    await click(splitButton(container));
    expect(valueIn(rowsOf(container, "payments")[0]!).value).toBe("11");
  });

  it("the memory is dirty after editing the split: Cancelar asks before discarding", async () => {
    const { container } = await render(editPath(withExpenseId), { storedExpense: stored() });
    await click(splitButton(container));
    await setValue(valueIn(rowsOf(container, "payments")[0]!), "11");
    await click(button(container, "Aceptar"));
    await click(button(container, "Cancelar"));
    expect(document.body.textContent).toContain("Descartar cambios");
  });

  it.each(["payments", "shares"] as const)("a 422 exceeds_max on %s[1].value marks that row with the limit and keeps the draft", async (list) => {
    const update = vi.fn().mockResolvedValue({ ok: false, error: { kind: "validation", fields: [{ field: `expense.${list}[1].value`, code: "exceeds_max", message: "x" }] } });
    const sharesTwo = [{ userId: me, unit: "amount" as const, value: 1 }, { userId: beto, unit: "amount" as const, value: 1 }];
    const { container } = await render(editPath(withExpenseId), { storedExpense: stored(list === "shares" ? { shares: sharesTwo } : {}), update });
    await click(splitButton(container));
    if (list === "payments") { await pick(container, "payments-add", beto); await click(button(container, "Agregar pago")); }
    await setValue(valueIn(rowsOf(container, list)[1]!), "5");
    await click(button(container, "Aceptar"));
    await submit(container);
    await click(button(container, "Ajustar pagos y reparto"));
    expect(container.textContent).toContain("El importe no puede superar 999.999.999.999,99");
    expect(rowsOf(container, list)).toHaveLength(2);
  });
});

describe("expense dates presentation", () => {
  it("wraps the attributed date and the publication date in their own spans and keeps the line text", async () => {
    const { container } = await render(editPath(withExpenseId), { itineraryGet: vi.fn().mockImplementation(async () => {
      const value = itineraryFixture();
      value.expenses[0] = { ...value.expenses[0]!, source: "activity", occurredAt: "2026-09-26T15:00:00.000Z", publishedAt: "2026-09-25T13:00:00.123Z" };
      return { ok: true, value };
    }) });
    const line = container.querySelector<HTMLElement>("#post-expense-attribution")!;
    const dates = Array.from(line.querySelectorAll(".expense-date")).map((item) => item.textContent ?? "");
    expect(dates).toHaveLength(2);
    expect(dates[0]).toMatch(/^26 .* 2026$/);
    expect(dates[1]).toMatch(/^25 .* 2026$/);
    expect(line.textContent).toMatch(/^Gasto atribuido al 26 .* 2026 \(actividad\) · Publicado el 25 .* 2026$/);
  });
  it("the expense and split buttons are secondary and keep their names", async () => {
    const { container } = await render(editPath(withExpenseId));
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('section[aria-label="Gasto"] button'));
    for (const name of ["expense", "split"]) expect(buttons.find((item) => item.name === name)?.classList.contains("ui-button--secondary"), name).toBe(true);
  });
});

describe("PostComposer removing the saved expense (T128)", () => {
  const summary = (container: HTMLElement) => container.querySelector("#post-expense-summary")?.textContent;
  const removedText = "Gasto: se quitará al guardar. Dejará de figurar en el registro y en el balance.";
  it("offers Quitar gasto only once the saved expense is loaded and only when there is one", async () => {
    const pending = deferred<unknown>();
    const loading = await render(editPath(withExpenseId), { itineraryGet: vi.fn().mockReturnValue(pending.promise) });
    expect(button(loading.container, "Quitar gasto")).toBeUndefined();
    const without = await render(editPath(withoutExpenseId));
    expect(button(without.container, "Quitar gasto")).toBeUndefined();
  });
  it("marks the removal: the summary says it, Conservar gasto undoes it and the edit buttons are hidden meanwhile", async () => {
    const { container } = await render(editPath(withExpenseId));
    await click(button(container, "Quitar gasto"));
    expect(summary(container)).toBe(removedText);
    expect(button(container, "Conservar gasto")).toBeTruthy();
    expect(button(container, "Quitar gasto")).toBeUndefined();
    expect(button(container, "Editar gasto")).toBeUndefined();
    expect(button(container, "Pagos y reparto")).toBeUndefined();
    expect(document.activeElement).toBe(button(container, "Conservar gasto"));
    await click(button(container, "Conservar gasto"));
    expect(summary(container)).toContain("Gasto: ARS 25,50");
    expect(button(container, "Editar gasto")).toBeTruthy();
    expect(button(container, "Pagos y reparto")).toBeTruthy();
    expect(document.activeElement).toBe(button(container, "Quitar gasto"));
  });
  it("conserving it leaves nothing to save", async () => {
    const { container, update } = await render(editPath(withExpenseId));
    await click(button(container, "Quitar gasto")); await click(button(container, "Conservar gasto"));
    await submit(container);
    expect(update).not.toHaveBeenCalled();
    expect(container.textContent).toContain("No hay cambios para guardar.");
  });
  it("saving sends expense: null and goes to the listing with the updated notice", async () => {
    const { container, update } = await render(editPath(withExpenseId));
    await click(button(container, "Quitar gasto"));
    await submit(container);
    expect(update).toHaveBeenCalledExactlyOnceWith(tripId, withExpenseId, { expense: null });
    expect(container.querySelector('[data-testid="listing"]')?.textContent).toContain("updated");
  });
  it("sends the removal together with a text change in one PATCH", async () => {
    const { container, update } = await render(editPath(withExpenseId));
    await type(container, "description", "Editado");
    await click(button(container, "Quitar gasto"));
    await submit(container);
    expect(update).toHaveBeenCalledExactlyOnceWith(tripId, withExpenseId, { description: "Editado", expense: null });
  });
  it("removing after editing the amount drops those changes", async () => {
    const { container, update } = await render(editPath(withExpenseId));
    await click(expenseButton(container));
    await type(container, "amount", "30"); await click(button(container, "Aceptar"));
    await click(button(container, "Quitar gasto"));
    await click(button(container, "Conservar gasto"));
    expect(summary(container)).toContain("Gasto: ARS 25,50");
    await click(button(container, "Quitar gasto"));
    await submit(container);
    expect(update).toHaveBeenCalledExactlyOnceWith(tripId, withExpenseId, { expense: null });
  });
  it("a marked removal counts as a change: Cancelar asks before discarding", async () => {
    const { container } = await render(editPath(withExpenseId));
    await click(button(container, "Quitar gasto"));
    await click(button(container, "Cancelar"));
    expect(document.body.textContent).toContain("Descartar cambios");
  });
  it("a network failure keeps the mark and allows saving again", async () => {
    const update = vi.fn().mockResolvedValueOnce({ ok: false, error: { kind: "network" } }).mockResolvedValue({ ok: true, value: saved(withExpenseId) });
    const { container } = await render(editPath(withExpenseId), { update });
    await click(button(container, "Quitar gasto"));
    await submit(container);
    expect(container.textContent).toContain("No pudimos guardar el recuerdo");
    expect(summary(container)).toBe(removedText);
    await submit(container);
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenLastCalledWith(tripId, withExpenseId, { expense: null });
  });
  it("creating still removes an unsaved expense with Quitar gasto and never sends expense: null", async () => {
    const { container, create } = await render(newPath);
    await type(container, "description", "Hola");
    await addExpense(container, "10", "USD");
    await click(button(container, "Quitar gasto"));
    expect(button(container, "Conservar gasto")).toBeUndefined();
    await submit(container);
    expect(create).toHaveBeenCalledExactlyOnceWith(tripId, { description: "Hola" });
  });
});
