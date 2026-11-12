import { describe, expect, it } from "vitest";
import { createObjectId, type ObjectId } from "../value-objects/object-id.js";
import type { Currency } from "../value-objects/money.js";
import type { ExpensePayment, ExpenseShare } from "./expense.js";
import type { PostExpense } from "./post-expense.js";
import { calculateTripBalance } from "./expense-balance.js";

const id = (n: number): ObjectId => {
  const parsed = createObjectId(n.toString(16).padStart(24, "0"));
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};
const tripId = id(1);
const [nico, martin, ana, juli] = [id(11), id(12), id(13), id(14)];
const members = [nico, martin, ana, juli];
const pay = (userId: ObjectId, unit: "amount" | "percent", value: number): ExpensePayment => ({ userId, unit, value });
const share = (userId: ObjectId, unit: ExpenseShare["unit"], value: number | null = null): ExpenseShare => ({ userId, unit, value });
let counter = 100;
const expense = (over: Partial<PostExpense> = {}): PostExpense => {
  counter += 1;
  return { id: id(counter), tripId, postId: id(counter + 1000), totalAmount: 100, currency: "ARS", breakdown: null,
    payments: [pay(nico, "percent", 100)], shares: [share(nico, "remainder"), share(ana, "remainder")],
    createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, counter)), ...over };
};
const calc = (expenses: PostExpense[], memberIds: ObjectId[] = members, expenseMode: "register" | "balance" = "balance") =>
  calculateTripBalance({ tripId, expenseMode, memberIds, expenses });
const only = (expenses: PostExpense[], currency: Currency = "ARS", memberIds: ObjectId[] = members) =>
  calc(expenses, memberIds).currencies.find((entry) => entry.currency === currency)!;
const net = (entry: ReturnType<typeof only>, userId: ObjectId) => entry.balances.find((row) => row.userId === userId)?.netCents;

describe("calculateTripBalance: core", () => {
  it("a single 100% payer with remainder shares", () => {
    const result = calc([expense({ totalAmount: 100.01, shares: [share(nico, "remainder"), share(ana, "remainder"), share(juli, "remainder")] })]);
    const ars = result.currencies[0]!;
    expect(result.tripId).toBe(tripId);
    expect(result.includedExpenseCount).toBe(1);
    expect(ars.expenseCount).toBe(1);
    // 10001 cents among 3: 3334, 3334, 3333 in row order
    expect(ars.balances.map((row) => [row.userId, row.paidCents, row.shareCents, row.netCents])).toEqual([
      [nico, 10001, 3334, 6667], [ana, 0, 3334, -3334], [juli, 0, 3333, -3333]]);
    expect(ars.settlements).toEqual([{ fromUserId: ana, toUserId: nico, cents: 3334 }, { fromUserId: juli, toUserId: nico, cents: 3333 }]);
  });

  it("mixed payments (amount + percent) and fixed/percent/remainder/excluded shares (PRD example 1000)", () => {
    const e = expense({ totalAmount: 1000, payments: [pay(nico, "amount", 600), pay(martin, "percent", 40)],
      shares: [share(nico, "amount", 350), share(martin, "excluded"), share(ana, "percent", 32.5), share(juli, "remainder")] });
    const ars = only([e]);
    expect(ars.balances.map((row) => [row.userId, row.paidCents, row.shareCents])).toEqual([
      [nico, 60000, 35000], [martin, 40000, 0], [ana, 0, 32500], [juli, 0, 32500]]);
    expect(ars.balances.reduce((sum, row) => sum + row.netCents, 0)).toBe(0);
  });

  it("the percentage residue goes where resolveExpense puts it (33.33% x3)", () => {
    const e = expense({ totalAmount: 100, shares: [share(nico, "percent", 100 / 3), share(ana, "percent", 100 / 3), share(juli, "percent", 100 / 3)] });
    const ars = only([e]);
    expect(ars.balances.reduce((sum, row) => sum + row.shareCents, 0)).toBe(10000);
    expect(ars.balances.reduce((sum, row) => sum + row.netCents, 0)).toBe(0);
  });

  it("separates ARS, EUR and USD in fixed order, never adding across currencies", () => {
    const result = calc([
      expense({ currency: "USD", totalAmount: 30 }), expense({ currency: "ARS", totalAmount: 10 }), expense({ currency: "EUR", totalAmount: 20 })]);
    expect(result.currencies.map((entry) => entry.currency)).toEqual(["ARS", "EUR", "USD"]);
    expect(result.currencies.map((entry) => entry.balances.find((row) => row.userId === nico)?.paidCents)).toEqual([1000, 2000, 3000]);
    for (const entry of result.currencies) expect(entry.balances.reduce((sum, row) => sum + row.netCents, 0)).toBe(0);
  });

  it("only lists currencies that have complete expenses", () => {
    expect(calc([expense({ currency: "EUR" })]).currencies.map((entry) => entry.currency)).toEqual(["EUR"]);
    expect(calc([]).currencies).toEqual([]);
  });

  it("the same user paying and owing a share nets out; zero-net identities are kept", () => {
    const e = expense({ totalAmount: 50, payments: [pay(nico, "percent", 100)], shares: [share(nico, "percent", 100)] });
    const ars = only([e]);
    expect(ars.balances).toEqual([{ userId: nico, paidCents: 5000, shareCents: 5000, netCents: 0, formerMember: false }]);
    expect(ars.settlements).toEqual([]);
  });

  it("aggregates repeated payment rows of the same user", () => {
    const e = expense({ totalAmount: 100, payments: [pay(nico, "amount", 30), pay(nico, "amount", 20), pay(ana, "percent", 50)],
      shares: [share(juli, "remainder")] });
    const ars = only([e]);
    expect(ars.balances.find((row) => row.userId === nico)!.paidCents).toBe(5000);
    expect(net(ars, juli)).toBe(-10000);
    expect(ars.balances.map((row) => row.userId)).toEqual([nico, ana, juli]);
  });

  it("accumulates several expenses of the same currency", () => {
    const ars = only([expense({ totalAmount: 100 }), expense({ totalAmount: 50, payments: [pay(ana, "percent", 100)] })]);
    expect(ars.expenseCount).toBe(2);
    expect(net(ars, nico)).toBe(2500);
    expect(net(ars, ana)).toBe(-2500);
  });
});

describe("calculateTripBalance: incomplete expenses", () => {
  const complete = expense({ totalAmount: 100 });
  const excluded = (over: Partial<PostExpense>) => {
    const bad = expense(over);
    const result = calc([complete, bad]);
    expect(result.includedExpenseCount).toBe(1);
    expect(only([complete])).toEqual(result.currencies[0]);
    return result.excludedExpenses.find((row) => row.expenseId === bad.id)!;
  };

  it("missing currency", () => {
    const row = excluded({ currency: null });
    expect(row).toMatchObject({ currency: null, totalCents: 10000, reasons: ["missing_currency"], postId: expect.any(String) });
  });
  it("missing payments", () => expect(excluded({ payments: [] }).reasons).toEqual(["missing_payments"]));
  it("missing shares and legacy paidBy without shares", () => {
    expect(excluded({ shares: [] }).reasons).toEqual(["missing_shares"]);
  });
  it("payments not covering the total", () => expect(excluded({ payments: [pay(nico, "amount", 10)] }).reasons).toEqual(["payments_not_covering_total"]));
  it("shares not covering the total and no remainder", () => {
    expect(excluded({ shares: [share(nico, "amount", 10)] }).reasons).toEqual(["shares_not_covering_total"]);
    expect(excluded({ shares: [share(nico, "excluded")] }).reasons).toEqual(["no_remainder_participant"]);
  });
  it("invalid rules", () => expect(excluded({ totalAmount: -5 })).toMatchObject({ reasons: ["invalid_rules"], totalCents: null }));
  it("reports former members of the rows and keeps the currency", () => {
    const ghost = id(99);
    const row = excluded({ payments: [pay(ghost, "amount", 10)], currency: "USD" });
    expect(row).toMatchObject({ currency: "USD", formerMemberIds: [ghost] });
  });
  it("an overflowing legacy aggregate is excluded as invalid_rules instead of throwing", () => {
    const big = Math.floor(Number.MAX_SAFE_INTEGER / 100) - 1;
    const one = expense({ totalAmount: big }), two = expense({ totalAmount: big });
    const result = calc([one, two]);
    expect(result.includedExpenseCount).toBe(1);
    expect(result.excludedExpenses).toEqual([expect.objectContaining({ expenseId: two.id, reasons: ["invalid_rules"] })]);
  });
  it("orders excluded by createdAt and then id", () => {
    const at = new Date("2026-01-01T00:00:00Z");
    const a = expense({ payments: [], createdAt: at }), b = expense({ payments: [], createdAt: at });
    const early = expense({ payments: [], createdAt: new Date("2025-01-01T00:00:00Z") });
    expect(calc([b, a, early]).excludedExpenses.map((row) => row.expenseId)).toEqual([early.id, a.id, b.id]);
  });
});

describe("calculateTripBalance: settlements", () => {
  const owe = (userId: ObjectId, cents: number) => expense({ totalAmount: cents / 100, payments: [pay(nico, "percent", 100)], shares: [share(userId, "percent", 100)] });
  it("two people", () => {
    expect(only([owe(ana, 1000)]).settlements).toEqual([{ fromUserId: ana, toUserId: nico, cents: 1000 }]);
  });
  it("three people with one creditor", () => {
    const ars = only([expense({ totalAmount: 90, shares: [share(ana, "remainder"), share(juli, "remainder"), share(nico, "remainder")] })]);
    expect(ars.settlements).toHaveLength(2);
    expect(ars.settlements.every((row) => row.toUserId === nico && row.cents === 3000)).toBe(true);
  });
  it("a chain of debts nets through the middle", () => {
    const ars = only([
      expense({ totalAmount: 10, payments: [pay(nico, "percent", 100)], shares: [share(ana, "percent", 100)] }),
      expense({ totalAmount: 10, payments: [pay(ana, "percent", 100)], shares: [share(juli, "percent", 100)] })]);
    expect(ars.settlements).toEqual([{ fromUserId: juli, toUserId: nico, cents: 1000 }]);
  });
  it("everybody at zero has no settlements", () => {
    expect(only([expense({ totalAmount: 10, payments: [pay(nico, "percent", 100)], shares: [share(nico, "percent", 100)] })]).settlements).toEqual([]);
  });
  it("applying the settlements leaves every net at zero and uses at most n-1 transfers", () => {
    const ars = only([expense({ totalAmount: 100, payments: [pay(nico, "amount", 70), pay(martin, "percent", 30)],
      shares: [share(ana, "remainder"), share(juli, "remainder"), share(nico, "remainder")] })]);
    const nets = new Map(ars.balances.map((row) => [row.userId, row.netCents]));
    for (const s of ars.settlements) { nets.set(s.fromUserId, nets.get(s.fromUserId)! + s.cents); nets.set(s.toUserId, nets.get(s.toUserId)! - s.cents); }
    expect([...nets.values()].every((value) => value === 0)).toBe(true);
    expect(ars.settlements.length).toBeLessThanOrEqual(ars.balances.length - 1);
    expect(ars.settlements.every((row) => row.cents > 0)).toBe(true);
  });
  it("is deterministic when the input order changes", () => {
    const list = [owe(ana, 700), owe(juli, 700), expense({ totalAmount: 5, payments: [pay(martin, "percent", 100)], shares: [share(juli, "percent", 100)] })];
    const base = calc(list);
    expect(calc([...list].reverse())).toEqual(base);
    expect(calc([list[1]!, list[2]!, list[0]!], [...members].reverse())).toEqual(base);
    const reordered = list.map((e) => ({ ...e, payments: [...e.payments].reverse(), shares: [...e.shares].reverse() }));
    expect(only(reordered).balances).toEqual(only(list).balances);
  });
});

describe("calculateTripBalance: former members and mode", () => {
  it("marks identities that are not current members and keeps their payments and shares", () => {
    const e = expense({ totalAmount: 100, payments: [pay(nico, "percent", 100)], shares: [share(nico, "percent", 50), share(juli, "percent", 50)] });
    const ars = only([e], "ARS", [nico, martin]);
    expect(ars.balances).toEqual([
      { userId: nico, paidCents: 10000, shareCents: 5000, netCents: 5000, formerMember: false },
      { userId: juli, paidCents: 0, shareCents: 5000, netCents: -5000, formerMember: true }]);
    expect(ars.settlements).toEqual([{ fromUserId: juli, toUserId: nico, cents: 5000 }]);
  });
  it("without memberships nobody is silently excluded", () => {
    const ars = only([expense()], "ARS", []);
    expect(ars.balances.map((row) => row.userId)).toEqual([nico, ana]);
    expect(ars.balances.every((row) => row.formerMember)).toBe(true);
  });
  it("register mode produces no debts even with complete expenses", () => {
    expect(calc([expense()], members, "register")).toEqual({ tripId, expenseMode: "register", currencies: [], excludedExpenses: [], includedExpenseCount: 0 });
  });
  it("does not mutate its input and a stored edit changes the result", () => {
    const list = [expense({ payments: [pay(nico, "percent", 100)] }), expense({ payments: [] })];
    const copy = structuredClone(list);
    const before = calc(list);
    expect(list).toEqual(copy);
    const edited = [{ ...list[0]!, shares: [share(juli, "remainder")] }, list[1]!];
    expect(calc(edited)).not.toEqual(before);
    expect(net(only(edited), juli)).toBe(-10000);
    expect(calc(list)).toEqual(before);
  });
});

describe("calculateTripBalance: properties (seeded)", () => {
  const mulberry32 = (initial: number) => {
    let seed = initial;
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const generate = (seed: number) => {
    const random = mulberry32(seed);
    const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;
    const people = [nico, martin, ana, juli, id(15), id(16)];
    const count = 1 + Math.floor(random() * 6);
    const list: PostExpense[] = [];
    for (let i = 0; i < count; i += 1) {
      const total = (1 + Math.floor(random() * 500000)) / 100;
      const payers = [...people].sort(() => random() - 0.5).slice(0, 1 + Math.floor(random() * 3));
      const payments = payers.map((userId, index) => index === 0 ? pay(userId, "percent", 100 - 20 * (payers.length - 1)) : pay(userId, "percent", 20));
      const sharers = [...people].sort(() => random() - 0.5).slice(0, 1 + Math.floor(random() * 5));
      const shares: ExpenseShare[] = sharers.map((userId, index) => index === 0 ? share(userId, "remainder") : random() < 0.3 ? share(userId, "excluded")
        : share(userId, "percent", pick([5, 10, 12.5, 20])));
      const broken = random() < 0.15;
      list.push(expense({ totalAmount: total, currency: pick(["ARS", "EUR", "USD"] as const), payments: broken ? [] : payments, shares,
        id: id(5000 + seed * 10 + i), postId: id(900000 + seed * 10 + i), createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)) }));
    }
    return list;
  };
  it("keeps the invariants over ~300 seeded cases", () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const list = generate(seed);
      const result = calc(list);
      expect(calc(generate(seed))).toEqual(result);
      expect(result.includedExpenseCount + result.excludedExpenses.length).toBe(list.length);
      const totals = new Map<string, number>();
      for (const entry of result.currencies) {
        expect(entry.balances.reduce((sum, row) => sum + row.netCents, 0)).toBe(0);
        const paid = entry.balances.reduce((sum, row) => sum + row.paidCents, 0);
        expect(paid).toBe(entry.balances.reduce((sum, row) => sum + row.shareCents, 0));
        totals.set(entry.currency, paid);
        const nets = new Map(entry.balances.map((row) => [row.userId, row.netCents]));
        for (const s of entry.settlements) {
          expect(s.cents).toBeGreaterThan(0);
          expect(nets.has(s.fromUserId) && nets.has(s.toUserId)).toBe(true);
          nets.set(s.fromUserId, nets.get(s.fromUserId)! + s.cents); nets.set(s.toUserId, nets.get(s.toUserId)! - s.cents);
        }
        expect([...nets.values()].every((value) => value === 0)).toBe(true);
        expect(entry.settlements.length).toBeLessThanOrEqual(Math.max(0, entry.balances.length - 1));
      }
      const includedTotals = new Map<string, number>();
      for (const e of list) {
        if (result.excludedExpenses.some((row) => row.expenseId === e.id)) continue;
        includedTotals.set(e.currency!, (includedTotals.get(e.currency!) ?? 0) + Math.round(e.totalAmount * 100));
      }
      expect(Object.fromEntries(totals)).toEqual(Object.fromEntries(includedTotals));
    }
  });
});

describe("calculateTripBalance: stored totals above the T133 limit", () => {
  it("still enters the balance", () => {
    const ars = only([expense({ totalAmount: 1e13 })]);
    expect(net(ars, nico)).toBe(500000000000000);
  });
});
