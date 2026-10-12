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

// Additive DDL only: no backfills, data removal or replacement of historical indexes.
export const migratePendingContracts = async (database: Db): Promise<void> => {
  const versions = database.collection<{ id: string; appliedAt: Date }>("_migrations");
  for (const migration of pendingMigrations) {
    if (await versions.findOne({ id: migration.id })) continue;
    for (const { name, indexes } of migration.collections) {
      await database.collection(name).createIndexes(indexes);
    }
    await versions.updateOne({ id: migration.id }, { $setOnInsert: { appliedAt: new Date() } }, { upsert: true });
  }
};
