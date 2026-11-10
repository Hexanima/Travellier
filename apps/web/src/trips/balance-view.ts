import type { ExpenseCurrency } from "./expense-draft.js";
import { formatCents, formatPlainCents } from "./expense-format.js";
import type { PhotoPeople } from "./photo-people.js";
import type { BalanceReason, ExcludedExpense, TripBalance } from "./trip-balance-api.js";

/** Total map: a new reason in the contract does not compile until it has a text. */
export const reasonText: Record<BalanceReason, string> = {
  missing_currency: "Falta indicar la moneda",
  missing_payments: "Faltan los pagos",
  missing_shares: "Falta el reparto",
  payments_not_covering_total: "Los pagos no cubren el total",
  shares_not_covering_total: "El reparto no cubre el total",
  no_remainder_participant: "Falta alguien que reciba el resto",
  invalid_rules: "Los datos del gasto no son válidos; revisalos en el recuerdo",
};

/**
 * One label per person for the whole screen. Former members are numbered by order of appearance: the balances of each currency (server order),
 * then the settlements, then the former members listed by pending expenses. The server mark `formerMember` wins over the inference from the
 * members list; without a mark and without a name the person is only «Integrante» (never assumed to be a former member).
 */
export const balanceLabels = (balance: TripBalance, people: PhotoPeople): ((userId: string) => string) => {
  const order: string[] = [], marks = new Map<string, boolean>();
  const see = (userId: string) => { if (!order.includes(userId)) order.push(userId); };
  for (const { balances } of balance.currencies) for (const { userId, formerMember } of balances) { see(userId); marks.set(userId, (marks.get(userId) ?? false) || formerMember); }
  for (const { settlements } of balance.currencies) for (const { fromUserId, toUserId } of settlements) { see(fromUserId); see(toUserId); }
  for (const { formerMemberIds } of balance.excludedExpenses) for (const userId of formerMemberIds) { see(userId); if (!marks.has(userId)) marks.set(userId, true); }
  const numbers = new Map(order.filter((userId) => marks.get(userId) === true).map((userId, index): [string, number] => [userId, index + 1]));
  return (userId) => {
    const number = numbers.get(userId);
    if (number !== undefined) return `Ex integrante ${number}`;
    if (!people.loaded) return "Integrante";
    if (userId === people.currentUserId) return "Vos";
    return people.names.get(userId) || "Integrante";
  };
};

export const memberStatus = (netCents: number, currency: ExpenseCurrency): string =>
  netCents > 0 ? `Tiene a favor ${formatCents(netCents, currency)}` : netCents < 0 ? `Debe ${formatCents(-netCents, currency)}` : "Sin saldo pendiente";
/** A suggestion: the app does not register what is later done outside it. */
export const settlementText = (from: string, to: string, cents: number, currency: ExpenseCurrency): string =>
  to === "Vos" ? `${from} te debe ${formatCents(cents, currency)}` : `${from} le ${from === "Vos" ? "debés" : "debe"} ${formatCents(cents, currency)} a ${to}`;

export const excludedAmount = ({ currency, totalCents }: Pick<ExcludedExpense, "currency" | "totalCents">): string =>
  totalCents === null ? "Importe no disponible" : currency === null ? `${formatPlainCents(totalCents)} (moneda sin indicar)` : formatCents(totalCents, currency);
export const formerText = (ids: readonly string[], label: (userId: string) => string): string => `Incluye a ex integrantes: ${ids.map(label).join(", ")}`;

export type ExcludedAction = "split" | "expense";
/** `split`: payments and shares editor; `expense`: currency selector. Several reasons can offer both. */
export const excludedActions = (reasons: readonly BalanceReason[]): ExcludedAction[] => [
  ...(reasons.some((reason) => reason !== "missing_currency") ? ["split" as const] : []),
  ...(reasons.includes("missing_currency") ? ["expense" as const] : []),
];
export const actionLabel: Record<ExcludedAction, string> = { split: "Completar pagos y reparto", expense: "Elegir moneda" };
