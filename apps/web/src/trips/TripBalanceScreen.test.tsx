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
function TripsStub() { const location = useLocation(); return <p data-testid="trips">MIS VIAJES {JSON.stringify(location.state)}</p>; }
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
    <Route path="/trips" element={<TripsStub />} />
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
    expect(container.querySelector("[aria-live]:not(.pull-to-refresh__status)")).toBeNull();
    await click(button(container, "Reintentar"));
    expect(container.textContent).toContain("Pesos (ARS)");
    expect(alerts(container)).toHaveLength(0);
  });
  it("a timeout has its own text, still with retry", async () => {
    const get = vi.fn().mockResolvedValueOnce({ ok: false, error: { kind: "network", code: "TimeoutError" } }).mockResolvedValueOnce(ok(balance()));
    const { container } = await render({ get });
    expect(alerts(container)[0]!.textContent).toBe("La conexión tardó demasiado. Intentá nuevamente.");
    await click(button(container, "Reintentar"));
    expect(container.textContent).toContain("Pesos (ARS)");
  });
  it("a dropped connection keeps the usual text", async () => {
    const get = vi.fn().mockResolvedValue({ ok: false, error: { kind: "network", code: "NetworkError" } });
    const { container } = await render({ get });
    expect(alerts(container)[0]!.textContent).toBe("No pudimos cargar el balance. Revisá tu conexión e intentá nuevamente.");
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
  it("shows no debts, explains it and keeps the way to the expenses; it asks for the role only, no memories", async () => {
    const { container, list, membersList } = await render({ get: vi.fn().mockResolvedValue(ok(register)) });
    expect(container.textContent).toContain("Este viaje está en modo registro: no se calculan deudas ni compensaciones. Los gastos siguen registrados en cada recuerdo.");
    expect(link(container, "Ver gastos del viaje")?.getAttribute("href")).toBe(`/trips/${tripId}/itinerary`);
    expect(link(container, "Ver recuerdos")?.getAttribute("href")).toBe(`/trips/${tripId}/memories`);
    expect(container.querySelector("h2")).toBeNull();
    expect(container.textContent).not.toContain("Saldos por persona y moneda");
    expect(container.textContent).not.toMatch(/Gastos por completar|Compensaciones|Tiene a favor|Debe /);
    expect(list).not.toHaveBeenCalled(); expect(membersList).toHaveBeenCalledExactlyOnceWith(tripId);
  });
  it("renders no balance even if the data carried some", async () => {
    const odd = { ...register, currencies: [ars()], excludedExpenses: [pending(1, ["missing_shares"])], includedExpenseCount: 2 };
    const { container, list } = await render({ get: vi.fn().mockResolvedValue(ok(odd)) });
    expect(container.textContent).not.toMatch(/Pesos|Tiene a favor|Debe |le debe |Gastos por completar|ARS/);
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
  it("explains the balances in the subtitle in balance mode", async () => {
    const { container } = await render();
    expect(container.querySelector("header p")?.textContent).toBe("Saldos por persona y moneda, según los gastos completos del viaje.");
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
  it("a member named «Vos» is not the viewer: no voseo for them and the label is told apart", async () => {
    const named = vi.fn().mockResolvedValue({ ok: true, value: { currentUserId: me, members: [
      { id: itineraryId(100), userId: me, name: "Ana", role: "admin", joinedAt: "2026-01-01T00:00:00.000Z" }, { id: itineraryId(101), userId: beto, name: "Vos", role: "participant", joinedAt: "2026-01-01T00:00:00.000Z" }] } });
    const { container } = await render({ members: named });
    const ars = section(container, "Pesos (ARS)").textContent ?? "", usd = section(container, "Dólares (USD)").textContent ?? "";
    expect(ars).toContain("Vos (integrante) te debe ARS 10,00");
    expect(usd).toContain("Vos le debés USD 5,00 a Vos (integrante)");
    expect(ars).not.toMatch(/(^|[^(])Vos te debe/);
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
    expect(ars.textContent).toContain("Beto te debe ARS 10,00");
    expect(ars.textContent).toContain("Ex integrante 1 te debe ARS 10,00");
    expect(section(container, "Dólares (USD)").textContent).toContain("Vos le debés USD 5,00 a Beto");
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
    expect(container.querySelector("[aria-live]:not(.pull-to-refresh__status)")).toBeNull();
    await click(button(container, "Actualizar balance"));
    expect(alerts(container)).toHaveLength(0);
    expect(get).toHaveBeenCalledTimes(3);
  });
  it("un timeout al actualizar el balance tiene su propio texto y conserva la advertencia (T150)", async () => {
    const get = vi.fn().mockResolvedValueOnce(ok(balance())).mockResolvedValueOnce({ ok: false, error: { kind: "network", code: "TimeoutError" } });
    const { container } = await render({ get });
    await click(button(container, "Actualizar balance"));
    expect(alerts(container)[0]!.textContent).toBe("La conexión tardó demasiado. Intentá nuevamente. Lo que ves puede estar desactualizado.");
    expect(container.textContent).toContain("Pesos (ARS)");
  });
  it("una conexión caída al actualizar el balance conserva el texto de siempre (T150)", async () => {
    const get = vi.fn().mockResolvedValueOnce(ok(balance())).mockResolvedValueOnce({ ok: false, error: { kind: "network", code: "NetworkError" } });
    const { container } = await render({ get });
    await click(button(container, "Actualizar balance"));
    expect(alerts(container)[0]!.textContent).toBe("No pudimos actualizar el balance. Lo que ves puede estar desactualizado.");
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
  it("the automatic refresh is silent: no status, no busy state and the data stays as is until the answer", async () => {
    const second = deferred<unknown>();
    const get = vi.fn().mockResolvedValueOnce(ok(balance())).mockReturnValueOnce(second.promise);
    const { container } = await render({ get });
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(get).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain("Actualizando balance…");
    expect(container.querySelector('[role="status"]:not(.pull-to-refresh__status)')).toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(container.textContent).toContain("Pesos (ARS)");
    await act(async () => second.resolve(ok(balance({ currencies: [usd()], includedExpenseCount: 1 }))));
    expect(container.querySelector('[role="status"]:not(.pull-to-refresh__status)')).toBeNull();
    expect(container.textContent).not.toContain("Pesos (ARS)");
    expect(container.textContent).toContain("Dólares (USD)");
  });
  it("the periodic refresh is silent too", async () => {
    vi.useFakeTimers();
    const second = deferred<unknown>();
    const get = vi.fn().mockResolvedValueOnce(ok(balance())).mockReturnValueOnce(second.promise);
    const { container } = await render({ get });
    await act(async () => { await vi.advanceTimersByTimeAsync(45_000); });
    expect(get).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="status"]:not(.pull-to-refresh__status)')).toBeNull();
    await act(async () => second.resolve(ok(balance())));
  });
  it("a failed automatic refresh keeps the data and shows the single outdated warning", async () => {
    const get = vi.fn().mockResolvedValueOnce(ok(balance())).mockResolvedValueOnce({ ok: false, error: { kind: "network" } });
    const { container } = await render({ get });
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(container.textContent).toContain("Pesos (ARS)");
    expect(container.querySelector('[role="status"]:not(.pull-to-refresh__status)')).toBeNull();
    expect(alerts(container)).toHaveLength(1);
    expect(alerts(container)[0]!.textContent).toBe("No pudimos actualizar el balance. Lo que ves puede estar desactualizado.");
  });
  it.each(["forbidden", "not-found"])("an automatic refresh that loses access (%s) goes to Mis viajes with the generic mark and no balance on screen", async (kind) => {
    const get = vi.fn().mockResolvedValueOnce(ok(balance())).mockResolvedValueOnce({ ok: false, error: { kind } });
    const { container } = await render({ get });
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    // La salida reemplaza la entrada del balance: sin historial detrás hereda `noBack`, para que el Atrás no quede muerto sobre Mis viajes.
    expect(container.querySelector('[data-testid="trips"]')?.textContent).toBe('MIS VIAJES {"tripGone":true,"noBack":true}');
    expect(container.textContent).not.toContain("Pesos (ARS)");
  });
  it("a pull down at the top refreshes the balance (the «Actualizar balance» button stays as the alternative)", async () => {
    Object.defineProperty(window, "scrollY", { configurable: true, writable: true, value: 0 });
    const get = vi.fn().mockResolvedValue(ok(balance()));
    const { container } = await render({ get });
    const touch = (type: string, y?: number) => act(async () => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "touches", { value: y === undefined ? [] : [{ clientY: y, clientX: 0 }] });
      container.querySelector("h1")!.dispatchEvent(event);
    });
    await touch("touchstart", 100); await touch("touchmove", 200); await touch("touchend");
    expect(get).toHaveBeenCalledTimes(2);
    expect(button(container, "Actualizar balance")).toBeDefined();
  });
  it("the manual refresh does show the status while it runs", async () => {
    const second = deferred<unknown>();
    const get = vi.fn().mockResolvedValueOnce(ok(balance())).mockReturnValueOnce(second.promise);
    const { container } = await render({ get });
    await click(button(container, "Actualizar balance"));
    expect(container.querySelector('[role="status"]:not(.pull-to-refresh__status)')).not.toBeNull();
    await act(async () => second.resolve(ok(balance())));
    expect(container.querySelector('[role="status"]:not(.pull-to-refresh__status)')).toBeNull();
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

describe("TripBalanceScreen: presentation hooks", () => {
  it("marks the screen and each currency apart, without a total or a conversion", async () => {
    const { container } = await render();
    expect(container.querySelector("main")?.classList.contains("trip-balance")).toBe(true);
    expect(Array.from(container.querySelectorAll(".balance-currency h2")).map((item) => item.textContent)).toEqual(["Pesos (ARS)", "Dólares (USD)"]);
    expect(container.textContent).not.toMatch(/Total|conversi|cotizaci/i);
  });
  it("keeps the text of each balance row and hooks data-net as credit, debit or even only as a style hook", async () => {
    const even = { currency: "EUR" as const, expenseCount: 1, balances: [entry(me, 500, 500), entry(beto, 500, 500)], settlements: [] };
    const { container } = await render({ get: vi.fn().mockResolvedValue(ok(balance({ currencies: [ars(), even] }))) });
    const nets = (title: string) => Array.from(section(container, title).querySelectorAll<HTMLElement>("[data-net]")).map((item) => item.getAttribute("data-net"));
    expect(nets("Pesos (ARS)")).toEqual(["credit", "debit", "debit"]);
    expect(nets("Euros (EUR)")).toEqual(["even", "even"]);
    const first = section(container, "Pesos (ARS)").querySelector<HTMLElement>("[data-net]")!;
    expect(first.textContent).toBe("Vos: Tiene a favor ARS 20,00Pagó ARS 30,00 · Le correspondía ARS 10,00");
    expect(section(container, "Euros (EUR)").textContent).toContain("Sin saldo pendiente");
  });
  it("keeps the settlements, the pending expenses and the fixed notice free of paid/collected language", async () => {
    const withPending = balance({ excludedExpenses: [pending(1, ["missing_shares"], { formerMemberIds: [gone] })] });
    const { container } = await render({ get: vi.fn().mockResolvedValue(ok(withPending)) });
    expect(container.querySelectorAll(".balance-settlement").length).toBe(3);
    expect(container.querySelector("#balance-pending")?.closest("section")?.classList.contains("balance-pending")).toBe(true);
    const item = pendingItems(container)[0]!;
    expect(item.getAttribute("data-balance-expense")).toBe(itineraryId(41));
    expect(item.textContent).toContain("Completar pagos y reparto");
    expect(item.textContent).toContain("Ex integrante 1");
    expect(container.textContent).toContain("Las compensaciones son sugerencias: la app no registra transferencias ni cobros.");
    expect(container.textContent).not.toMatch(forbidden);
  });
  it("the refresh button is secondary", async () => {
    const { container } = await render();
    expect(button(container, "Actualizar balance")?.classList.contains("ui-button--secondary")).toBe(true);
  });
  it("el vacío del modo registro ofrece un primario y un secundario, no dos enlaces pelados (T153)", async () => {
    const { container } = await render({ get: vi.fn().mockResolvedValue(ok(register)) });
    const expenses = link(container, "Ver gastos del viaje")!;
    const memories = link(container, "Ver recuerdos")!;
    // La acción principal es ver los gastos registrados; ver recuerdos la acompaña como secundaria.
    expect(expenses.classList.contains("ui-button")).toBe(true);
    expect(expenses.classList.contains("ui-button--secondary")).toBe(false);
    expect(memories.classList.contains("ui-button")).toBe(true);
    expect(memories.classList.contains("ui-button--secondary")).toBe(true);
    expect(expenses.closest(".trips-empty")).toBe(memories.closest(".trips-empty"));
  });
  it("el vacío sin gastos completos ofrece la creación como botón primario (T153)", async () => {
    const empty = balance({ currencies: [], includedExpenseCount: 0 });
    const { container } = await render({ get: vi.fn().mockResolvedValue(ok(empty)) });
    const action = link(container, "Nuevo recuerdo")!;
    expect(action.closest(".trips-empty")).not.toBeNull();
    expect(action.classList.contains("ui-button")).toBe(true);
    expect(action.classList.contains("ui-button--secondary")).toBe(false);
  });
  it("register mode keeps its links without balance sections", async () => {
    const { container } = await render({ get: vi.fn().mockResolvedValue(ok(register)) });
    expect(container.querySelector(".balance-currency")).toBeNull();
    expect(link(container, "Ver gastos del viaje")).toBeTruthy();
  });
});

beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); window.scrollTo = vi.fn() as typeof window.scrollTo; });

const asRole = (role: "admin" | "participant") => vi.fn().mockResolvedValue({ ok: true, value: { currentUserId: me, members: [
  { id: itineraryId(100), userId: me, name: "Ana", role, joinedAt: "2026-01-01T00:00:00.000Z" }] } });
const configLink = (container: ParentNode) => link(container, "Configurar modo de gastos");

describe("TripBalanceScreen: access to the expense-mode configuration", () => {
  it.each([["balance", ok(balance())], ["register", ok(register)]] as const)("an admin sees the way to the configuration in %s mode", async (_mode, answer) => {
    const { container } = await render({ get: vi.fn().mockResolvedValue(answer), members: asRole("admin") });
    const settings = configLink(container);
    expect(settings?.getAttribute("href")).toBe(`/trips/${tripId}/config`);
    expect(settings?.className).toContain("trips-settings-link");
    expect(settings?.closest(".balance-refresh")).not.toBeNull();
  });
  it.each([["balance", ok(balance())], ["register", ok(register)]] as const)("a participant sees no way to the configuration in %s mode", async (_mode, answer) => {
    const { container } = await render({ get: vi.fn().mockResolvedValue(answer), members: asRole("participant") });
    expect(configLink(container)).toBeUndefined();
  });
  it.each([["balance", ok(balance())], ["register", ok(register)]] as const)("an unknown role (members fail) shows no link and does not break the %s balance", async (mode, answer) => {
    const { container } = await render({ get: vi.fn().mockResolvedValue(answer), members: vi.fn().mockResolvedValue({ ok: false, error: { kind: "network" } }) });
    expect(configLink(container)).toBeUndefined();
    expect(alerts(container)).toHaveLength(0);
    expect(container.textContent).toContain(mode === "balance" ? "Pesos (ARS)" : "modo registro");
  });
  it("the refresh passes to the new mode and evaluates role and link again", async () => {
    const get = vi.fn().mockResolvedValueOnce(ok(balance())).mockResolvedValue(ok(register));
    const membersList = vi.fn().mockResolvedValueOnce((await asRole("admin")()))
      .mockResolvedValue(await asRole("participant")());
    const { container } = await render({ get, members: membersList });
    expect(configLink(container)).toBeDefined();
    expect(container.textContent).toContain("Pesos (ARS)");
    await click(button(container, "Actualizar balance"));
    expect(get).toHaveBeenCalledTimes(2);
    expect(membersList).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("modo registro");
    expect(configLink(container)).toBeUndefined();
  });
  it("the automatic refresh also evaluates the new mode and the role", async () => {
    const get = vi.fn().mockResolvedValueOnce(ok(register)).mockResolvedValue(ok(balance()));
    const membersList = vi.fn().mockResolvedValueOnce(await asRole("participant")()).mockResolvedValue(await asRole("admin")());
    const { container } = await render({ get, members: membersList });
    expect(configLink(container)).toBeUndefined();
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(container.textContent).toContain("Pesos (ARS)");
    expect(configLink(container)).toBeDefined();
  });
  it("never uses the forbidden wording", async () => {
    const { container } = await render({ get: vi.fn().mockResolvedValue(ok(register)), members: asRole("admin") });
    expect(container.textContent).not.toMatch(forbidden);
  });
});
