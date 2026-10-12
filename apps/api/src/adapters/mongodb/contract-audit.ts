import { ObjectId, type Db } from "mongodb";
import { checkExpenseCompleteness } from "app-domain";

export interface ContractFinding {
  code: "post_multiple_links" | "post_legacy_day" | "expense_legacy_paid_by" | "expense_incomplete";
  collection: "posts" | "postExpenses";
  documentId: ObjectId;
  tripId: ObjectId | null;
  fields: string[];
  relatedIds: ObjectId[];
  referenceStatus?: "valid" | "missing" | "different_trip" | "invalid";
}
export interface ContractAuditReport { findings: ContractFinding[] }

const reference = (value: unknown): ObjectId | null => value instanceof ObjectId ? value : null;
const expenseRows = (value: unknown): unknown => !Array.isArray(value) ? value : value.map((row: unknown) => {
  if (row === null || typeof row !== "object") return row;
  const fields = row as Record<string, unknown>;
  return { ...fields, userId: reference(fields.userId)?.toHexString() ?? null };
});

export const auditMongoContracts = async (database: Db): Promise<ContractAuditReport> => {
  const findings: ContractFinding[] = [];
  const posts = database.collection("posts").find({}, { projection: { _id: 1, tripId: 1, dayId: 1, activityId: 1, parentPostId: 1, transportId: 1 } }).sort({ _id: 1 });
  for await (const post of posts) {
    const base = { collection: "posts" as const, documentId: post._id, tripId: reference(post.tripId) };
    const links = ["activityId", "parentPostId", "transportId"].filter((field) => post[field] != null);
    if (links.length > 1) findings.push({ ...base, code: "post_multiple_links", fields: links,
      relatedIds: links.map((field) => reference(post[field])).filter((id): id is ObjectId => id !== null) });
    if (Object.hasOwn(post, "dayId")) {
      const dayId = reference(post.dayId);
      const day = dayId === null ? null : await database.collection("itineraryDays").findOne({ _id: dayId }, { projection: { tripId: 1 } });
      const referenceStatus = dayId === null ? "invalid" : day === null ? "missing"
        : base.tripId !== null && base.tripId.equals(reference(day.tripId)) ? "valid" : "different_trip";
      findings.push({ ...base, code: "post_legacy_day", fields: ["dayId"], relatedIds: dayId === null ? [] : [dayId], referenceStatus });
    }
  }
  const expenses = database.collection("postExpenses").find({}, { projection: { _id: 1, tripId: 1, totalAmount: 1, currency: 1, paidBy: 1, payments: 1, shares: 1 } }).sort({ _id: 1 });
  for await (const expense of expenses) {
    const base = { collection: "postExpenses" as const, documentId: expense._id, tripId: reference(expense.tripId) };
    const paidBy = reference(expense.paidBy);
    if (paidBy !== null && (!Array.isArray(expense.payments) || expense.payments.length === 0)) {
      findings.push({ ...base, code: "expense_legacy_paid_by", fields: ["paidBy"], relatedIds: [paidBy] });
    }
    const complete = checkExpenseCompleteness({ totalAmount: expense.totalAmount, currency: expense.currency,
      payments: expenseRows(expense.payments), shares: expenseRows(expense.shares) });
    if (!complete.ok) findings.push({ ...base, code: "expense_incomplete", fields: complete.error.issues.map(({ field }) => field), relatedIds: [] });
  }
  return { findings };
};
