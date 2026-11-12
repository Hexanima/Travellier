// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { itineraryFixture, itineraryId, linkPost, settleItinerary, throughClientValidator, withUnindicatedTransportCost } from "./itinerary-test-fixture.js";
import type { TripItineraryApi, TripItineraryResponse } from "./trip-itinerary-api.js";
import { TripItineraryScreen } from "./TripItineraryScreen.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach((root) => root.unmount())); document.body.replaceChildren(); });
const BA = "America/Argentina/Buenos_Aires";
const fixture = () => itineraryFixture() as TripItineraryResponse;
async function render(value: TripItineraryResponse, timeZone = BA) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<MemoryRouter initialEntries={[`/trips/${itineraryId(1)}/itinerary`]}>
    <Routes><Route path="/trips/:tripId/itinerary" element={<TripItineraryScreen itinerary={{ get: vi.fn().mockResolvedValue({ ok: true, value }) } as TripItineraryApi} timeZone={timeZone} />} /></Routes>
  </MemoryRouter>));
  return container;
}
const second = (value: TripItineraryResponse, n: number, extra: Partial<NonNullable<TripItineraryResponse["posts"][number]["expense"]>>, createdAt = "2026-09-25T14:30:00.000Z") => {
  const post = { ...fixture().posts[0], id: itineraryId(n), description: "Taxi", createdAt, expense: { ...fixture().posts[0].expense!, id: itineraryId(n + 100), postId: itineraryId(n), ...extra } };
  value.posts.push(post);
  return post;
};
const tripSection = (container: HTMLElement) => container.querySelector('section[aria-labelledby="itinerary-trip-expenses"]');
const outsideSection = (container: HTMLElement) => container.querySelector<HTMLElement>('section[aria-labelledby="itinerary-outside-expenses"]');
const dayExpenses = (container: HTMLElement) => container.querySelector('[data-itinerary-date="2026-09-25"] [data-itinerary-expenses]')!;
const click = async (element: Element | null | undefined) => { expect(element).toBeTruthy(); await act(async () => element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))); };
const button = (container: ParentNode, prefix: string) => Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.startsWith(prefix));

describe("itinerary screen expenses", () => {
  it("summarizes the Trip by currency at the top and offers no outside shortcut when nothing is outside", async () => {
    const container = await render(fixture());
    expect(tripSection(container)?.querySelector("h2")?.textContent).toBe("Gastos del viaje");
    expect(tripSection(container)?.textContent).toContain("ARS 25,50 · 1 gasto");
    expect(button(container, "Ver gastos fuera del itinerario")).toBeUndefined();
    expect(outsideSection(container)).toBeNull();
  });
  it("shows no Trip expenses section without expenses, and the day says so", async () => {
    const value = fixture(); value.posts[0].expense = null;
    const container = await render(value);
    expect(tripSection(container)).toBeNull();
    expect(dayExpenses(container).textContent).toContain("Sin gastos registrados.");
  });
  it("keeps currencies apart in the Trip and in the day, one line each, in ARS, EUR, USD order", async () => {
    const value = fixture();
    value.posts[0].expense!.currency = "USD";
    second(value, 41, { totalAmount: 10.5, currency: "ARS" });
    second(value, 42, { totalAmount: 3, currency: "ARS" });
    second(value, 43, { totalAmount: 2, currency: "EUR" });
    const container = await render(value);
    for (const scope of [tripSection(container)!, dayExpenses(container)]) {
      expect(Array.from(scope.querySelectorAll("[data-expense-currency]")).map((line) => line.textContent))
        .toEqual(["ARS 13,50 · 2 gastos", "EUR 2,00 · 1 gasto", "USD 25,50 · 1 gasto"]);
    }
  });
  it("counts an expense without currency apart and shows its amount flagged, never summing or assuming ARS", async () => {
    const value = fixture();
    value.posts[0].expense!.currency = null;
    const container = await render(value);
    expect(tripSection(container)?.textContent).toContain("1 gasto sin moneda indicada (no se suman)");
    expect(tripSection(container)?.querySelector("[data-expense-currency]")).toBeNull();
    expect(dayExpenses(container).textContent).toContain("1 gasto sin moneda indicada (no se suman)");
    expect(container.querySelector(`[data-itinerary-post="${itineraryId(10)}"] .itinerary-post-expense strong`)?.textContent).toBe("Gasto: 25,50 (moneda sin indicar)");
  });
  it("labels an amount that cannot be represented as invalid, not as a missing currency, and never sums it", async () => {
    const value = fixture();
    value.posts[0].expense!.totalAmount = -5;
    const container = await render(value);
    expect(tripSection(container)?.textContent).toContain("1 gasto con importe no válido (no se suman)");
    expect(tripSection(container)?.textContent).not.toContain("sin moneda");
    expect(tripSection(container)?.querySelector("[data-expense-currency]")).toBeNull();
    expect(dayExpenses(container).textContent).toContain("1 gasto con importe no válido (no se suman)");
    expect(container.querySelector(`[data-itinerary-post="${itineraryId(10)}"] .itinerary-post-expense strong`)?.textContent).toBe("Gasto: importe no válido (ARS)");
  });
  it("lists the expenses outside the itinerary with a link to the post and moves the focus there from the Trip summary", async () => {
    const value = fixture();
    value.posts[0].createdAt = "2026-10-03T12:00:00.789Z";
    value.posts[0].expense!.currency = "EUR";
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const container = await render(value);
    expect(tripSection(container)?.textContent).toContain("EUR 25,50 · 1 gasto");
    const section = outsideSection(container)!;
    expect(section.querySelector("h2")?.textContent).toBe("Gastos fuera del itinerario");
    const item = section.querySelector(`[data-outside-expense="${itineraryId(10)}"]`)!;
    expect(item.querySelector("a")?.getAttribute("href")).toBe(`/trips/${itineraryId(1)}/memories/${itineraryId(10)}`);
    expect(item.textContent).toContain("Almuerzo junto al río");
    expect(item.textContent).toContain("EUR 25,50");
    expect(item.textContent).toContain("Almuerzo");
    expect(item.textContent).toContain("Publicado");
    expect(dayExpenses(container).textContent).toContain("Sin gastos registrados.");
    const shortcut = button(container, "Ver gastos fuera del itinerario (1)");
    expect(shortcut).toBeDefined();
    await click(shortcut);
    expect(document.activeElement).toBe(section);
    expect(section.getAttribute("tabindex")).toBe("-1");
    expect(scroll).toHaveBeenCalledTimes(1);
  });
  it("works without scrollIntoView (it is not available everywhere)", async () => {
    const value = fixture(); value.posts[0].createdAt = "2026-10-03T12:00:00.789Z";
    (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView = undefined;
    const container = await render(value);
    await click(button(container, "Ver gastos fuera del itinerario"));
    expect(document.activeElement).toBe(outsideSection(container));
  });
  it("counts every outside expense in the shortcut and keeps the one-render-per-post rule for the memory itself", async () => {
    const value = fixture();
    value.posts[0].createdAt = "2026-10-03T12:00:00.789Z";
    second(value, 41, { totalAmount: 1, currency: "USD" }, "2026-11-01T12:00:00.000Z");
    const container = await render(value);
    expect(button(container, "Ver gastos fuera del itinerario (2)")).toBeDefined();
    expect(container.querySelectorAll(`[data-itinerary-post="${itineraryId(10)}"]`)).toHaveLength(1);
    expect(outsideSection(container)?.querySelectorAll("[data-outside-expense]")).toHaveLength(2);
  });
  it("lists a transport post published outside the trip dates among the outside expenses", async () => {
    const value = fixture();
    value.posts[1].createdAt = "2027-01-01T12:00:00.000Z";
    value.posts[1].expense = { ...value.posts[0].expense!, id: itineraryId(44), postId: value.posts[1].id, totalAmount: 7 };
    const container = await render(value);
    expect(outsideSection(container)?.querySelector(`[data-outside-expense="${itineraryId(11)}"]`)).not.toBeNull();
    expect(dayExpenses(container).textContent).toContain("ARS 25,50 · 1 gasto");
  });

  describe("rescheduling and removing the activity of a linked post (reload with the new aggregate)", () => {
    /** One day is shown at a time: pick it in the strip first. */
    const dayAt = async (container: HTMLElement, date: string) => {
      await act(async () => container.querySelector<HTMLElement>(`[data-day="${date}"]`)!.click());
      return container.querySelector(`[data-itinerary-date="${date}"] [data-itinerary-expenses]`)!;
    };
    /** Two activity days (25 and 26); the activity and its linked post (with expense) start on the 25th. */
    const twoDays = () => {
      const value = fixture();
      value.days.push({ ...value.days[1], id: itineraryId(30), order: 4, startsAt: "2026-09-26T10:00:00.000Z", endsAt: "2026-09-26T18:00:00.000Z", items: [] });
      linkPost(value.posts[0], { activityId: itineraryId(8) }); value.activities[0].postIds = [itineraryId(10)];
      return value;
    };
    /** Each state is what the backend returns: summaries and expenses[] recomputed, and accepted by the real client validator. */
    const settled = async (value: TripItineraryResponse) => {
      settleItinerary(value);
      expect(await throughClientValidator(value)).toEqual({ ok: true, value });
      return value;
    };
    const reload = async (container: HTMLElement, next: TripItineraryResponse) => {
      await act(async () => roots.splice(0).forEach((root) => root.unmount())); container.remove();
      return render(next);
    };
    it("moves the expense to the new day when the activity is rescheduled to another day", async () => {
      const value = await settled(twoDays());
      expect(value.expenses[0]).toMatchObject({ source: "activity", dayId: itineraryId(4) });
      const first = await render(value);
      expect((await dayAt(first, "2026-09-25")).textContent).toContain("ARS 25,50 · 1 gasto");
      expect((await dayAt(first, "2026-09-26")).textContent).toContain("Sin gastos registrados.");
      const moved = twoDays();
      moved.activities[0].dayId = itineraryId(30); moved.activities[0].scheduledAt = "2026-09-26T12:00:00.000Z";
      await settled(moved);
      expect(moved.expenses[0]).toMatchObject({ source: "activity", dayId: itineraryId(30) });
      expect(moved.days.map((day) => day.expenseSummary.expenseCount)).toEqual([0, 0, 0, 1]);
      const after = await reload(first, moved);
      expect((await dayAt(after, "2026-09-26")).textContent).toContain("ARS 25,50 · 1 gasto");
      expect((await dayAt(after, "2026-09-25")).textContent).toContain("Sin gastos registrados.");
      expect(tripSection(after)?.textContent).toContain("ARS 25,50 · 1 gasto");
      expect(button(after, "Ver gastos fuera del itinerario")).toBeUndefined();
      expect(outsideSection(after)).toBeNull();
    });
    it("lists the expense among those outside the itinerary, once, when the post stays outside every day after removal", async () => {
      const first = await render(await settled(twoDays()));
      expect(button(first, "Ver gastos fuera del itinerario")).toBeUndefined();
      // Only the linked activity is deleted: the other one stays and the day items no longer mention the deleted one.
      const removed = twoDays();
      removed.activities = removed.activities.filter((activity) => activity.id !== itineraryId(8)); linkPost(removed.posts[0], {});
      removed.posts[0].createdAt = "2026-10-03T12:00:00.000Z";
      await settled(removed);
      // Published outside every day, the post is no longer placed: the backend returns it in unplacedPosts, not in the day items.
      expect(removed.days[1].items.map((entry) => entry.id)).toEqual([itineraryId(9)]);
      expect(removed.posts.map((post) => post.id)).not.toContain(itineraryId(10));
      expect(removed.unplacedPosts.map((post) => post.id)).toEqual([itineraryId(10)]);
      expect(removed.expenses[0]).toMatchObject({ source: "publication", rootActivityId: null, dayId: null });
      expect(removed.expenseSummary.outsideItinerary.expenseCount).toBe(1);
      const after = await reload(first, removed);
      expect(button(after, "Ver gastos fuera del itinerario (1)")).toBeDefined();
      expect(outsideSection(after)?.querySelectorAll("[data-outside-expense]")).toHaveLength(1);
      expect((await dayAt(after, "2026-09-25")).textContent).toContain("Sin gastos registrados.");
      expect(tripSection(after)?.textContent).toContain("ARS 25,50 · 1 gasto");
    });
    it("keeps the expense under the publication day, with no outside shortcut, when the activity is removed", async () => {
      const value = twoDays();
      value.activities[0].dayId = itineraryId(30); value.activities[0].scheduledAt = "2026-09-26T12:00:00.000Z";
      const first = await render(await settled(value));
      expect((await dayAt(first, "2026-09-26")).textContent).toContain("ARS 25,50 · 1 gasto");
      const removed = twoDays();
      removed.activities = removed.activities.filter((activity) => activity.id !== itineraryId(8)); linkPost(removed.posts[0], {});
      await settled(removed);
      expect(removed.expenses[0]).toMatchObject({ source: "publication", dayId: itineraryId(4) });
      const after = await reload(first, removed);
      expect((await dayAt(after, "2026-09-25")).textContent).toContain("ARS 25,50 · 1 gasto");
      expect((await dayAt(after, "2026-09-26")).textContent).toContain("Sin gastos registrados.");
      expect(button(after, "Ver gastos fuera del itinerario")).toBeUndefined();
    });
  });

  describe("attributed date", () => {
    const attributed = (occurredAt: string, publishedAt: string, source: "activity" | "publication" = "activity") => {
      const value = fixture();
      linkPost(value.posts[0], { activityId: itineraryId(8) });
      value.activities[0].postIds = [itineraryId(10)];
      value.posts[0].createdAt = publishedAt;
      value.expenses[0] = { ...value.expenses[0]!, source, rootActivityId: itineraryId(8), occurredAt, publishedAt };
      return value;
    };
    const line = (container: HTMLElement) => container.querySelector(`[data-itinerary-post="${itineraryId(10)}"]`)?.textContent ?? "";
    it("shows the expense date and the publication date when the activity day differs from the publication day", async () => {
      const container = await render(attributed("2026-09-25T12:00:00.123Z", "2026-09-26T15:00:00.000Z"));
      expect(line(container)).toMatch(/Gasto del 25 .* 2026 · Publicado 26 .* 2026/);
    });
    it.each([[BA, false], ["UTC", true]])("compares the local day in %s, not the UTC one (01:30Z vs 13:00Z of the day before)", async (zone, shown) => {
      const container = await render(attributed("2026-09-26T01:30:00.000Z", "2026-09-25T13:00:00.000Z"), zone);
      expect(line(container).includes("Gasto del")).toBe(shown);
    });
    it("shows nothing when both dates are the same day", async () => {
      const container = await render(attributed("2026-09-25T12:00:00.123Z", "2026-09-25T15:00:00.000Z"));
      expect(line(container)).not.toContain("Gasto del");
    });
    it("shows nothing for an expense counted on its publication", async () => {
      const container = await render(attributed("2026-09-25T12:00:00.123Z", "2026-09-26T15:00:00.000Z", "publication"));
      expect(line(container)).not.toContain("Gasto del");
    });
  });

  describe("transport costs in the Trip summary", () => {
    const transportSection = (container: HTMLElement) => container.querySelector<HTMLElement>("section[data-transport-costs]");
    it("shows the transport total by currency in its own section, apart from expenses and balance", async () => {
      const container = await render(fixture());
      const section = transportSection(container)!;
      expect(section.querySelector("h2")?.textContent).toBe("Total del viaje");
      expect(section.querySelector('[data-transport-currency="ARS"]')?.textContent).toContain("ARS 999,00");
      expect(section.textContent).toContain("No es un gasto ni entra en el balance");
      expect(tripSection(container)?.contains(section)).toBe(false);
      expect(tripSection(container)?.textContent).not.toContain("999");
    });
    it("flags a previous cost without currency and does not add it", async () => {
      const container = await render(withUnindicatedTransportCost(fixture()));
      const section = transportSection(container)!;
      expect(section.querySelector("[data-transport-cost-unindicated]")?.textContent).toContain("Moneda sin indicar");
      expect(section.querySelector('[data-transport-currency="ARS"]')?.textContent).toContain("ARS 999,00");
    });
    it("shows nothing when no transport has a cost", async () => {
      const value = fixture();
      value.transports.forEach((transport) => { transport.costPerPerson = null; transport.costCurrency = null; });
      value.transportCostTotals = { byCurrency: [], withoutCurrency: { transportCount: 0 } };
      expect(transportSection(await render(value))).toBeNull();
    });
  });
});

describe("itinerary screen expenses outside the itinerary in both modes", () => {
  it.each(["register", "balance"] as const)("offers the shortcut and the outside section in %s mode, with the amount and the publication date", async (mode) => {
    const value = fixture();
    value.expenseMode = mode;
    value.posts[0].createdAt = "2026-10-03T12:00:00.789Z";
    const container = await render(value);
    const shortcut = button(container, "Ver gastos fuera del itinerario (1)");
    expect(shortcut?.classList.contains("ui-button--secondary")).toBe(true);
    const item = outsideSection(container)!.querySelector(`[data-outside-expense="${itineraryId(10)}"]`)!;
    expect(item.textContent).toContain("ARS 25,50");
    expect(item.textContent).toMatch(/Publicado .*2026/);
    expect(item.classList.contains("itinerary-outside-expenses__item")).toBe(true);
    expect(dayExpenses(container).textContent).toContain(mode === "balance" ? "Modo balance" : "Modo registro");
  });
  it("wraps the expense date and the publication date of a moved expense in their own spans and keeps the line text", async () => {
    const value = fixture();
    linkPost(value.posts[0], { activityId: itineraryId(8) });
    value.activities[0].postIds = [itineraryId(10)];
    value.posts[0].createdAt = "2026-09-26T15:00:00.000Z";
    value.expenses[0] = { ...value.expenses[0]!, source: "activity", rootActivityId: itineraryId(8), occurredAt: "2026-09-25T12:00:00.123Z", publishedAt: "2026-09-26T15:00:00.000Z" };
    const container = await render(value);
    const line = Array.from(container.querySelectorAll<HTMLElement>(`[data-itinerary-post="${itineraryId(10)}"] .itinerary-secondary`)).find((item) => item.textContent?.startsWith("Gasto del"))!;
    expect(line.querySelectorAll(".expense-date")).toHaveLength(2);
    expect(line.textContent).toMatch(/^Gasto del 25 .* 2026 · Publicado 26 .* 2026$/);
  });
});
