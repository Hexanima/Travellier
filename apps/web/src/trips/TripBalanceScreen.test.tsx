// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TripBalanceScreen } from "./TripBalanceScreen.js";
import { itineraryId } from "./itinerary-test-fixture.js";
import type { BalanceReason, TripBalance } from "./trip-balance-api.js";
import type { PostResponse } from "./trip-post-api.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { vi.useRealTimers(); await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
const tripId = itineraryId(1), me = itineraryId(20), beto = itineraryId(21), gone = itineraryId(22);
const balancePath = `/trips/${tripId}/balance`;
const forbidden = /pagad|cobrad|liquidad|saldad/i;
const entry = (userId: string, paidCents: number, shareCents: number, formerMember = false) => ({ userId, paidCents, shareCents, netCents: paidCents - shareCents, formerMember });
const ars = () => ({ currency: "ARS" as const, expenseCount: 2, balances: [entry(me, 3000, 1000), entry(beto, 0, 1000), entry(gone, 0, 1000, true)],
  settlements: [{ fromUserId: beto, toUserId: me, cents: 1000 }, { fromUserId: gone, toUserId: me, cents: 1000 }] });
const usd = () => ({ currency: "USD" as const, expenseCount: 1, balances: [entry(me, 0, 500), entry(beto, 500, 0)], settlements: [{ fromUserId: me, toUserId: beto, cents: 500 }] });
const pending = (n: number, reasons: BalanceReason[], extra: Partial<TripBalance["excludedExpenses"][number]> = {}) =>
  ({ expenseId: itineraryId(40 + n), postId: itineraryId(60 + n), currency: "ARS" as const, totalCents: 12345, reasons, formerMemberIds: [] as string[], ...extra });
const balance = (extra: Partial<TripBalance> = {}): TripBalance => ({ tripId, expenseMode: "balance", currencies: [ars(), usd()], excludedExpenses: [], includedExpenseCount: 3, ...extra });
const register: TripBalance = { tripId, expenseMode: "register", currencies: [], excludedExpenses: [], includedExpenseCount: 0 };
const post = (n: number, description: string | null): PostResponse => ({ id: itineraryId(60 + n), tripId, authorId: me, description, mapsUrl: null, activityId: null, parentPostId: null, transportId: null, createdAt: "2026-01-02T10:00:00.000Z" });
const members = () => vi.fn().mockResolvedValue({ ok: true, value: { currentUserId: me, members: [
  { id: itineraryId(100), userId: me, name: "Ana", role: "admin", joinedAt: "2026-01-01T00:00:00.000Z" }, { id: itineraryId(101), userId: beto, name: "Beto", role: "participant", joinedAt: "2026-01-01T00:00:00.000Z" }] } });
const ok = <T,>(value: T) => ({ ok: true as const, value });

function EditStub() { const location = useLocation(); const navigate = useNavigate();
  return <div><p data-testid="edit">EDITOR {location.pathname} {JSON.stringify(location.state)}</p><button type="button" onClick={() => navigate(-1)}>Guardar</button></div>; }
function ItineraryStub() { return <p>ITINERARIO</p>; }
type Mocks = { get?: ReturnType<typeof vi.fn>; list?: ReturnType<typeof vi.fn>; members?: ReturnType<typeof vi.fn> };
async function render(mocks: Mocks = {}, entryState?: unknown) {
  const get = mocks.get ?? vi.fn().mockResolvedValue(ok(balance()));
  const list = mocks.list ?? vi.fn().mockResolvedValue(ok([post(1, "Cena en el puerto"), post(2, null)]));
  const membersList = mocks.members ?? members();
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={[{ pathname: balancePath, state: entryState }]}><Routes>
    <Route path="/trips/:tripId/balance" element={<TripBalanceScreen balance={{ get }} posts={{ list }} members={{ list: membersList }} />} />
    <Route path="/trips/:tripId/memories/:postId/edit" element={<EditStub />} />
    <Route path="/trips/:tripId/itinerary" element={<ItineraryStub />} />
    <Route path="/login" element={<p>LOGIN</p>} />
  </Routes></MemoryRouter>));
  return { container, get, list, membersList };
}
const click = async (element: Element | null | undefined) => { expect(element).toBeTruthy(); await act(async () => element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }))); };
const button = (container: ParentNode, label: string) => Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.trim() === label);
const link = (container: ParentNode, label: string) => Array.from(container.querySelectorAll("a")).find((item) => item.textContent?.trim() === label || item.getAttribute("aria-label")?.startsWith(label));
const alerts = (container: HTMLElement) => container.querySelectorAll('[role="alert"]');
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
const section = (container: HTMLElement, title: string) => Array.from(container.querySelectorAll("section")).find((item) => item.querySelector("h2")?.textContent === title) as HTMLElement;
const pendingItems = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>("[data-balance-expense]"));

describe("TripBalanceScreen: states", () => {
  it("shows the heading, the way back and the loading state, then the balance", async () => {
    const wait = deferred<unknown>();
    const { container, get } = await render({ get: vi.fn().mockReturnValue(wait.promise) });
    expect(container.textContent).toContain("Cargando balance…");
    expect(container.querySelector("h1")?.textContent).toBe("Balance");
    expect(container.querySelector("h1")?.getAttribute("tabindex")).toBe("-1");
    expect(link(container, "Volver al itinerario")?.getAttribute("href")).toBe(`/trips/${tripId}/itinerary`);
    await act(async () => wait.resolve(ok(balance())));
    expect(container.textContent).not.toContain("Cargando balance…");
    expect(get).toHaveBeenCalledExactlyOnceWith(tripId);
  });
  it.each(["network", "server"])("a %s failure shows one alert with retry, and retrying loads", async (kind) => {
    const get = vi.fn().mockResolvedValueOnce({ ok: false, error: { kind } }).mockResolvedValueOnce(ok(balance()));
    const { container } = await render({ get });
    expect(alerts(container)).toHaveLength(1);
    expect(alerts(container)[0]!.textContent).toBe("No pudimos cargar el balance. Revisá tu conexión e intentá nuevamente.");
    expect(container.querySelector("[aria-live]")).toBeNull();
    await click(button(container, "Reintentar"));
    expect(container.textContent).toContain("Pesos (ARS)");
    expect(alerts(container)).toHaveLength(0);
  });
  it.each(["not-found", "forbidden"])("%s says it is not available and offers no retry", async (kind) => {
    const { container } = await render({ get: vi.fn().mockResolvedValue({ ok: false, error: { kind } }) });
    expect(alerts(container)[0]!.textContent).toBe("El balance de este viaje no está disponible para tu cuenta.");
    expect(button(container, "Reintentar")).toBeUndefined();
  });
  it("unauthorized asks to log in again", async () => {
    const { container } = await render({ get: vi.fn().mockResolvedValue({ ok: false, error: { kind: "unauthorized" } }) });
    expect(alerts(container)[0]!.textContent).toBe("Tu sesión venció.");
    expect(link(container, "Iniciar sesión")?.getAttribute("href")).toBe("/login");
    expect(button(container, "Reintentar")).toBeUndefined();
  });
  it("a thrown error is a network failure", async () => {
    const { container } = await render({ get: vi.fn().mockRejectedValue(new Error("x")) });
    expect(alerts(container)[0]!.textContent).toContain("No pudimos cargar el balance");
  });
});

describe("TripBalanceScreen: register mode", () => {
  it("shows no debts, explains it and keeps the way to the expenses; it asks for no members nor memories", async () => {
    const { container, list, membersList } = await render({ get: vi.fn().mockResolvedValue(ok(register)) });
    expect(container.textContent).toContain("Este viaje está en modo registro: no se calculan deudas ni compensaciones. Los gastos siguen registrados en cada recuerdo.");
    expect(link(container, "Ver gastos del viaje")?.getAttribute("href")).toBe(`/trips/${tripId}/itinerary`);
    expect(link(container, "Ver recuerdos")?.getAttribute("href")).toBe(`/trips/${tripId}/memories`);
    expect(container.querySelector("h2")).toBeNull();
    expect(container.textContent).not.toMatch(/Gastos por completar|Compensaciones|Tiene a favor|Debe /);
    expect(list).not.toHaveBeenCalled(); expect(membersList).not.toHaveBeenCalled();
  });
  it("renders no balance even if the data carried some", async () => {
    const odd = { ...register, currencies: [ars()], excludedExpenses: [pending(1, ["missing_shares"])], includedExpenseCount: 2 };
    const { container, list } = await render({ get: vi.fn().mockResolvedValue(ok(odd)) });
    expect(container.textContent).not.toMatch(/Pesos|Tiene a favor|Debe |le debería|Gastos por completar|ARS/);
    expect(pendingItems(container)).toHaveLength(0);
    expect(list).not.toHaveBeenCalled();
  });
});

describe("TripBalanceScreen: balance mode", () => {
  it("keeps each currency apart with its count, in the server order, and never adds them", async () => {
    const { container } = await render();
    expect(Array.from(container.querySelectorAll("h2")).map((item) => item.textContent)).toEqual(["Pesos (ARS)", "Dólares (USD)"]);
    expect(section(container, "Pesos (ARS)").textContent).toContain("2 gastos incluidos");
    expect(section(container, "Dólares (USD)").textContent).toContain("1 gasto incluido");
    expect(section(container, "Pesos (ARS)").textContent).not.toContain("USD");
    expect(section(container, "Dólares (USD)").textContent).not.toContain("ARS");
    expect(container.textContent).not.toMatch(/Total|EUR/);
  });
  it("shows who is owed, who owes and who has no balance, with each person named the same way everywhere", async () => {
    const { container } = await render();
    const ars = section(container, "Pesos (ARS)"), usd = section(container, "Dólares (USD)");
    const rows = Array.from(ars.querySelectorAll("li")).map((item) => item.textContent);
    expect(rows[0]).toContain("Vos"); expect(rows[0]).toContain("Tiene a favor ARS 20,00");
    expect(rows[1]).toContain("Beto"); expect(rows[1]).toContain("Debe ARS 10,00");
    expect(rows[2]).toContain("Ex integrante 1"); expect(rows[2]).toContain("Debe ARS 10,00");
    expect(usd.textContent).toContain("Vos"); expect(usd.textContent).toContain("Debe USD 5,00");
    expect(usd.textContent).toContain("Beto"); expect(usd.textContent).toContain("Tiene a favor USD 5,00");
  });
  it("shows what each person paid and was owed besides the net", async () => {
    const { container } = await render();
    expect(section(container, "Pesos (ARS)").textContent).toContain("Pagó ARS 30,00");
    expect(section(container, "Pesos (ARS)").textContent).toContain("Le correspondía ARS 10,00");
  });
  it("says «Sin saldo pendiente» for a zero net", async () => {
    const even = { currency: "EUR" as const, expenseCount: 1, balances: [entry(me, 100, 100), entry(beto, 100, 100)], settlements: [] };
    const { container } = await render({ get: vi.fn().mockResolvedValue(ok(balance({ currencies: [even], includedExpenseCount: 1 }))) });
    expect(section(container, "Euros (EUR)").textContent).toContain("Sin saldo pendiente");
    expect(section(container, "Euros (EUR)").textContent).toContain("No hay compensaciones sugeridas en esta moneda.");
  });
  it("presents the settlements as suggestions and states that nothing is registered", async () => {
    const { container } = await render();
    expect(container.textContent).toContain("Las compensaciones son sugerencias: la app no registra transferencias ni cobros.");
    const ars = section(container, "Pesos (ARS)");
    expect(ars.textContent).toContain("Compensaciones sugeridas");
    expect(ars.textContent).toContain("Beto le debería ARS 10,00 a vos");
    expect(ars.textContent).toContain("Ex integrante 1 le debería ARS 10,00 a vos");
    expect(section(container, "Dólares (USD)").textContent).toContain("Vos le deberías USD 5,00 a Beto");
    expect(button(container, "Marcar como hecho")).toBeUndefined();
  });
  it("never says a debt was paid, collected or settled, in any state or accessible name", async () => {
    const withPending = balance({ excludedExpenses: [pending(1, ["missing_currency", "missing_payments"], { currency: null }), pending(2, ["invalid_rules"], { totalCents: null })] });
    const { container } = await render({ get: vi.fn().mockResolvedValue(ok(withPending)) });
    expect(document.body.textContent).not.toMatch(forbidden);
    for (const element of Array.from(container.querySelectorAll("[aria-label]"))) expect(element.getAttribute("aria-label")).not.toMatch(forbidden);
  });
  it("shows the empty state, with a way to create a memory, when no expense is complete yet", async () => {
    const empty = balance({ currencies: [], includedExpenseCount: 0 });
    const { container } = await render({ get: vi.fn().mockResolvedValue(ok(empty)) });
    expect(container.textContent).toContain("Todavía no hay gastos completos para calcular un balance.");
    expect(link(container, "Nuevo recuerdo")?.getAttribute("href")).toBe(`/trips/${tripId}/memories/new`);
    expect(container.textContent).not.toContain("Pesos");
  });
  it("without complete expenses still lists the pending ones below the empty state", async () => {
    const empty = balance({ currencies: [], includedExpenseCount: 0, excludedExpenses: [pending(1, ["missing_shares"])] });
    const { container } = await render({ get: vi.fn().mockResolvedValue(ok(empty)) });
    expect(container.textContent).toContain("Todavía no hay gastos completos para calcular un balance.");
    expect(pendingItems(container)).toHaveLength(1);
  });
  it("falls back to «Integrante» when the members did not load, still marking former members", async () => {
    const { container } = await render({ members: vi.fn().mockResolvedValue({ ok: false, error: { kind: "network" } }) });
    const rows = Array.from(section(container, "Pesos (ARS)").querySelectorAll("li")).map((item) => item.textContent);
    expect(rows[0]).toContain("Integrante"); expect(rows[0]).not.toContain("Vos");
    expect(rows[2]).toContain("Ex integrante 1");
  });
});

describe("TripBalanceScreen: expenses to complete", () => {
  const withPending = (...items: TripBalance["excludedExpenses"]) => ({ get: vi.fn().mockResolvedValue(ok(balance({ excludedExpenses: items }))) });
  it("lists each one with its memory, amount, readable reasons and an anchor", async () => {
    const { container } = await render(withPending(pending(1, ["missing_shares", "payments_not_covering_total"]), pending(2, ["missing_currency"], { currency: null, totalCents: 3000 })));
    expect(container.textContent).toContain("Estos gastos todavía no entran en el balance (2).");
    const [first, second] = pendingItems(container);
    expect(first!.getAttribute("data-balance-expense")).toBe(itineraryId(41));
    expect(first!.getAttribute("tabindex")).toBe("-1");
    expect(first!.textContent).toContain("Cena en el puerto"); expect(first!.textContent).toContain("ARS 123,45");
    expect(first!.textContent).toContain("Falta el reparto"); expect(first!.textContent).toContain("Los pagos no cubren el total");
    expect(second!.textContent).toContain("Recuerdo sin texto"); expect(second!.textContent).toContain("30,00 (moneda sin indicar)");
    expect(second!.textContent).not.toContain("ARS 30,00");
  });
  it("says when the amount is not available", async () => {
    const { container } = await render(withPending(pending(1, ["invalid_rules"], { totalCents: null })));
    expect(pendingItems(container)[0]!.textContent).toContain("Importe no disponible");
    expect(pendingItems(container)[0]!.textContent).toContain("revisalos en el recuerdo");
  });
  it("identifies the former members of an expense with the same numbering as the balances", async () => {
    const other = itineraryId(23);
    const { container } = await render(withPending(pending(1, ["missing_shares"], { formerMemberIds: [other, gone] })));
    expect(pendingItems(container)[0]!.textContent).toContain("Incluye a ex integrantes: Ex integrante 2, Ex integrante 1");
  });
  it("offers the payments and shares editor for those reasons and the currency selector for a missing currency", async () => {
    const { container } = await render(withPending(pending(1, ["missing_payments"]), pending(2, ["missing_currency"], { currency: null }), pending(3, ["invalid_rules"]), pending(4, ["missing_currency", "missing_shares"], { currency: null })));
    const labels = pendingItems(container).map((item) => Array.from(item.querySelectorAll("a")).map((anchor) => anchor.textContent));
    expect(labels).toEqual([["Completar pagos y reparto"], ["Elegir moneda"], ["Completar pagos y reparto"], ["Completar pagos y reparto", "Elegir moneda"]]);
  });
  it("opens the editor of that memory remembering the place and the focus", async () => {
    const { container } = await render(withPending(pending(1, ["missing_shares"]), pending(2, ["missing_currency"], { currency: null })));
    const split = pendingItems(container)[0]!.querySelector("a")!;
    expect(split.getAttribute("href")).toBe(`/trips/${tripId}/memories/${itineraryId(61)}/edit`);
    await click(split);
    const shown = container.querySelector('[data-testid="edit"]')!.textContent!;
    expect(shown).toContain(`/trips/${tripId}/memories/${itineraryId(61)}/edit`);
    expect(shown).toContain('"label":"balance"'); expect(shown).toContain(`"anchor":"data-balance-expense=${itineraryId(41)}"`); expect(shown).toContain('"focus":"split"');
  });
  it("sends the currency selector focus for a missing currency", async () => {
    const { container } = await render(withPending(pending(1, ["missing_currency"], { currency: null })));
    await click(pendingItems(container)[0]!.querySelector("a"));
    expect(container.querySelector('[data-testid="edit"]')!.textContent).toContain('"focus":"expense"');
  });
  it("keeps the link when the memory is not in the list or the list fails, without blocking the screen", async () => {
    const failing = await render({ ...withPending(pending(1, ["missing_shares"])), list: vi.fn().mockResolvedValue({ ok: false, error: { kind: "server" } }) });
    expect(failing.container.textContent).toContain("Pesos (ARS)");
    expect(pendingItems(failing.container)[0]!.querySelector("a")?.textContent).toBe("Completar pagos y reparto");
    expect(alerts(failing.container)).toHaveLength(0);
    await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren();
    const missing = await render({ ...withPending(pending(9, ["missing_shares"])) });
    expect(pendingItems(missing.container)[0]!.querySelector("a")?.textContent).toBe("Completar pagos y reparto");
  });
  it("does not ask for memories when nothing is pending", async () => {
    const { list } = await render();
    expect(list).not.toHaveBeenCalled();
  });
  it("shortens a long memory text", async () => {
    const long = "a".repeat(200);
    const { container } = await render({ ...withPending(pending(1, ["missing_shares"])), list: vi.fn().mockResolvedValue(ok([post(1, long)])) });
    expect(pendingItems(container)[0]!.textContent).not.toContain(long);
    expect(pendingItems(container)[0]!.textContent).toContain("aaaa…");
  });
});

describe("TripBalanceScreen: refresh", () => {
  it("refreshing keeps the data on screen and says so", async () => {
    const second = deferred<unknown>();
    const get = vi.fn().mockResolvedValueOnce(ok(balance())).mockReturnValueOnce(second.promise);
    const { container } = await render({ get });
    await click(button(container, "Actualizar balance"));
    expect(container.textContent).toContain("Actualizando balance…");
    expect(container.textContent).toContain("Pesos (ARS)");
    await act(async () => second.resolve(ok(balance({ currencies: [usd()], includedExpenseCount: 1 }))));
    expect(container.textContent).not.toContain("Actualizando balance…");
    expect(container.textContent).not.toContain("Pesos (ARS)");
    expect(container.textContent).toContain("Dólares (USD)");
  });
  it("a failed refresh keeps the data, warns it may be outdated and the button retries", async () => {
    const get = vi.fn().mockResolvedValueOnce(ok(balance())).mockResolvedValueOnce({ ok: false, error: { kind: "network" } }).mockResolvedValueOnce(ok(balance()));
    const { container } = await render({ get });
    await click(button(container, "Actualizar balance"));
    expect(container.textContent).toContain("Pesos (ARS)");
    expect(alerts(container)).toHaveLength(1);
    expect(alerts(container)[0]!.textContent).toBe("No pudimos actualizar el balance. Lo que ves puede estar desactualizado.");
    expect(container.querySelector("[aria-live]")).toBeNull();
    await click(button(container, "Actualizar balance"));
    expect(alerts(container)).toHaveLength(0);
    expect(get).toHaveBeenCalledTimes(3);
  });
  it("a refresh that says the balance is not available replaces the data", async () => {
    const get = vi.fn().mockResolvedValueOnce(ok(balance())).mockResolvedValueOnce({ ok: false, error: { kind: "forbidden" } });
    const { container } = await render({ get });
    await click(button(container, "Actualizar balance"));
    expect(container.textContent).not.toContain("Pesos (ARS)");
    expect(alerts(container)[0]!.textContent).toBe("El balance de este viaje no está disponible para tu cuenta.");
  });
  it("discards an old answer that arrives after a newer one", async () => {
    const first = deferred<unknown>(), second = deferred<unknown>();
    const get = vi.fn().mockResolvedValueOnce(ok(balance())).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { container } = await render({ get });
    await click(button(container, "Actualizar balance"));
    await click(button(container, "Actualizar balance"));
    await act(async () => second.resolve(ok(balance({ currencies: [usd()], includedExpenseCount: 1 }))));
    expect(container.textContent).toContain("Dólares (USD)");
    await act(async () => first.resolve(ok(balance())));
    expect(container.textContent).not.toContain("Pesos (ARS)");
    expect(container.textContent).not.toContain("Actualizando balance…");
  });
  it("refreshes when the window gets the focus again", async () => {
    const get = vi.fn().mockResolvedValue(ok(balance()));
    await render({ get });
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(get).toHaveBeenCalledTimes(2);
  });
  it("does not refresh in the background", async () => {
    const get = vi.fn().mockResolvedValue(ok(balance()));
    await render({ get });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    try { await act(async () => { window.dispatchEvent(new Event("focus")); }); } finally { delete (document as { visibilityState?: unknown }).visibilityState; }
    expect(get).toHaveBeenCalledTimes(1);
  });
  it("stops the periodic refresh when the screen goes away", async () => {
    vi.useFakeTimers();
    const get = vi.fn().mockResolvedValue(ok(balance()));
    await render({ get });
    await act(async () => roots.splice(0).forEach((root) => root.unmount()));
    await act(async () => { await vi.advanceTimersByTimeAsync(300_000); });
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe("TripBalanceScreen: coming back from the editor", () => {
  const withPending = (...items: TripBalance["excludedExpenses"]) => balance({ excludedExpenses: items });
  it("asks for the balance again after saving and the completed expense moves to its currency", async () => {
    const before = withPending(pending(1, ["missing_shares"]));
    const after = balance({ currencies: [{ ...ars(), expenseCount: 3 }, usd()], includedExpenseCount: 4 });
    const get = vi.fn().mockResolvedValueOnce(ok(before)).mockResolvedValueOnce(ok(after));
    const { container } = await render({ get });
    expect(pendingItems(container)).toHaveLength(1);
    expect(section(container, "Pesos (ARS)").textContent).toContain("2 gastos incluidos");
    await click(pendingItems(container)[0]!.querySelector("a"));
    await click(button(container, "Guardar"));
    expect(get).toHaveBeenCalledTimes(2);
    expect(pendingItems(container)).toHaveLength(0);
    expect(container.textContent).not.toContain("Gastos por completar");
    expect(section(container, "Pesos (ARS)").textContent).toContain("3 gastos incluidos");
  });
  it("focuses the expense it came from when it is still pending", async () => {
    const get = vi.fn().mockResolvedValue(ok(withPending(pending(1, ["missing_shares"]), pending(2, ["missing_shares"]))));
    const scroll = vi.fn(); Element.prototype.scrollIntoView = scroll;
    const { container } = await render({ get }, { restore: { anchor: `data-balance-expense=${itineraryId(42)}`, scrollY: 300 } });
    expect(document.activeElement).toBe(pendingItems(container)[1]);
    expect(scroll).toHaveBeenCalled();
  });
  it("falls back to the saved scroll, silently, when the expense is no longer pending", async () => {
    const get = vi.fn().mockResolvedValue(ok(balance()));
    const scrollTo = vi.fn(); window.scrollTo = scrollTo as typeof window.scrollTo;
    const { container } = await render({ get }, { restore: { anchor: `data-balance-expense=${itineraryId(42)}`, scrollY: 300 } });
    expect(scrollTo).toHaveBeenCalledWith(0, 300);
    expect(alerts(container)).toHaveLength(0);
  });
});

beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); window.scrollTo = vi.fn() as typeof window.scrollTo; });
