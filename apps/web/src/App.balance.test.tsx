// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App.js";
import { itineraryFixture, itineraryId } from "./trips/itinerary-test-fixture.js";
import type { TripBalance } from "./trips/trip-balance-api.js";
import type { PostResponse } from "./trips/trip-post-api.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); vi.unstubAllGlobals(); });
const storage = (hasSession: boolean) => ({ read: vi.fn().mockResolvedValue(hasSession ? { accessToken: "old", refreshToken: "refresh" } : null),
  save: vi.fn().mockResolvedValue(undefined), clear: vi.fn().mockResolvedValue(undefined) });
const auth = { refresh: vi.fn().mockResolvedValue({ ok: true, value: { accessToken: "access", refreshToken: "refresh" } }) };
const tripId = itineraryId(1), me = itineraryId(20), beto = itineraryId(21), postId = itineraryId(60), expenseId = itineraryId(41);
const entry = (userId: string, paidCents: number, shareCents: number) => ({ userId, paidCents, shareCents, netCents: paidCents - shareCents, formerMember: false });
const pendingBalance: TripBalance = { tripId, expenseMode: "balance", currencies: [], includedExpenseCount: 0,
  excludedExpenses: [{ expenseId, postId, currency: "ARS", totalCents: 5000, reasons: ["missing_shares"], formerMemberIds: [] }] };
const completeBalance: TripBalance = { tripId, expenseMode: "balance", includedExpenseCount: 1, excludedExpenses: [],
  currencies: [{ currency: "ARS", expenseCount: 1, balances: [entry(me, 5000, 2500), entry(beto, 0, 2500)], settlements: [{ fromUserId: beto, toUserId: me, cents: 2500 }] }] };
const post: PostResponse = { id: postId, tripId, authorId: me, description: "Cena", mapsUrl: null, activityId: null, parentPostId: null, transportId: null, createdAt: "2026-01-02T15:30:00.000Z" };
async function render(path: string, props: ComponentProps<typeof App>) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><App {...props} /></MemoryRouter>));
  return container;
}
const click = async (element: Element | null) => { expect(element).not.toBeNull(); await act(async () => element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }))); };
const link = (container: HTMLElement, text: string) => Array.from(container.querySelectorAll("a")).find((item) => item.textContent === text) ?? null;
const button = (container: HTMLElement, text: string) => Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.trim() === text) ?? null;

describe("App balance route", () => {
  it("shows the balance of the Trip with a session", async () => {
    const get = vi.fn().mockResolvedValue({ ok: true, value: completeBalance });
    const container = await render(`/trips/${tripId}/balance`, { auth, sessionStorage: storage(true), balance: { get }, members: { list: vi.fn().mockResolvedValue({ ok: false, error: { kind: "network" } }) } });
    expect(container.querySelector("h1")?.textContent).toBe("Balance");
    expect(container.textContent).toContain("Pesos (ARS)");
    expect(get).toHaveBeenCalledExactlyOnceWith(tripId);
  });
  it("redirects to login without a session and requests nothing", async () => {
    const get = vi.fn();
    const container = await render(`/trips/${tripId}/balance`, { auth: {}, sessionStorage: storage(false), balance: { get } });
    expect(container.textContent).toContain("Iniciar sesión");
    expect(container.querySelector("h1")?.textContent).not.toBe("Balance");
    expect(get).not.toHaveBeenCalled();
  });
  it("fails as a server error when no balance adapter is wired", async () => {
    const container = await render(`/trips/${tripId}/balance`, { auth, sessionStorage: storage(true) });
    expect(container.textContent).toContain("No pudimos cargar el balance.");
  });
  it("is reached from the itinerary", async () => {
    const container = await render(`/trips/${tripId}/itinerary`, { auth, sessionStorage: storage(true), itinerary: { get: vi.fn().mockResolvedValue({ ok: true, value: itineraryFixture() }) }, balance: { get: vi.fn().mockResolvedValue({ ok: true, value: completeBalance }) } });
    await click(link(container, "Balance"));
    expect(container.querySelector("h1")?.textContent).toBe("Balance");
    await click(link(container, "Volver al itinerario"));
    expect(container.querySelector("main h2")?.textContent).toBe("Itinerario");
  });
  it("leaving the editor with Cancelar comes back to the balance, which is asked for again", async () => {
    const get = vi.fn().mockResolvedValueOnce({ ok: true, value: pendingBalance }).mockResolvedValue({ ok: true, value: completeBalance });
    const postGet = vi.fn().mockResolvedValue({ ok: true, value: { post, parent: null, children: [], rootActivityId: null } });
    const container = await render(`/trips/${tripId}/balance`, { auth, sessionStorage: storage(true), balance: { get },
      posts: { list: vi.fn().mockResolvedValue({ ok: true, value: [post] }), get: postGet },
      members: { list: vi.fn().mockResolvedValue({ ok: false, error: { kind: "network" } }) },
      itinerary: { get: vi.fn().mockResolvedValue({ ok: true, value: itineraryFixture() }) } });
    expect(container.textContent).toContain("Gastos por completar");
    await click(link(container, "Completar pagos y reparto"));
    expect(container.querySelector("h1")?.textContent).toBe("Editar recuerdo");
    expect(document.activeElement).toBe(container.querySelector('button[name="split"]'));
    await click(button(container, "Cancelar"));
    expect(container.querySelector("h1")?.textContent).toBe("Balance");
    expect(get).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Pesos (ARS)");
    expect(container.textContent).not.toContain("Gastos por completar");
  });
  it("completes payments and shares from the balance, saves, and comes back to the balance with the expense complete in its currency", async () => {
    // The itinerary fixture carries an expense of ARS 25.50 in this memory: the composer reads the stored expense from there.
    const expensePostId = itineraryId(10);
    const expensePost = { ...post, id: expensePostId };
    const incomplete: TripBalance = { ...pendingBalance, excludedExpenses: [{ ...pendingBalance.excludedExpenses[0]!, postId: expensePostId, totalCents: 2550, reasons: ["payments_not_covering_total"] }] };
    const stored = { postId: expensePostId, totalAmount: 25.5, currency: "ARS" as const, breakdown: null, payments: [{ userId: me, unit: "amount" as const, value: 10 }],
      shares: [{ userId: me, unit: "remainder" as const, value: null }], completeness: { status: "incomplete" as const, reasons: ["payments_not_covering_total"] }, formerMemberIds: [] };
    const get = vi.fn().mockResolvedValueOnce({ ok: true, value: incomplete }).mockResolvedValue({ ok: true, value: completeBalance });
    const postGet = vi.fn().mockResolvedValue({ ok: true, value: { post: expensePost, parent: null, children: [], rootActivityId: null, expense: stored } });
    const update = vi.fn().mockResolvedValue({ ok: true, value: expensePost });
    const membersList = vi.fn().mockResolvedValue({ ok: true, value: { currentUserId: me, members: [
      { id: itineraryId(100), userId: me, name: "Ana", role: "admin", joinedAt: "2026-01-01T00:00:00.000Z" },
      { id: itineraryId(101), userId: beto, name: "Beto", role: "participant", joinedAt: "2026-01-01T00:00:00.000Z" }] } });
    const container = await render(`/trips/${tripId}/balance`, { auth, sessionStorage: storage(true), balance: { get },
      posts: { list: vi.fn().mockResolvedValue({ ok: true, value: [expensePost] }), get: postGet, update }, members: { list: membersList },
      itinerary: { get: vi.fn().mockResolvedValue({ ok: true, value: itineraryFixture() }) } });
    expect(container.textContent).toContain("Gastos por completar");
    expect(container.textContent).not.toContain("1 gasto incluido");
    await click(link(container, "Completar pagos y reparto"));
    expect(container.querySelector("h1")?.textContent).toBe("Editar recuerdo");
    await click(container.querySelector('button[name="split"]'));
    expect(container.querySelector("h1")?.textContent).toBe("Pagos y reparto");
    const input = container.querySelector<HTMLInputElement>('[data-section="payments"] [data-row] input[inputmode="decimal"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "25,50"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await click(button(container, "Aceptar"));
    expect(container.querySelector("h1")?.textContent).toBe("Editar recuerdo");
    await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(update).toHaveBeenCalledOnce();
    expect(update.mock.calls[0]![0]).toBe(tripId);
    expect(update.mock.calls[0]![1]).toBe(expensePostId);
    expect(update.mock.calls[0]![2]).toEqual({ expense: { payments: [{ userId: me, unit: "amount", value: 25.5 }] } });
    expect(container.querySelector("h1")?.textContent).toBe("Balance");
    expect(get).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Pesos (ARS)");
    expect(container.textContent).toContain("1 gasto incluido");
    expect(container.textContent).not.toContain("Gastos por completar");
  });
  it("an admin goes from the balance to the configuration, changes the mode, saves, goes back and sees the new mode", async () => {
    const registerBalance: TripBalance = { tripId, expenseMode: "register", currencies: [], excludedExpenses: [], includedExpenseCount: 0 };
    const get = vi.fn().mockResolvedValueOnce({ ok: true, value: registerBalance }).mockResolvedValue({ ok: true, value: completeBalance });
    const tripDetail = { kind: "member", id: tripId, name: "Patagonia", description: null, primaryDestination: { name: "Bariloche" }, visibility: "private", expenseMode: "register" };
    const updateConfiguration = vi.fn().mockResolvedValue({ ok: true, value: { ...tripDetail, expenseMode: "balance" } });
    const members = { list: vi.fn().mockResolvedValue({ ok: true, value: { currentUserId: me, ownerId: me, members: [
      { id: itineraryId(100), userId: me, name: "Ana", role: "admin", isOwner: true, joinedAt: "2026-01-01T00:00:00.000Z" }] } }) };
    let back: () => void = () => undefined;
    function BackHandle() { const navigate = useNavigate(); back = () => navigate(-1); return null; }
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container); roots.push(root);
    await act(async () => root.render(<MemoryRouter initialEntries={[`/trips/${tripId}/balance`]}><BackHandle />
      <App auth={auth} sessionStorage={storage(true)} balance={{ get }} members={members as never} trips={{ get: vi.fn().mockResolvedValue({ ok: true, value: tripDetail }), updateConfiguration } as never} /></MemoryRouter>));
    expect(container.textContent).toContain("modo registro");
    await click(link(container, "Configurar modo de gastos"));
    expect(container.querySelector("h1")?.textContent).toBe("Configuración del viaje");
    await act(async () => {
      const select = container.querySelector('[name="expenseMode"]') as HTMLSelectElement;
      select.value = "balance";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(updateConfiguration).toHaveBeenCalledExactlyOnceWith(tripId, { expenseMode: "balance" });
    await act(async () => back());
    expect(container.querySelector("h1")?.textContent).toBe("Balance");
    expect(get).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Pesos (ARS)");
    expect(container.textContent).not.toContain("modo registro");
  });
});
