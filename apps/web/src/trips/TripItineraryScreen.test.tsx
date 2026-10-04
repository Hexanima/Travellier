// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { itineraryFixture, itineraryId } from "./itinerary-test-fixture.js";
import type { TripItineraryApi, TripItineraryResponse } from "./trip-itinerary-api.js";
import { TripItineraryScreen } from "./TripItineraryScreen.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
const fixture = () => itineraryFixture() as TripItineraryResponse;
async function render(get = vi.fn().mockResolvedValue({ ok: true, value: fixture() }), timeZone = "America/Argentina/Buenos_Aires") {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={[`/trips/${itineraryId(1)}/itinerary`]}>
    <Link to={`/trips/${itineraryId(99)}/itinerary`}>Otro viaje</Link>
    <Routes><Route path="/trips/:tripId/itinerary" element={<TripItineraryScreen itinerary={{ get } as TripItineraryApi}
      timeZone={timeZone} />} /></Routes>
  </MemoryRouter>));
  return { container, get };
}
const clickText = async (container: HTMLElement, text: string) => act(async () => {
  Array.from(container.querySelectorAll("button,a")).find((item) => item.textContent === text)?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
});

describe("itinerary screen", () => {
  it("renders mixed bands under one local date with activities and posts in chronological order", async () => {
    const { container, get } = await render();
    expect(get).toHaveBeenCalledExactlyOnceWith(itineraryId(1));
    expect(container.querySelectorAll('[data-itinerary-date="2026-09-25"]')).toHaveLength(1);
    expect(container.textContent).toContain("Tránsito de ida"); expect(container.textContent).toContain("Tránsito de vuelta");
    expect(container.querySelectorAll('[data-itinerary-kind="activity"]')).toHaveLength(1);
    expect(Array.from(container.querySelectorAll('[data-itinerary-kind="activity"] [data-itinerary-item]')).map((item) => item.getAttribute("data-itinerary-item")))
      .toEqual([itineraryId(8), itineraryId(10), itineraryId(9)]);
    expect(container.querySelector(`time[datetime="2026-09-25T12:00:00.123Z"]`)?.textContent).toBe("09:00");
    expect(container.textContent).toContain("En camino");
    expect(container.querySelector('[data-itinerary-expenses]')?.textContent).toContain("25,5");
    expect(container.querySelector('[data-itinerary-expenses]')?.textContent).not.toContain("999");
  });
  it.each([
    ["register", 0.1, 0.2, "0,3", "0,1"],
    ["balance", 0.1, 0.2, "0,3", "0,1"],
    ["register", 10.005, 0, "10,01", "10,01"],
    ["balance", 10.005, 0, "10,01", "10,01"],
    ["register", 1234.56, 0.01, "1.234,57", "1.234,56"],
    ["balance", 1234.56, 0.01, "1.234,57", "1.234,56"],
  ] as const)("formats daily expenses without floating point artifacts in %s: %s + %s", async (expenseMode, first, second, expectedTotal, expectedPost) => {
    const value = fixture(); value.expenseMode = expenseMode;
    value.posts[0].expense!.totalAmount = first;
    value.posts[1].expense = { ...value.posts[0].expense!, id: itineraryId(30), postId: value.posts[1].id, totalAmount: second };
    const before = JSON.stringify(value);
    const { container } = await render(vi.fn().mockResolvedValue({ ok: true, value }));
    expect(container.querySelector('[data-itinerary-expenses] .itinerary-expense-total strong')?.textContent).toBe(expectedTotal);
    expect(container.querySelector('[data-itinerary-expenses] .itinerary-expense-total span')?.textContent).toBe("2 gastos registrados");
    expect(container.querySelector(`[data-itinerary-post="${value.posts[0].id}"] .itinerary-post-expense strong`)?.textContent).toBe(`Gasto: ${expectedPost}`);
    expect(JSON.stringify(value)).toBe(before);
  });
  it("shows activity posts in context once with their own UTC publication instant and expense", async () => {
    const value = fixture(); value.posts[0].activityId = itineraryId(8); value.posts[0].transportId = itineraryId(6);
    value.activities[0].postIds = [itineraryId(10)]; value.transports[0].postIds.push(itineraryId(10));
    const { container } = await render(vi.fn().mockResolvedValue({ ok: true, value }));
    expect(container.querySelectorAll(`[data-itinerary-post="${itineraryId(10)}"]`)).toHaveLength(1);
    expect(container.querySelector(`[data-itinerary-item="${itineraryId(8)}"]`)?.textContent).toContain("Almuerzo junto al río");
    expect(container.querySelector(`[data-itinerary-post="${itineraryId(10)}"] time`)?.getAttribute("datetime")).toBe(value.posts[0].createdAt);
  });
  it.each(["UTC", "America/Argentina/Buenos_Aires"])("renders a daily chronological agenda while preserving a late transit post's band in %s", async (timeZone) => {
    const value = fixture(); value.posts[1].createdAt = value.posts[0].createdAt;
    const { container } = await render(vi.fn().mockResolvedValue({ ok: true, value }), timeZone);
    const day = container.querySelector('[data-itinerary-date="2026-09-25"]');
    expect(Array.from(day!.querySelectorAll('[data-itinerary-item]')).map((item) => item.getAttribute("data-itinerary-item")))
      .toEqual([6, 8, 10, 11, 9, 7].map(itineraryId));
    const post = day?.querySelector(`[data-itinerary-post="${itineraryId(11)}"]`);
    expect(post?.closest('[data-itinerary-kind]')?.getAttribute("data-itinerary-kind")).toBe("transit_out");
    expect(post?.textContent).toContain("Vinculado a transporte");
    expect(container.querySelectorAll(`[data-itinerary-post="${itineraryId(11)}"]`)).toHaveLength(1);
    const labels = Array.from(day!.querySelectorAll('[aria-labelledby]')).map((node) => node.getAttribute("aria-labelledby"));
    expect(labels.every((label) => container.querySelectorAll(`[id="${label}"]`).length === 1)).toBe(true);
  });
  it("shows a late post and its expense once when its canonical day splits across local dates", async () => {
    const value = fixture();
    value.days = [{ ...value.days[1], startsAt: "2026-09-25T00:00:00.123Z", endsAt: "2026-09-25T08:00:00.456Z", items: [] }];
    value.activities = []; value.transports = []; value.posts = [value.posts[0]];
    value.posts[0].createdAt = "2026-10-03T12:00:00.789Z";
    const { container } = await render(vi.fn().mockResolvedValue({ ok: true, value }));
    expect(container.querySelectorAll(`[data-itinerary-post="${value.posts[0].id}"]`)).toHaveLength(1);
    const day = container.querySelector('[data-itinerary-date="2026-09-24"]');
    expect(day?.textContent).toContain("Almuerzo junto al río");
    expect(day?.querySelector('[data-itinerary-expenses]')?.textContent).toContain("25,5");
    expect(container.querySelector('[data-itinerary-date="2026-09-25"] [data-itinerary-expenses]')?.textContent).toContain("Sin gastos registrados.");
    expect(day?.querySelector(`[data-itinerary-post="${value.posts[0].id}"] time`)?.getAttribute("datetime")).toBe(value.posts[0].createdAt);
  });
  it.each(["UTC", "America/Argentina/Buenos_Aires"])("shows a linked post under its activity across canonical days in %s", async (timeZone) => {
    const value = fixture();
    value.days = [
      { ...value.days[1], date: "2026-09-24T00:00:00.000Z", startsAt: "2026-09-24T22:00:00.000Z", endsAt: "2026-09-25T00:00:00.000Z", items: [] },
      { ...value.days[1], id: itineraryId(30), startsAt: "2026-09-25T00:00:00.000Z", endsAt: "2026-09-25T03:00:00.000Z", items: [] },
    ];
    value.transports = []; value.activities = [value.activities[0]]; value.posts = [value.posts[0]];
    value.activities[0].scheduledAt = "2026-09-24T23:00:00.000Z"; value.activities[0].postIds = [value.posts[0].id];
    value.posts[0].dayId = itineraryId(30); value.posts[0].activityId = value.activities[0].id;
    value.posts[0].createdAt = "2026-09-25T01:00:00.000Z";
    const { container } = await render(vi.fn().mockResolvedValue({ ok: true, value }), timeZone);
    const postSelector = `[data-itinerary-post="${value.posts[0].id}"]`;
    expect(container.querySelectorAll(postSelector)).toHaveLength(1);
    expect(container.querySelector(`[data-itinerary-item="${value.activities[0].id}"] ${postSelector}`)).not.toBeNull();
    expect(container.querySelector(`[data-itinerary-date="${timeZone === "UTC" ? "2026-09-25" : "2026-09-24"}"] [data-itinerary-expenses]`)?.textContent).toContain("25,5");
    if (timeZone === "UTC") expect(container.querySelector('[data-itinerary-date="2026-09-24"] [data-itinerary-expenses]')?.textContent).toContain("Sin gastos registrados.");
  });
  it("shows the empty state and a link to configuring transport", async () => {
    const value = { ...fixture(), days: [], activities: [], posts: [], transports: [] };
    const { container } = await render(vi.fn().mockResolvedValue({ ok: true, value }));
    expect(container.textContent).toContain("Todavía no hay itinerario");
    expect(container.querySelector(`a[href="/trips/${itineraryId(1)}/journey"]`)).not.toBeNull();
  });
  it("shows loading until the aggregate resolves", async () => {
    let resolve: (value: unknown) => void = () => undefined;
    const { container } = await render(vi.fn(() => new Promise((done) => { resolve = done; })));
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Cargando itinerario");
    await act(async () => resolve({ ok: true, value: fixture() }));
    expect(container.textContent).toContain("Paseo por el centro");
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });
  it("retries a failed request without showing stale content", async () => {
    const get = vi.fn().mockResolvedValueOnce({ ok: false, error: { kind: "network" } }).mockResolvedValueOnce({ ok: true, value: fixture() });
    const { container } = await render(get);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("No pudimos cargar");
    await clickText(container, "Reintentar");
    expect(get).toHaveBeenCalledTimes(2); expect(container.textContent).toContain("Paseo por el centro");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it.each(["not-found", "forbidden"])("hides private content and actions after %s", async (kind) => {
    const { container } = await render(vi.fn().mockResolvedValue({ ok: false, error: { kind } }));
    expect(container.textContent).toContain("no está disponible");
    expect(container.querySelector('[data-itinerary-date]')).toBeNull();
    expect(container.querySelector('a[href$="/journey"]')).toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });
  it("clears the old Trip immediately and ignores a late response after navigation", async () => {
    let resolve: (value: unknown) => void = () => undefined;
    const get = vi.fn().mockImplementationOnce(() => new Promise((done) => { resolve = done; }))
      .mockResolvedValueOnce({ ok: false, error: { kind: "not-found" } });
    const { container } = await render(get);
    await clickText(container, "Otro viaje");
    await act(async () => resolve({ ok: true, value: fixture() }));
    expect(get).toHaveBeenLastCalledWith(itineraryId(99));
    expect(container.textContent).not.toContain("Paseo por el centro");
    expect(container.textContent).toContain("no está disponible");
  });
});
