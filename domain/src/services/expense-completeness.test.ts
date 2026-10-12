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
  it.each([
    [0.01, [row("percent", 60)], [row("percent", 60)], ["payments", "shares"]],
    [0.01, [row("percent", 60)], [row("percent", 100)], ["payments"]],
    [0.01, [row("percent", 100)], [row("percent", 60)], ["shares"]],
    [0.02, [row("amount", 0.01), row("percent", 40)], [row("amount", 0.01), row("percent", 40, otherUser)], ["payments", "shares"]],
  ])("reports incomplete coverage before rounding for total %s", (totalAmount, payments, shares, expected) => {
    expect(fields({ ...complete(), totalAmount, payments, shares })).toEqual(expected);
  });
  it("accepts a small expense whose partial fixed shares explicitly distribute the remainder", () => {
    expect(fields({ ...complete(), totalAmount: 0.01, shares: [row("percent", 60), row("remainder", null, otherUser)] })).toEqual([]);
  });
  it("tolerates floating point residue in complete mixed coverage", () => {
    expect(fields({ ...complete(), totalAmount: 0.07, payments: [row("amount", 0.01), row("percent", 600 / 7)],
      shares: [row("amount", 0.01), row("percent", 600 / 7, otherUser)] })).toEqual([]);
  });
  it("rejects a negative remainder caused by rounding partial percentage shares per row", () => {
    const identities = [1, 2, 3, 4].map((n) => n.toString(16).padStart(24, "0"));
    expect(fields({ ...complete(), totalAmount: 0.02,
      shares: [...identities.slice(0, 3).map((identity) => row("percent", 30, identity)), row("remainder", null, identities[3])] })).toEqual(["shares"]);
  });
  it("rejects rounded excess for partial mixed shares with an explicit remainder", () => {
    const identities = [1, 2, 3, 4, 5].map((n) => n.toString(16).padStart(24, "0"));
    expect(fields({ ...complete(), totalAmount: 0.03,
      shares: [row("amount", 0.01, identities[0]), ...identities.slice(1, 4).map((identity) => row("percent", 20, identity)), row("remainder", null, identities[4])] })).toEqual(["shares"]);
  });
  it("keeps partial rounded shares valid when their remainder is non-negative", () => {
    expect(fields({ ...complete(), totalAmount: 0.02,
      shares: [row("percent", 30), row("percent", 30, otherUser), row("remainder", null, "000000000000000000000003")] })).toEqual([]);
  });
  it("allows cent residue adjustment for exactly complete percentage rows", () => {
    const identities = [1, 2, 3, 4].map((n) => n.toString(16).padStart(24, "0"));
    expect(fields({ ...complete(), totalAmount: 0.02,
      payments: identities.map((identity) => row("percent", 25, identity)),
      shares: identities.map((identity) => row("percent", 25, identity)) })).toEqual([]);
  });
  it("rejects excess percentage or mixed coverage even when cent rounding hides it", () => {
    expect(fields({ ...complete(), totalAmount: 0.01, payments: [row("percent", 60), row("percent", 50)],
      shares: [row("percent", 60), row("percent", 50, otherUser)] })).toEqual(["payments", "shares"]);
    expect(fields({ ...complete(), totalAmount: 0.01, payments: [row("amount", 0.01), row("percent", 10)] })).toEqual(["payments"]);
  });

  describe.each(["totalAmount", "payments", "shares"])("decimal rounding of %s", (field) => {
    it.each([
      [1.005, 1.01], [1.015, 1.02], [2.675, 2.68], [1.255, 1.26], [0.005, 0.01],
      [1.0049999999999997, 1], [1.0050000000000001, 1.01], [5e-7, 0],
    ])("rounds %s consistently to %s", (value, rounded) => {
      const expense = { ...complete(), totalAmount: rounded, payments: [row("amount", rounded)] };
      const input = field === "totalAmount" ? { ...expense, totalAmount: value }
        : { ...expense, [field]: [row("amount", value)] };
      expect(checkExpenseCompleteness(input)).toEqual({ ok: true, value: undefined });
    });
  });

  it.each([Number.POSITIVE_INFINITY, -1, 1e21, 90071992547409.92])("rejects an invalid or unsafe decimal total %s", (totalAmount) => {
    expect(fields({ ...complete(), totalAmount })).toContain("totalAmount");
  });
  it.each(["payments", "shares"])("does not round a fixed %s amount below the half-cent boundary upward", (field) => {
    expect(fields({ ...complete(), totalAmount: 1.01, [field]: [row("amount", 1.0049999999999997)] })).toEqual([field]);
  });

  describe.each(["payments", "shares"])("large %s coverage", (field) => {
    it.each([
      ["one fixed cent missing", [row("amount", 9999999999999.99)]],
      ["one fixed cent extra", [row("amount", 10000000000000.01)]],
      ["one percentage cent missing", [row("percent", 99.9999999999999)]],
      ["one mixed cent missing", [row("amount", 5000000000000), row("percent", 49.9999999999999, otherUser)]],
      ["one percentage cent extra", [row("percent", 50.0000000000001), row("percent", 50, otherUser)]],
    ])("diagnoses %s", (_name, rows) => {
      expect(fields({ ...complete(), totalAmount: 10000000000000, [field]: rows })).toEqual([field]);
    });
  });
  it("sums fixed cents exactly even when their aggregate exceeds the safe Number range", () => {
    expect(fields({ ...complete(), totalAmount: 90071992547409.9,
      payments: [row("amount", 90071992547409.9), row("amount", 0.03)] })).toEqual(["payments"]);
  });
  it("rejects one fixed cent of excess rather than allowing a negative large remainder", () => {
    expect(fields({ ...complete(), totalAmount: 10000000000000,
      shares: [row("amount", 10000000000000.01), row("remainder", null, otherUser)] })).toEqual(["shares"]);
  });
  it("accepts complete large fixed and mixed coverage and an explicitly assigned last cent", () => {
    expect(fields({ ...complete(), totalAmount: 10000000000000,
      payments: [row("amount", 10000000000000)],
      shares: [row("amount", 5000000000000), row("percent", 50, otherUser)] })).toEqual([]);
    expect(fields({ ...complete(), totalAmount: 10000000000000,
      shares: [row("percent", 99.9999999999999), row("remainder", null, otherUser)] })).toEqual([]);
  });
});
