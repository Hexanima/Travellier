import { describe, expect, it } from "vitest";
import { checkExpenseCompleteness } from "../services/expense-completeness.js";
import { resolveExpense, validateExpenseRules, type ExpenseRules } from "./expense.js";

const id = (n: number) => n.toString(16).padStart(24, "0");
const [u1, u2, u3, u4] = [id(1), id(2), id(3), id(4)];
const row = (unit: string, value: number | null, userId = u1) => ({ userId, unit, value });
const rules = (value: Record<string, unknown>) => ({ totalAmount: 100, currency: "ARS", ...value }) as unknown as ExpenseRules;
const resolve = (value: Record<string, unknown>) => resolveExpense(rules(value));
const invalidFields = (value: Record<string, unknown>) => {
  const result = validateExpenseRules(value);
  return result.ok ? [] : result.error.issues.map(({ field }) => field);
};
const cents = (rows: { cents: number }[]) => rows.map((entry) => entry.cents);
const complete = (value: Record<string, unknown>) => {
  const resolution = resolve(value);
  if (resolution.status !== "complete") throw new Error(`expected complete, got ${JSON.stringify(resolution)}`);
  return resolution;
};

describe("resolveExpense: PRD example and cent distribution", () => {
  it("resolves the PRD example: 1000 with Nico 350, Martin excluded, Ana and Juli sharing the rest", () => {
    const resolution = complete({ totalAmount: 1000, currency: "USD", payments: [row("amount", 1000, u3)],
      shares: [row("amount", 350, u1), row("excluded", null, u2), row("remainder", null, u3), row("remainder", null, u4)] });
    expect(resolution.currency).toBe("USD");
    expect(resolution.totalCents).toBe(100000);
    expect(resolution.payments).toEqual([{ userId: u3, cents: 100000 }]);
    expect(resolution.shares).toEqual([{ userId: u1, cents: 35000 }, { userId: u2, cents: 0 }, { userId: u3, cents: 32500 }, { userId: u4, cents: 32500 }]);
  });
  it.each([
    [10, 3, [334, 333, 333]],
    [0.01, 3, [1, 0, 0]],
    [0.02, 3, [1, 1, 0]],
    [10.01, 4, [251, 250, 250, 250]],
    [100, 1, [10000]],
  ])("distributes leftover cents of total %s among %s remainder rows in list order", (totalAmount, count, expected) => {
    const shares = Array.from({ length: count }, (_, index) => row("remainder", null, id(index + 1)));
    expect(cents(complete({ totalAmount, payments: [row("percent", 100)], shares }).shares)).toEqual(expected);
  });
  it("gives zero cents to remainder rows when the fixed and percent shares already cover the total", () => {
    const resolution = complete({ payments: [row("percent", 100)], shares: [row("percent", 100), row("remainder", null, u2)] });
    expect(cents(resolution.shares)).toEqual([10000, 0]);
  });
  it("resolves a single participant, one cent and the largest safe total", () => {
    expect(cents(complete({ payments: [row("percent", 100)], shares: [row("remainder", null)] }).shares)).toEqual([10000]);
    expect(cents(complete({ totalAmount: 0.01, payments: [row("percent", 100)], shares: [row("percent", 100)] }).payments)).toEqual([1]);
    const max = complete({ totalAmount: 90071992547409.9, payments: [row("amount", 90071992547409.9)],
      shares: [row("remainder", null, u1), row("remainder", null, u2), row("remainder", null, u3)] });
    expect(max.totalCents).toBe(9007199254740990);
    expect(cents(max.payments)).toEqual([9007199254740990]);
    expect(cents(max.shares)).toEqual([3002399751580330, 3002399751580330, 3002399751580330]);
  });
});

describe("resolveExpense: percentage rounding residue", () => {
  it("does not adjust partial percentages: three 33.33% rows over 100 are incomplete", () => {
    const thirds = [row("percent", 33.33, u1), row("percent", 33.33, u2), row("percent", 33.33, u3)];
    expect(resolve({ payments: thirds, shares: thirds })).toEqual({ status: "incomplete", totalCents: 10000,
      reasons: ["payments_not_covering_total", "shares_not_covering_total"] });
  });
  it.each([
    [100, [33.33, 33.33, 33.34], [3333, 3333, 3334]],
    [100.01, [33.33, 33.33, 33.34], [3333, 3333, 3335]],
    [100.01, [33.33, 33.33, 33.34, 0], [3333, 3333, 3335, 0]],
    [0.05, [50, 50], [3, 2]],
    [0.03, [50, 50, 0], [2, 1, 0]],
    [0.02, [25, 25, 25, 25], [1, 1, 0, 0]],
    [0.01, [60, 40], [1, 0]],
  ])("adjusts the residue of total %s with percentages %j into the last percent rows", (totalAmount, percents, expected) => {
    const rows = percents.map((value, index) => row("percent", value, id(index + 1)));
    const resolution = complete({ totalAmount, payments: rows, shares: rows });
    expect(cents(resolution.payments)).toEqual(expected);
    expect(cents(resolution.shares)).toEqual(expected);
  });
  it("adjusts only percent rows when fixed amounts and percentages cover the total", () => {
    // 0.04 = 1 cent fixed + 75% (1.5 cents each, rounded up to 2): the extra cent is taken from the last percent row.
    const rows = [row("amount", 0.01, u1), row("percent", 37.5, u2), row("percent", 37.5, u3)];
    const resolution = complete({ totalAmount: 0.04, payments: rows, shares: rows });
    expect(cents(resolution.shares)).toEqual([1, 2, 1]);
    const exact = [row("amount", 0.01, u1), row("percent", 40, u2), row("percent", 40, u3)];
    expect(cents(complete({ totalAmount: 0.05, payments: exact, shares: exact }).payments)).toEqual([1, 2, 2]);
  });
  it("rounds each partial percent row half-up without residue adjustment when a remainder row covers the rest", () => {
    const resolution = complete({ totalAmount: 10.01, payments: [row("percent", 100)],
      shares: [row("amount", 1, u1), row("percent", 50, u2), row("remainder", null, u3), row("remainder", null, u4)] });
    expect(cents(resolution.shares)).toEqual([100, 501, 200, 200]);
  });
});

describe("resolveExpense: mixed rules", () => {
  it("resolves fixed plus percentage payments, repeated payers and all share units together", () => {
    const resolution = complete({ payments: [row("amount", 35, u1), row("percent", 65, u1)],
      shares: [row("amount", 10, u1), row("percent", 40, u2), row("remainder", null, u3), row("excluded", null, u4)] });
    expect(resolution.payments).toEqual([{ userId: u1, cents: 3500 }, { userId: u1, cents: 6500 }]);
    expect(resolution.shares).toEqual([{ userId: u1, cents: 1000 }, { userId: u2, cents: 4000 }, { userId: u3, cents: 5000 }, { userId: u4, cents: 0 }]);
  });
  it("does not mutate the input and is deterministic and idempotent", () => {
    const input = rules({ payments: [row("percent", 100)], shares: [row("amount", 10), row("remainder", null, u2)] });
    const snapshot = JSON.parse(JSON.stringify(input));
    const first = resolveExpense(input);
    expect(input).toEqual(snapshot);
    expect(resolveExpense(input)).toEqual(first);
    expect(resolveExpense(JSON.parse(JSON.stringify(input)))).toEqual(first);
  });
});

describe("resolveExpense: incomplete expenses never invent data", () => {
  const full = { payments: [row("percent", 100)], shares: [row("percent", 100)] };
  it.each([
    ["missing currency", { ...full, currency: undefined }, ["missing_currency"]],
    ["missing payments", { shares: full.shares }, ["missing_payments"]],
    ["empty payments", { payments: [], shares: full.shares }, ["missing_payments"]],
    ["missing shares", { payments: full.payments }, ["missing_shares"]],
    ["payments below the total", { payments: [row("amount", 99)], shares: full.shares }, ["payments_not_covering_total"]],
    ["shares without remainder and with leftover", { payments: full.payments, shares: [row("amount", 50), row("excluded", null, u2)] }, ["shares_not_covering_total"]],
    ["all excluded", { payments: full.payments, shares: [row("excluded", null, u1), row("excluded", null, u2)] }, ["no_remainder_participant"]],
    ["nothing at all", { currency: undefined }, ["missing_currency", "missing_payments", "missing_shares"]],
  ])("%s", (_name, value, reasons) => {
    const resolution = resolve(value);
    expect(resolution.status).toBe("incomplete");
    if (resolution.status === "incomplete") expect(resolution.reasons).toEqual(reasons);
  });
  it("keeps the resolved parts of an incomplete expense and omits the missing ones", () => {
    expect(resolve({ payments: full.payments })).toEqual({ status: "incomplete", reasons: ["missing_shares"], totalCents: 10000,
      payments: [{ userId: u1, cents: 10000 }] });
  });
  it("classifies the legacy paidBy contract as incomplete without interpreting it or mutating the input", () => {
    const legacy = { totalAmount: 42.5, paidBy: u1 };
    expect(resolveExpense(legacy as unknown as ExpenseRules)).toEqual({ status: "incomplete", totalCents: 4250,
      reasons: ["missing_currency", "missing_payments", "missing_shares"] });
    expect(legacy).toEqual({ totalAmount: 42.5, paidBy: u1 });
  });
  it("reports invalid rules instead of resolving them", () => {
    expect(resolve({ payments: [row("amount", 101)], shares: full.shares })).toEqual({ status: "incomplete", reasons: ["invalid_rules"] });
    expect(resolve({ totalAmount: 0 })).toEqual({ status: "incomplete", reasons: ["invalid_rules"] });
  });
});

describe("validateExpenseRules", () => {
  it("normalizes valid rules into a copy and accepts missing optional parts", () => {
    const input = { totalAmount: 100, currency: "EUR", payments: [row("amount", 100)], shares: [row("remainder", null)], paidBy: u1 };
    const result = validateExpenseRules(input);
    expect(result).toEqual({ ok: true, value: { totalAmount: 100, currency: "EUR", payments: [row("amount", 100)], shares: [row("remainder", null)] } });
    expect(validateExpenseRules({ totalAmount: 5 })).toEqual({ ok: true, value: { totalAmount: 5 } });
  });
  it.each([
    ["total zero", { totalAmount: 0 }, ["totalAmount"]],
    ["negative total", { totalAmount: -1 }, ["totalAmount"]],
    ["unsafe total", { totalAmount: 90071992547409.92 }, ["totalAmount"]],
    ["non numeric total", { totalAmount: "10" }, ["totalAmount"]],
    ["invalid currency", { currency: "BRL" }, ["currency"]],
    ["payments above the total", { payments: [row("amount", 60), row("amount", 41)] }, ["payments"]],
    ["fixed shares above the total", { shares: [row("amount", 60, u1), row("amount", 41, u2)] }, ["shares"]],
    ["fixed plus percent shares above the total", { shares: [row("amount", 60, u1), row("percent", 41, u2)] }, ["shares"]],
    ["percent above 100", { payments: [row("percent", 100.01)] }, ["payments[0].value"]],
    ["percentages adding more than 100", { shares: [row("percent", 60, u1), row("percent", 50, u2)] }, ["shares"]],
    ["negative value", { payments: [row("amount", -1)] }, ["payments[0].value"]],
    ["invalid unit", { payments: [row("fraction", 1)] }, ["payments[0].unit"]],
    ["remainder inside payments", { payments: [row("remainder", null)] }, ["payments[0].unit"]],
    ["missing value", { shares: [{ userId: u1, unit: "amount" }] }, ["shares[0].value"]],
    ["value on remainder", { shares: [row("remainder", 5)] }, ["shares[0].value"]],
    ["value on excluded", { shares: [row("excluded", 0)] }, ["shares[0].value"]],
    ["user that is not an ObjectId", { payments: [row("amount", 1, "unknown")] }, ["payments[0].userId"]],
    ["duplicated share user", { shares: [row("amount", 10, u1), row("remainder", null, u1)] }, ["shares[1].userId"]],
    ["duplicated share user with other case", { shares: [row("amount", 10, u1), row("remainder", null, u1.toUpperCase())] }, ["shares[1].userId"]],
    ["payments that are not a list", { payments: "x" }, ["payments"]],
    ["rows that are not objects", { shares: [null] }, ["shares[0]"]],
  ])("rejects %s with its field", (_name, value, fields) => {
    expect(invalidFields({ totalAmount: 100, currency: "ARS", ...value })).toEqual(fields);
  });
  it("accepts several payments by the same user", () => {
    expect(validateExpenseRules(rules({ payments: [row("amount", 10), row("amount", 20), row("percent", 20)] })).ok).toBe(true);
  });
});

// Deterministic pseudo random generator (mulberry32) with a fixed seed.
const prng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe("resolveExpense: seeded invariants and consistency with checkExpenseCompleteness", () => {
  const next = prng(78);
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const split = (parts: number, units: number) => {
    const cuts = Array.from({ length: parts - 1 }, () => int(0, units)).sort((a, b) => a - b);
    return [...cuts, units].map((cut, index) => cut - (index === 0 ? 0 : [...cuts, units][index - 1]));
  };
  const randomRows = (shares: boolean, total: number) => {
    const count = int(1, 5);
    const kind = int(0, 6);
    let rows: { userId: string; unit: string; value: number | null }[];
    if (kind === 0) rows = split(count, 10000).map((hundredths, index) => row("percent", hundredths / 100, id(index + 1)));
    else if (kind === 1) rows = split(count, Math.round(total * 100)).map((c, index) => row("amount", c / 100, id(index + 1)));
    else if (kind === 2) rows = Array.from({ length: count }, (_, index) => row(["amount", "percent", "remainder", "excluded"][int(0, 3)], null, id(index + 1))).map((entry) =>
      entry.unit === "amount" ? row("amount", int(0, 3000) / 100, entry.userId) : entry.unit === "percent" ? row("percent", int(0, 6000) / 100, entry.userId) : entry);
    else if (kind === 3) rows = [row("percent", int(0, 10000) / 100, id(1))];
    else if (kind === 5) rows = [row("amount", Math.round(total * 100 + int(1, 500)) / 100)];
    else if (kind === 6) rows = split(count, 10000 + int(1, 2000)).map((hundredths, index) => row("percent", hundredths / 100, id(index + 1)));
    else rows = split(count, 10000).map((hundredths, index) => row(index === 0 && shares ? "remainder" : "percent", index === 0 && shares ? null : hundredths / 100, id(index + 1)));
    if (!shares) rows = rows.map((entry) => (entry.unit === "remainder" || entry.unit === "excluded" ? row("percent", 10, entry.userId) : entry));
    return rows;
  };
  const cases = Array.from({ length: 240 }, () => {
    const totalCents = int(1, 100000);
    const total = totalCents / 100;
    return { totalAmount: total, currency: (["ARS", "EUR", "USD"] as const)[int(0, 2)], payments: randomRows(false, total), shares: randomRows(true, total) };
  });

  it("generates a meaningful mix of complete, incomplete and invalid cases", () => {
    const statuses = cases.map((input) => (validateExpenseRules(input).ok ? resolveExpense(input as unknown as ExpenseRules).status : "invalid"));
    expect(statuses.filter((status) => status === "complete").length).toBeGreaterThan(20);
    expect(statuses.filter((status) => status === "incomplete").length).toBeGreaterThan(20);
    expect(statuses.filter((status) => status === "invalid").length).toBeGreaterThan(20);
  });
  it.each(cases.map((input, index) => [index, input] as const))("case %s keeps the invariants", (_index, input) => {
    const snapshot = JSON.parse(JSON.stringify(input));
    const resolution = resolveExpense(input as unknown as ExpenseRules);
    expect(input).toEqual(snapshot);
    expect(resolveExpense(input as unknown as ExpenseRules)).toEqual(resolution);
    // The diagnostic and the resolver share the same notion of completeness.
    expect(resolution.status === "complete").toBe(checkExpenseCompleteness(input).ok);
    if (resolution.status !== "complete") return;
    const total = Math.round(input.totalAmount * 100);
    expect(resolution.totalCents).toBe(total);
    expect(resolution.currency).toBe(input.currency);
    for (const [resolved, source] of [[resolution.payments, input.payments], [resolution.shares, input.shares]] as const) {
      expect(resolved.map((entry) => entry.userId)).toEqual(source.map((entry) => entry.userId));
      expect(resolved.every((entry) => Number.isSafeInteger(entry.cents) && entry.cents >= 0)).toBe(true);
      expect(resolved.reduce((sum, entry) => sum + entry.cents, 0)).toBe(total);
    }
  });
});
