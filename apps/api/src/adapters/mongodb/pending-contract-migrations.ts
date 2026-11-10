import type { Db, IndexDescription } from "mongodb";

export const PUBLICATION_AGENDA_MIGRATION_ID = "0004-publication-and-personal-agenda-indexes";
export const OUTBOX_MIGRATION_ID = "0005-notification-outbox-indexes";

const pendingMigrations: {
  id: string;
  collections: { name: string; indexes: IndexDescription[] }[];
}[] = [
  {
    id: PUBLICATION_AGENDA_MIGRATION_ID,
    collections: [
      { name: "posts", indexes: [{ key: { tripId: 1, createdAt: -1 }, name: "tripId_createdAt_desc" }] },
      { name: "activityParticipations", indexes: [{ key: { tripId: 1, userId: 1, status: 1 }, name: "tripId_userId_status" }] },
    ],
  },
  {
    id: OUTBOX_MIGRATION_ID,
    collections: [{ name: "outboxEvents", indexes: [
      { key: { eventKey: 1 }, name: "eventKey_unique", unique: true },
      { key: { status: 1, availableAt: 1 }, name: "status_availableAt" },
    ] }],
  },
];

/**
 * Legacy `paidBy` (a valid ObjectId) with no `payments` field becomes one payment of 100 percent by that person: the same rule as
 * `adaptLegacyPaidBy`, which the read path applies to documents this migration has not reached (a parity test pins both).
 * The filter makes it idempotent by itself: a document that already has `payments` (even `[]`, cleared on purpose) never matches,
 * so a rerun or a concurrent save cannot duplicate or resurrect the payment. `paidBy` is kept; `currency`, `shares` and
 * `totalAmount` are never written, and a null, missing or invalid `paidBy` is left alone.
 */
export const EXPENSE_PAYMENTS_MIGRATION_ID = "0006-adapt-legacy-expense-paid-by";
const adaptLegacyExpensePayers = (database: Db) => database.collection("postExpenses").updateMany(
  { paidBy: { $type: "objectId" }, payments: { $exists: false } },
  [{ $set: { payments: [{ userId: "$paidBy", unit: "percent", value: 100 }] } }],
);

// Index DDL is additive (no data removal or replacement of historical indexes); 0006 is the only data change.
export const migratePendingContracts = async (database: Db): Promise<void> => {
  const versions = database.collection<{ id: string; appliedAt: Date }>("_migrations");
  for (const migration of pendingMigrations) {
    if (await versions.findOne({ id: migration.id })) continue;
    for (const { name, indexes } of migration.collections) {
      await database.collection(name).createIndexes(indexes);
    }
    await versions.updateOne({ id: migration.id }, { $setOnInsert: { appliedAt: new Date() } }, { upsert: true });
  }
  if (!(await versions.findOne({ id: EXPENSE_PAYMENTS_MIGRATION_ID }))) {
    await adaptLegacyExpensePayers(database);
    await versions.updateOne({ id: EXPENSE_PAYMENTS_MIGRATION_ID }, { $setOnInsert: { appliedAt: new Date() } }, { upsert: true });
  }
};
