import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { migrateMongoSchema } from "./migrations.js";
import { legacyIds, seedVersion3Fixture, snapshotDocuments, version3Indexes } from "../../../test/legacy-contract-fixture.js";

const publicationVersion = "0004-publication-and-personal-agenda-indexes";
const eventVersion = "0005-notification-outbox-indexes";
let server: MongoMemoryServer;
let client: MongoClient;
let database: Db;
let counter = 0;
beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = await new MongoClient(server.getUri()).connect();
});
beforeEach(() => { database = client.db(`contracts_${++counter}`); });
afterAll(async () => { await client?.close(); await server?.stop(); });

describe("incremental pending contracts", () => {
  it("adds publication and personal agenda indexes on a fresh database", async () => {
    await migrateMongoSchema(database);
    expect(await database.collection("posts").listIndexes().toArray()).toContainEqual(expect.objectContaining({
      name: "tripId_createdAt_desc", key: { tripId: 1, createdAt: -1 },
    }));
    expect(await database.collection("activityParticipations").listIndexes().toArray()).toContainEqual(expect.objectContaining({
      name: "tripId_userId_status", key: { tripId: 1, userId: 1, status: 1 },
    }));
  });

  it("versions outbox deduplication and retry indexes without a deletion TTL", async () => {
    await migrateMongoSchema(database);
    expect(await database.listCollections({ name: "outboxEvents" }).hasNext()).toBe(true);
    const indexes = await database.collection("outboxEvents").listIndexes().toArray();
    expect(indexes).toContainEqual(expect.objectContaining({ name: "eventKey_unique", key: { eventKey: 1 }, unique: true }));
    expect(indexes).toContainEqual(expect.objectContaining({ name: "status_availableAt", key: { status: 1, availableAt: 1 } }));
    expect(indexes.some((index) => index.expireAfterSeconds !== undefined)).toBe(false);
    await database.collection("outboxEvents").insertOne({ eventKey: "operation-1", tripId: legacyIds.trip });
    await expect(database.collection("outboxEvents").insertOne({ eventKey: "operation-1", tripId: legacyIds.trip })).rejects.toMatchObject({ code: 11000 });
  });

  it("upgrades 0003 without changing any BSON document, reference or old index", async () => {
    await seedVersion3Fixture(database);
    const before = await snapshotDocuments(database);
    const indexesBefore = Object.fromEntries(await Promise.all(Object.keys(version3Indexes).map(async (name) =>
      [name, await database.collection(name).listIndexes().toArray()])));
    await migrateMongoSchema(database);
    const after = await snapshotDocuments(database);
    for (const name of Object.keys(version3Indexes)) {
      expect(after[name]).toEqual(before[name]);
      expect(await database.collection(name).listIndexes().toArray()).toEqual(expect.arrayContaining(indexesBefore[name]));
    }
    expect(after._migrations).toEqual(expect.arrayContaining(before._migrations));
    expect(after._migrations.map(({ id }) => id)).toEqual(expect.arrayContaining([publicationVersion, eventVersion]));
    expect(after.postExpenses.find(({ _id }) => _id.equals(legacyIds.legacyExpense))).not.toHaveProperty("payments");
  });

  it("is idempotent including version timestamps, data and indexes", async () => {
    await seedVersion3Fixture(database);
    await migrateMongoSchema(database);
    const before = await snapshotDocuments(database);
    expect(before._migrations.filter(({ id }) => id === publicationVersion || id === eventVersion)).toHaveLength(2);
    const collections = await database.listCollections({}, { nameOnly: true }).toArray();
    const indexes = await Promise.all(collections.map(({ name }) => database.collection(name).listIndexes().toArray()));
    await migrateMongoSchema(database);
    expect(await snapshotDocuments(database)).toEqual(before);
    expect(await Promise.all(collections.map(({ name }) => database.collection(name).listIndexes().toArray()))).toEqual(indexes);
  });

  it("does not mark a partial index migration and safely resumes it after explicit resolution", async () => {
    await seedVersion3Fixture(database);
    const before = await snapshotDocuments(database);
    await database.collection("activityParticipations").createIndex({ status: 1 }, { name: "tripId_userId_status" });
    await expect(migrateMongoSchema(database)).rejects.toMatchObject({ code: 86 });
    expect(await database.collection("_migrations").findOne({ id: publicationVersion })).toBeNull();
    for (const name of Object.keys(version3Indexes)) expect((await snapshotDocuments(database))[name]).toEqual(before[name]);
    // Explicit repair of a conflicting index in the ephemeral test database only.
    await database.collection("activityParticipations").dropIndex("tripId_userId_status");
    await migrateMongoSchema(database);
    await migrateMongoSchema(database);
    expect(await database.collection("_migrations").countDocuments({ id: publicationVersion })).toBe(1);
    expect(await database.collection("_migrations").countDocuments({ id: eventVersion })).toBe(1);
  });

  it("reports duplicate event keys without deleting or deduplicating existing events", async () => {
    await seedVersion3Fixture(database);
    await database.collection("outboxEvents").insertMany([{ eventKey: "same" }, { eventKey: "same" }]);
    const events = await database.collection("outboxEvents").find().sort({ _id: 1 }).toArray();
    await expect(migrateMongoSchema(database)).rejects.toThrow();
    expect(await database.collection("_migrations").findOne({ id: eventVersion })).toBeNull();
    expect(await database.collection("outboxEvents").find().sort({ _id: 1 }).toArray()).toEqual(events);
  });
});
