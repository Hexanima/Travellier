import { describe, expect, it } from "vitest";
import * as domain from "../../index.js";

const id = (n: number) => {
  const result = domain.createObjectId(n.toString(16).padStart(24, "0"));
  if (!result.ok) throw result.error;
  return result.value;
};
const tripId = id(1), actor = id(2), other = id(3);
const expense: domain.PostExpense = { id: id(10), tripId, postId: id(11), totalAmount: 100, currency: "ARS", breakdown: null,
  payments: [{ userId: actor, unit: "percent", value: 100 }], shares: [{ userId: actor, unit: "remainder", value: null }, { userId: other, unit: "remainder", value: null }],
  createdAt: new Date("2026-10-01T00:00:00Z") };

function fixture(over: Partial<domain.TripBalanceSnapshot> = {}) {
  let reads = 0;
  const snapshot: domain.TripBalanceSnapshot = { trip: { id: tripId, expenseMode: "balance" }, memberIds: [actor, other], expenses: [expense], ...over };
  const dependencies: domain.GetTripBalanceDependencies = { balance: { read: async () => { reads++; return domain.ok(snapshot); } } };
  const execute = (userId = actor) => domain.getTripBalance.execute(dependencies, { tripId, authenticatedUserId: userId });
  return { dependencies, execute, reads: () => reads };
}

describe("getTripBalance", () => {
  it("returns the balance to a current member with a single read", async () => {
    const f = fixture();
    const result = await f.execute();
    expect(result).toMatchObject({ ok: true, value: { tripId, expenseMode: "balance", includedExpenseCount: 1 } });
    if (result.ok) expect(result.value.currencies[0]!.settlements).toEqual([{ fromUserId: other, toUserId: actor, cents: 5000 }]);
    expect(f.reads()).toBe(1);
  });

  it("answers not found for a non-member", async () => {
    expect(await fixture().execute(id(99))).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
  });

  it("answers not found when the Trip does not exist", async () => {
    const f = fixture();
    f.dependencies.balance.read = async () => domain.ok(undefined);
    expect(await f.execute()).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
  });

  it("propagates a port error without a partial result", async () => {
    const f = fixture();
    const failure = domain.err(new domain.UnknownError("unavailable"));
    f.dependencies.balance.read = async () => failure as never;
    expect(await f.execute()).toEqual(failure);
  });

  it("decides authorization with the members of the same snapshot (an expelled user sees nothing)", async () => {
    expect(await fixture({ memberIds: [other] }).execute()).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
  });

  it("identifies former members and yields no debts in register mode", async () => {
    const former = await fixture({ memberIds: [actor] }).execute();
    expect(former).toMatchObject({ ok: true, value: { currencies: [{ balances: [{ userId: actor, formerMember: false }, { userId: other, formerMember: true }] }] } });
    const register = await fixture({ trip: { id: tripId, expenseMode: "register" } }).execute();
    expect(register).toMatchObject({ ok: true, value: { currencies: [], excludedExpenses: [], includedExpenseCount: 0 } });
  });
});
