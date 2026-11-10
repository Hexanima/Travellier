import { describe, expect, it } from "vitest";
import { formatCents, formatExpenseAmount, totalsOf } from "./expense-format.js";

const post = (totalAmount: number, currency: "ARS" | "EUR" | "USD" | null) => ({ expense: { totalAmount, currency } });

describe("formatCents", () => {
  it("puts the currency code first and uses comma decimals", () => {
    expect(formatCents(2550, "ARS")).toBe("ARS 25,50");
    expect(formatCents(5, "EUR")).toBe("EUR 0,05");
    expect(formatCents(0, "USD")).toBe("USD 0,00");
  });
  it("groups thousands with dots without depending on the ICU data", () => {
    expect(formatCents(123456789, "ARS")).toBe("ARS 1.234.567,89");
    expect(formatCents(100000, "USD")).toBe("USD 1.000,00");
  });
});
describe("formatExpenseAmount", () => {
  it("formats an amount with currency, or flags the missing currency", () => {
    expect(formatExpenseAmount({ totalAmount: 25.5, currency: "ARS" })).toBe("ARS 25,50");
    expect(formatExpenseAmount({ totalAmount: 25.5, currency: null })).toBe("25,50 (moneda sin indicar)");
  });
});
describe("totalsOf", () => {
  it("sums exactly in cents (0.1 + 0.2) and keeps currencies apart in ARS, EUR, USD order", () => {
    const totals = totalsOf([post(0.1, "USD"), post(10, "EUR"), post(0.2, "USD"), post(5, "ARS"), post(1, "ARS")]);
    expect(totals.byCurrency).toEqual([{ currency: "ARS", totalCents: 600, expenseCount: 2 }, { currency: "EUR", totalCents: 1000, expenseCount: 1 },
      { currency: "USD", totalCents: 30, expenseCount: 2 }]);
    expect(totals.expenseCount).toBe(5);
    expect(totals.withoutCurrency).toEqual({ expenseCount: 0 });
  });
  it("counts an expense without currency apart and never sums it or assumes ARS", () => {
    const totals = totalsOf([post(5, null), post(2, "ARS")]);
    expect(totals.byCurrency).toEqual([{ currency: "ARS", totalCents: 200, expenseCount: 1 }]);
    expect(totals.withoutCurrency).toEqual({ expenseCount: 1 });
    expect(totals.expenseCount).toBe(2);
  });
  it("sends a non-representable amount to the currency-less group", () => {
    const totals = totalsOf([post(Number.MAX_SAFE_INTEGER, "ARS"), post(-1, "ARS")]);
    expect(totals.byCurrency).toEqual([]);
    expect(totals.withoutCurrency).toEqual({ expenseCount: 2 });
  });
  it("ignores posts without an expense", () => {
    expect(totalsOf([{ expense: null }, post(1, "ARS")]).expenseCount).toBe(1);
    expect(totalsOf([])).toEqual({ byCurrency: [], withoutCurrency: { expenseCount: 0 }, expenseCount: 0 });
  });
});
