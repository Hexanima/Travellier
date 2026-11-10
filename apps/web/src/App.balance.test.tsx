// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
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
    expect(container.querySelector("h1")?.textContent).toBe("Itinerario");
  });
  it("completes a pending expense from the balance and comes back to the updated balance without losing the origin", async () => {
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
});
