import type { Db, IndexDescription } from "mongodb";

export const PUBLICATION_AGENDA_MIGRATION_ID = "0004-publication-and-personal-agenda-indexes";
export const OUTBOX_MIGRATION_ID = "0005-notification-outbox-indexes";
/** `pushDevices` is not defined by the PRD (T89): additive indexes only; the unique pair makes registration idempotent across accounts. */
export const PUSH_DEVICE_MIGRATION_ID = "0007-push-device-indexes";

/**
 * `outboxEvents` doubles as the personal inbox (T91, not defined by the PRD): one document per (event, recipient). Additive indexes only:
 * the inbox read (`userId`, newest first) and the Trip cascade/authorization (`tripId`). No TTL; it never touches existing documents.
 */
export const NOTIFICATION_INBOX_MIGRATION_ID = "0008-notification-inbox-indexes";

/**
 * `rateLimits` (T102, not defined by the PRD): Auth throttle counters shared by every Lambda instance. Additive TTL index only: it expires
 * counters after their window; correctness never depends on it because each document id includes the window start.
 */
export const RATE_LIMIT_MIGRATION_ID = "0009-rate-limit-ttl-index";

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
  {
    id: PUSH_DEVICE_MIGRATION_ID,
    collections: [{ name: "pushDevices", indexes: [
      { key: { provider: 1, token: 1 }, name: "provider_token_unique", unique: true },
      { key: { userId: 1 }, name: "userId" },
    ] }],
  },
  {
    id: NOTIFICATION_INBOX_MIGRATION_ID,
    collections: [{ name: "outboxEvents", indexes: [
      { key: { userId: 1, createdAt: -1, _id: -1 }, name: "userId_createdAt_id" },
      { key: { tripId: 1 }, name: "tripId" },
    ] }],
  },
  {
    id: RATE_LIMIT_MIGRATION_ID,
    collections: [{ name: "rateLimits", indexes: [{ key: { expiresAt: 1 }, name: "expiresAt_ttl", expireAfterSeconds: 0 }] }],
  },
];

/**
 * Legacy `paidBy` (a valid ObjectId) with `payments` absent or null becomes one payment of 100 percent by that person: the same
 * single gap rule as `hasLegacyPaymentsGap`/`adaptLegacyPaidBy` on the read path (a parity test pins both) and as the contract audit.
 * The filter compares the BSON type of the WHOLE fields with `$expr` (`paidBy` is `objectId`; `payments` is `missing` or `null`):
 * the query forms `{payments: null}` / `{paidBy: {$type: "objectId"}}` also match arrays holding a null element or an ObjectId
 * (`[null]`, `[row, null]`, `[ObjectId]`) and would overwrite valid rows or write a malformed one. It makes the update idempotent by itself:
 * a document that already has `payments` (even `[]`, cleared on purpose) never matches,
 * so a rerun or a concurrent save cannot duplicate or resurrect the payment. `paidBy` is kept; `currency`, `shares` and
 * `totalAmount` are never written, and a null, missing or invalid `paidBy` is left alone.
 */
export const EXPENSE_PAYMENTS_MIGRATION_ID = "0006-adapt-legacy-expense-paid-by";
const adaptLegacyExpensePayers = (database: Db) => database.collection("postExpenses").updateMany(
  { $expr: { $and: [
    { $eq: [{ $type: "$paidBy" }, "objectId"] },
    { $in: [{ $type: "$payments" }, ["missing", "null"]] },
  ] } },
  [{ $set: { payments: [{ userId: "$paidBy", unit: "percent", value: 100 }] } }],
);

/**
 * Titularidad (T114): `ownerId` nace de `createdBy` en los viajes que todavía no lo tienen. El filtro compara el tipo BSON de los campos
 * completos con `$expr` (`ownerId` ausente o null; `createdBy` ObjectId): nunca pisa un `ownerId` existente (ni uno ya transferido), no toca
 * otros campos ni colecciones y corre idempotente aunque se repita o compita. No corrige viajes cuyo creador ya no es miembro: los
 * diagnostica `auditMongoContracts` (`trip_owner_not_member`). Sin índice nuevo.
 */
export const TRIP_OWNER_MIGRATION_ID = "0010-trip-owner-from-created-by";
const deriveTripOwners = (database: Db) => database.collection("trips").updateMany(
  { $expr: { $and: [
    { $in: [{ $type: "$ownerId" }, ["missing", "null"]] },
    { $eq: [{ $type: "$createdBy" }, "objectId"] },
  ] } },
  [{ $set: { ownerId: "$createdBy" } }],
);

// Index DDL is additive (no data removal or replacement of historical indexes); 0006 and 0010 are the only data changes.
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
  if (!(await versions.findOne({ id: TRIP_OWNER_MIGRATION_ID }))) {
    await deriveTripOwners(database);
    await versions.updateOne({ id: TRIP_OWNER_MIGRATION_ID }, { $setOnInsert: { appliedAt: new Date() } }, { upsert: true });
  }
};
