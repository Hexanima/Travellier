import { ObjectId, type Db } from "mongodb";
import { checkExpenseCompleteness } from "app-domain";

export interface ContractFinding {
  code: "post_multiple_links" | "post_legacy_day" | "expense_legacy_paid_by" | "expense_incomplete"
    | "trip_owner_missing" | "trip_owner_not_member" | "trip_owner_not_admin";
  collection: "posts" | "postExpenses" | "trips";
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
    // Same single gap rule as the read path and migration 0006: payments absent or null; a present list (even []) is never legacy.
    if (paidBy !== null && (expense.payments === undefined || expense.payments === null)) {
      findings.push({ ...base, code: "expense_legacy_paid_by", fields: ["paidBy"], relatedIds: [paidBy] });
    }
    const complete = checkExpenseCompleteness({ totalAmount: expense.totalAmount, currency: expense.currency,
      payments: expenseRows(expense.payments), shares: expenseRows(expense.shares) });
    if (!complete.ok) findings.push({ ...base, code: "expense_incomplete", fields: complete.error.issues.map(({ field }) => field), relatedIds: [] });
  }
  // Titularidad (T114): solo diagnostica. El titular efectivo es ownerId o, si falta (migración 0010 pendiente), createdBy.
  const trips = database.collection("trips").find({}, { projection: { _id: 1, ownerId: 1, createdBy: 1 } }).sort({ _id: 1 });
  for await (const trip of trips) {
    const base = { collection: "trips" as const, documentId: trip._id, tripId: trip._id };
    const ownerId = reference(trip.ownerId);
    const createdBy = reference(trip.createdBy);
    if (ownerId === null) findings.push({ ...base, code: "trip_owner_missing", fields: ["ownerId"], relatedIds: createdBy === null ? [] : [createdBy] });
    const owner = ownerId ?? createdBy;
    if (owner === null) continue;
    const membership = await database.collection("tripMembers").findOne({ tripId: trip._id, userId: owner }, { projection: { role: 1 } });
    const fields = [ownerId === null ? "createdBy" : "ownerId"];
    if (membership === null) findings.push({ ...base, code: "trip_owner_not_member", fields, relatedIds: [owner] });
    else if (membership.role !== "admin") findings.push({ ...base, code: "trip_owner_not_admin", fields, relatedIds: [owner] });
  }
  return { findings };
};
