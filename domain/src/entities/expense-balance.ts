import { CURRENCIES, type Currency } from "../value-objects/money.js";
import type { ObjectId } from "../value-objects/object-id.js";
import type { BalanceSettlement, CurrencyBalance, ExcludedExpense, TripBalance } from "../types/trip-balance.js";
import { resolveExpense } from "./expense.js";
import type { PostExpense } from "./post-expense.js";

export interface CalculateTripBalanceInput {
  tripId: ObjectId;
  expenseMode: "register" | "balance";
  /** Current members; any other identity in the rows is a former member (identified by absence, never dropped). */
  memberIds: readonly ObjectId[];
  expenses: readonly PostExpense[];
}

const SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const byUser = (a: ObjectId, b: ObjectId) => (a < b ? -1 : a > b ? 1 : 0);
const byExpense = (a: PostExpense, b: PostExpense) => a.createdAt.getTime() - b.createdAt.getTime() || byUser(a.id, b.id);

type Totals = Map<ObjectId, { paid: bigint; share: bigint }>;

/**
 * Greedy stable settlement: debtors and creditors by amount descending (userId ascending on ties), the smaller side
 * settles each step. Exact in cents, deterministic and at most n-1 transfers; it does not claim a minimum count.
 */
const settle = (nets: Map<ObjectId, number>): BalanceSettlement[] => {
  const order = (a: [ObjectId, number], b: [ObjectId, number]) => b[1] - a[1] || byUser(a[0], b[0]);
  const debtors = [...nets].filter(([, value]) => value < 0).map(([userId, value]): [ObjectId, number] => [userId, -value]);
  const creditors = [...nets].filter(([, value]) => value > 0);
  const settlements: BalanceSettlement[] = [];
  while (debtors.length > 0 && creditors.length > 0) {
    debtors.sort(order);
    creditors.sort(order);
    const debtor = debtors[0]!, creditor = creditors[0]!;
    const cents = Math.min(debtor[1], creditor[1]);
    settlements.push({ fromUserId: debtor[0], toUserId: creditor[0], cents });
    debtor[1] -= cents;
    creditor[1] -= cents;
    if (debtor[1] === 0) debtors.shift();
    if (creditor[1] === 0) creditors.shift();
  }
  return settlements;
};

/**
 * Pure and deterministic balance of a Trip. Only `balance` mode produces debts. Each expense is resolved by `resolveExpense`
 * (the single source of cents); incomplete ones are excluded with their reasons and never contribute. Currencies are never
 * mixed or converted. The sum of net cents per currency must be zero; a broken invariant throws instead of being corrected.
 */
export const calculateTripBalance = ({ tripId, expenseMode, memberIds, expenses }: CalculateTripBalanceInput): TripBalance => {
  if (expenseMode === "register") return { tripId, expenseMode, currencies: [], excludedExpenses: [], includedExpenseCount: 0 };
  const members = new Set(memberIds);
  const totals = new Map<Currency, Totals>();
  const counts = new Map<Currency, number>();
  const excludedExpenses: ExcludedExpense[] = [];
  const exclude = (expense: PostExpense, reasons: ExcludedExpense["reasons"], totalCents: number | null) => {
    const identities = new Set([...expense.payments, ...expense.shares].map((row) => row.userId).filter((userId) => !members.has(userId)));
    excludedExpenses.push({ expenseId: expense.id, postId: expense.postId, currency: expense.currency, totalCents, reasons,
      formerMemberIds: [...identities].sort(byUser) });
  };
  let includedExpenseCount = 0;
  for (const expense of [...expenses].sort(byExpense)) {
    const resolution = resolveExpense({ totalAmount: expense.totalAmount, ...(expense.currency === null ? {} : { currency: expense.currency }),
      payments: expense.payments, shares: expense.shares });
    if (resolution.status === "incomplete") {
      exclude(expense, resolution.reasons, resolution.totalCents ?? null);
      continue;
    }
    // Work on a copy so an overflowing legacy aggregate excludes this expense without leaving partial sums.
    const current = totals.get(resolution.currency) ?? new Map();
    const next: Totals = new Map([...current].map(([userId, value]) => [userId, { ...value }]));
    const add = (userId: ObjectId, field: "paid" | "share", cents: number) => {
      const row = next.get(userId) ?? { paid: 0n, share: 0n };
      row[field] += BigInt(cents);
      next.set(userId, row);
    };
    for (const row of resolution.payments) add(row.userId, "paid", row.cents);
    for (const row of resolution.shares) add(row.userId, "share", row.cents);
    if ([...next.values()].some((row) => row.paid > SAFE || row.share > SAFE)) {
      exclude(expense, ["invalid_rules"], resolution.totalCents);
      continue;
    }
    totals.set(resolution.currency, next);
    counts.set(resolution.currency, (counts.get(resolution.currency) ?? 0) + 1);
    includedExpenseCount += 1;
  }
  const currencies: CurrencyBalance[] = [];
  for (const currency of CURRENCIES) {
    const entry = totals.get(currency);
    if (entry === undefined) continue;
    const balances = [...entry].sort(([a], [b]) => byUser(a, b)).map(([userId, row]) => ({
      userId, paidCents: Number(row.paid), shareCents: Number(row.share), netCents: Number(row.paid - row.share), formerMember: !members.has(userId) }));
    if (balances.reduce((sum, row) => sum + BigInt(row.netCents), 0n) !== 0n) throw new Error(`Balance invariant broken for ${currency}.`);
    currencies.push({ currency, expenseCount: counts.get(currency) ?? 0, balances, settlements: settle(new Map(balances.map((row) => [row.userId, row.netCents]))) });
  }
  return { tripId, expenseMode, currencies, excludedExpenses, includedExpenseCount };
};
