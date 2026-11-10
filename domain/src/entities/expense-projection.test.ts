import { describe, expect, it } from "vitest";
import { createObjectId } from "../value-objects/object-id.js";
import type { ItineraryExpense } from "../types/trip-itinerary.js";
import { attributeExpense, totalizeExpenses } from "./expense-projection.js";

const id = (n: number) => {
  const result = createObjectId(n.toString(16).padStart(24, "0"));
  if (!result.ok) throw result.error;
  return result.value;
};
const at = (iso: string) => new Date(iso);
const expense = (n: number, fields: Partial<ItineraryExpense> = {}): ItineraryExpense =>
  ({ id: id(n), tripId: id(1), postId: id(100 + n), totalAmount: 10, currency: "ARS", breakdown: null, paidBy: null, createdAt: at("2026-09-25T00:00:00.000Z"), ...fields });
const post = { id: id(101), createdAt: at("2026-09-26T23:30:00.123Z") };
const activity = { id: id(6), dayId: id(4), scheduledAt: at("2026-09-25T12:00:00.456Z") };

describe("attributeExpense", () => {
  it("attributes to the root activity scheduledAt and keeps the publication instant", () => {
    const result = attributeExpense({ expense: expense(1), post, rootPostId: id(50), activity, publicationDayId: id(9) });
    expect(result).toEqual({ expenseId: id(1), postId: id(101), rootPostId: id(50), source: "activity", rootActivityId: id(6),
      occurredAt: activity.scheduledAt, publishedAt: post.createdAt, dayId: id(4), currency: "ARS", amountCents: 1000 });
    expect(result.occurredAt).not.toBe(activity.scheduledAt);
    expect(post.createdAt.toISOString()).toBe("2026-09-26T23:30:00.123Z");
  });
  it("attributes to its own publication without an activity, and null day outside every slice", () => {
    expect(attributeExpense({ expense: expense(1), post, rootPostId: post.id, activity: null, publicationDayId: id(9) }))
      .toMatchObject({ source: "publication", rootActivityId: null, occurredAt: post.createdAt, dayId: id(9) });
    expect(attributeExpense({ expense: expense(1), post, rootPostId: post.id, activity: null, publicationDayId: null }).dayId).toBeNull();
  });
  it("converts to exact cents (0.1 + 0.2 = 30) and flags invalid amounts and legacy currency", () => {
    const base = { post, rootPostId: post.id, activity: null, publicationDayId: null };
    expect(attributeExpense({ ...base, expense: expense(1, { totalAmount: 0.1 }) }).amountCents).toBe(10);
    expect(attributeExpense({ ...base, expense: expense(1, { totalAmount: 0.125 }) }).amountCents).toBe(13);
    for (const totalAmount of [Number.NaN, -1, Number.MAX_VALUE]) expect(attributeExpense({ ...base, expense: expense(1, { totalAmount }) }).amountCents).toBeNull();
    expect(attributeExpense({ ...base, expense: expense(1, { currency: null }) }).currency).toBeNull();
  });
});

describe("totalizeExpenses", () => {
  const attr = (n: number, currency: ItineraryExpense["currency"], totalAmount: number) =>
    attributeExpense({ expense: expense(n, { currency, totalAmount }), post, rootPostId: post.id, activity: null, publicationDayId: null });
  it("is empty without expenses", () => {
    expect(totalizeExpenses([])).toEqual({ byCurrency: [], withoutCurrency: { expenseCount: 0 }, expenseCount: 0 });
  });
  it("totals per currency in cents, fixed order, never across currencies", () => {
    const result = totalizeExpenses([attr(1, "USD", 5), attr(2, "ARS", 0.1), attr(3, "ARS", 0.2), attr(4, "EUR", 1.5), attr(5, "ARS", 1)]);
    expect(result).toEqual({ expenseCount: 5, withoutCurrency: { expenseCount: 0 }, byCurrency: [
      { currency: "ARS", totalCents: 130, expenseCount: 3 }, { currency: "EUR", totalCents: 150, expenseCount: 1 }, { currency: "USD", totalCents: 500, expenseCount: 1 }] });
  });
  it("counts legacy and invalid expenses without adding them to a total", () => {
    const result = totalizeExpenses([attr(1, null, 10), attr(2, "ARS", Number.NaN), attr(3, "ARS", 2)]);
    expect(result).toEqual({ expenseCount: 3, withoutCurrency: { expenseCount: 2 }, byCurrency: [{ currency: "ARS", totalCents: 200, expenseCount: 1 }] });
  });
});
