import { ObjectId, type Document } from "mongodb";

/**
 * One shared set of postExpenses documents for the single legacy `paidBy` gap rule: ONLY a `payments` that is absent or null
 * (the whole field value, never an array holding null) with a valid ObjectId `paidBy` is legacy. The read path, migration 0006
 * and the contract audit must classify each case identically.
 */
export const gapPayer = new ObjectId("00000000000000000000aa01");
export const gapOwnPayer = new ObjectId("00000000000000000000aa02");
const validRow = () => ({ userId: gapOwnPayer, unit: "amount", value: 10 });

export interface ExpenseGapCase { name: string; fields: Document; legacy: boolean }
export const expenseGapCases: ExpenseGapCase[] = [
  { name: "payments absent", fields: { paidBy: gapPayer }, legacy: true },
  { name: "payments null", fields: { paidBy: gapPayer, payments: null }, legacy: true },
  { name: "payments []", fields: { paidBy: gapPayer, payments: [] }, legacy: false },
  { name: "payments [null]", fields: { paidBy: gapPayer, payments: [null] }, legacy: false },
  { name: "payments [valid row, null]", fields: { paidBy: gapPayer, payments: [validRow(), null] }, legacy: false },
  { name: "own valid payments", fields: { paidBy: gapPayer, payments: [validRow()] }, legacy: false },
  { name: "payments string", fields: { paidBy: gapPayer, payments: "legacy" }, legacy: false },
  { name: "payments object", fields: { paidBy: gapPayer, payments: { userId: gapOwnPayer } }, legacy: false },
  { name: "payments number", fields: { paidBy: gapPayer, payments: 5 }, legacy: false },
  { name: "paidBy null with payments null", fields: { paidBy: null, payments: null }, legacy: false },
];
