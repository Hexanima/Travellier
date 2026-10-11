import { describe, expect, it } from "vitest";
import { checkExpenseCompleteness } from "./expense-completeness.js";

const userId = "000000000000000000000001";
const otherUser = "000000000000000000000002";
const row = (unit: string, value: number | null, user = userId) => ({ userId: user, unit, value });
const complete = () => ({ totalAmount: 100, currency: "USD", payments: [row("percent", 100)], shares: [row("percent", 100)] });
const fields = (value: Record<string, unknown>) => {
  const result = checkExpenseCompleteness(value);
  return result.ok ? [] : result.error.issues.map(({ field }) => field);
};

describe("expense completeness diagnostics", () => {
  it("identifies every missing contract field without filling it", () => {
    const legacy = { totalAmount: 42.5, paidBy: userId };
    expect(fields(legacy)).toEqual(["currency", "payments", "shares"]);
    expect(legacy).toEqual({ totalAmount: 42.5, paidBy: userId });
  });
  it.each([
    ["payments", { payments: [row("amount", 50)] }],
    ["shares", { shares: [row("percent", 50)] }],
    ["payments", { payments: [row("amount", 101)] }],
    ["shares", { shares: [row("amount", 101), row("remainder", null, otherUser)] }],
    ["shares", { shares: [row("amount", 50), row("amount", 50)] }],
    ["payments", { payments: [row("amount", -1)] }],
    ["payments", { payments: [row("amount", Number.NaN)] }],
    ["payments", { payments: [row("amount", 100, "unknown")] }],
    ["payments", { payments: [row("remainder", null)] }],
    ["currency", { currency: "BRL" }],
  ])("reports incomplete or invalid %s", (field, overrides) => {
    expect(fields({ ...complete(), ...overrides })).toEqual([field]);
  });
  it("reports invalid totals without trying to resolve payments or shares", () => {
    expect(fields({ ...complete(), totalAmount: Number.NaN })).toEqual(["totalAmount"]);
  });
  it("accepts multiple payments by the same identity and distinct remainder/excluded shares", () => {
    expect(checkExpenseCompleteness({ ...complete(), payments: [row("amount", 35), row("percent", 65)],
      shares: [row("amount", 35), row("remainder", null, otherUser), row("excluded", null, "000000000000000000000003")] })).toEqual({ ok: true, value: undefined });
  });
  it("accepts complete percentages with cent rounding residue", () => {
    expect(fields({ ...complete(), totalAmount: 0.05, payments: [row("percent", 50), row("percent", 50)],
      shares: [row("percent", 50), row("percent", 50, otherUser)] })).toEqual([]);
  });
  it("rejects excess percentage or mixed coverage even when cent rounding hides it", () => {
    expect(fields({ ...complete(), totalAmount: 0.01, payments: [row("percent", 60), row("percent", 50)],
      shares: [row("percent", 60), row("percent", 50, otherUser)] })).toEqual(["payments", "shares"]);
    expect(fields({ ...complete(), totalAmount: 0.01, payments: [row("amount", 0.01), row("percent", 10)] })).toEqual(["payments"]);
  });
});
