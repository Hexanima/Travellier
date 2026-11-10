import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { describePostExpense, resolveExpense } from "app-domain";
import { migrateMongoSchema } from "./migrations.js";
import { toPostExpense, type PostExpenseDocument } from "./post-expense-store.js";
import { legacyIds, seedVersion3Fixture, snapshotDocuments, version3Indexes } from "../../../test/legacy-contract-fixture.js";

const publicationVersion = "0004-publication-and-personal-agenda-indexes";
const eventVersion = "0005-notification-outbox-indexes";
const expensePaymentsVersion = "0006-adapt-legacy-expense-paid-by";
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
    // T80 (0006) is the only data change: the legacy payer becomes one payment of 100 percent. Every other document is identical.
    for (const name of Object.keys(version3Indexes).filter((collection) => collection !== "postExpenses")) {
      expect(after[name]).toEqual(before[name]);
    }
    for (const name of Object.keys(version3Indexes)) {
      expect(await database.collection(name).listIndexes().toArray()).toEqual(expect.arrayContaining(indexesBefore[name]));
    }
    expect(after._migrations).toEqual(expect.arrayContaining(before._migrations));
    expect(after._migrations.map(({ id }) => id)).toEqual(expect.arrayContaining([publicationVersion, eventVersion, expensePaymentsVersion]));
    const expenseOf = (documents: typeof after.postExpenses, expenseId: ObjectId) => documents.find(({ _id }) => _id.equals(expenseId));
    const legacyBefore = expenseOf(before.postExpenses, legacyIds.legacyExpense)!;
    expect(expenseOf(after.postExpenses, legacyIds.legacyExpense)).toEqual({ ...legacyBefore, payments: [{ userId: legacyIds.formerUser, unit: "percent", value: 100 }] });
    expect(expenseOf(after.postExpenses, legacyIds.legacyExpense)).not.toHaveProperty("currency");
    expect(expenseOf(after.postExpenses, legacyIds.legacyExpense)).not.toHaveProperty("shares");
    expect(expenseOf(after.postExpenses, legacyIds.nullPayerExpense)).toEqual(expenseOf(before.postExpenses, legacyIds.nullPayerExpense));
    expect(expenseOf(after.postExpenses, legacyIds.nullPayerExpense)).not.toHaveProperty("payments");
    expect(expenseOf(after.postExpenses, legacyIds.completeExpense)).toEqual(expenseOf(before.postExpenses, legacyIds.completeExpense));
  });

  it("is idempotent including version timestamps, data and indexes", async () => {
    await seedVersion3Fixture(database);
    await migrateMongoSchema(database);
    const before = await snapshotDocuments(database);
    expect(before._migrations.filter(({ id }) => id === publicationVersion || id === eventVersion || id === expensePaymentsVersion)).toHaveLength(3);
    const collections = await database.listCollections({}, { nameOnly: true }).toArray();
    const indexes = await Promise.all(collections.map(({ name }) => database.collection(name).listIndexes().toArray()));
    await migrateMongoSchema(database);
    expect(await snapshotDocuments(database)).toEqual(before);
    await migrateMongoSchema(database);
    expect(await snapshotDocuments(database)).toEqual(before);
    expect(await Promise.all(collections.map(({ name }) => database.collection(name).listIndexes().toArray()))).toEqual(indexes);
    // The payment of the legacy payer is not duplicated by repeated runs.
    expect(before.postExpenses.find(({ _id }) => _id.equals(legacyIds.legacyExpense))!.payments).toHaveLength(1);
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

  describe("0006 adapts the legacy single payer (T80)", () => {
    const expenses = async () => database.collection("postExpenses").find().sort({ _id: 1 }).toArray();
    const insertExpense = async (fields: Record<string, unknown>) => {
      const document = { _id: new ObjectId(), tripId: legacyIds.trip, postId: new ObjectId(), totalAmount: 60, createdAt: new Date("2026-10-03T12:00:00.789Z"), ...fields };
      await database.collection("postExpenses").insertOne(document);
      return document;
    };

    it("applies by its own filter even when run again without the version mark: no duplicate, no resurrected payment", async () => {
      await seedVersion3Fixture(database);
      const cleared = await insertExpense({ paidBy: new ObjectId(), payments: [], currency: "ARS" });
      await migrateMongoSchema(database);
      const first = await expenses();
      await database.collection("_migrations").deleteOne({ id: expensePaymentsVersion });
      await migrateMongoSchema(database);
      await database.collection("_migrations").deleteOne({ id: expensePaymentsVersion });
      await migrateMongoSchema(database);
      expect(await expenses()).toEqual(first);
      expect(first.find(({ _id }) => _id.equals(legacyIds.legacyExpense))!.payments).toHaveLength(1);
      expect(first.find(({ _id }) => _id.equals(cleared._id))!.payments).toEqual([]);
      expect(await database.collection("_migrations").countDocuments({ id: expensePaymentsVersion })).toBe(1);
    });

    it("does not touch an expense that already has payments, an explicit empty list, a null or invalid paidBy, nor one without paidBy", async () => {
      await seedVersion3Fixture(database);
      const own = await insertExpense({ paidBy: legacyIds.user, payments: [{ userId: legacyIds.formerUser, unit: "amount", value: 10 }], currency: "ARS" });
      const empty = await insertExpense({ paidBy: legacyIds.user, payments: [], currency: "EUR", shares: [] });
      const invalid = await insertExpense({ paidBy: "not-an-object-id" });
      const missing = await insertExpense({});
      const adapted = await insertExpense({ paidBy: legacyIds.user, payments: [{ userId: legacyIds.user, unit: "percent", value: 100 }] });
      const before = await expenses();
      await migrateMongoSchema(database);
      const after = await expenses();
      for (const untouched of [own, empty, invalid, missing, adapted]) {
        expect(after.find(({ _id }) => _id.equals(untouched._id))).toEqual(before.find(({ _id }) => _id.equals(untouched._id)));
      }
      expect(after.find(({ _id }) => _id.equals(invalid._id))).not.toHaveProperty("payments");
      expect(after.find(({ _id }) => _id.equals(missing._id))).not.toHaveProperty("payments");
    });

    it("one gap rule: payments null or absent is adapted once (reruns identical); [] , own payments and a null paidBy with null payments are untouched", async () => {
      await seedVersion3Fixture(database);
      const payer = new ObjectId();
      const nullPayments = await insertExpense({ paidBy: payer, payments: null, currency: "ARS" });
      const absent = await insertExpense({ paidBy: payer, currency: "ARS" });
      const empty = await insertExpense({ paidBy: payer, payments: [], currency: "ARS" });
      const own = await insertExpense({ paidBy: payer, payments: [{ userId: legacyIds.user, unit: "amount", value: 10 }] });
      const noPayer = await insertExpense({ paidBy: null, payments: null });
      const before = await expenses();
      await migrateMongoSchema(database);
      const first = await expenses();
      const find = (documents: typeof first, expense: { _id: ObjectId }) => documents.find(({ _id }) => _id.equals(expense._id));
      const adaptedPayments = [{ userId: payer, unit: "percent", value: 100 }];
      expect(find(first, nullPayments)).toEqual({ ...nullPayments, payments: adaptedPayments });
      expect(find(first, absent)).toEqual({ ...absent, payments: adaptedPayments });
      for (const untouched of [empty, own, noPayer]) expect(find(first, untouched)).toEqual(find(before, untouched));
      expect(find(first, noPayer)!.payments).toBeNull();
      for (const adapted of [nullPayments, absent]) {
        expect(find(first, adapted)).not.toHaveProperty("shares");
        expect(find(first, adapted)!.paidBy).toEqual(payer);
      }
      await database.collection("_migrations").deleteOne({ id: expensePaymentsVersion });
      await migrateMongoSchema(database);
      await database.collection("_migrations").deleteOne({ id: expensePaymentsVersion });
      await migrateMongoSchema(database);
      expect(await expenses()).toEqual(first);
    });

    it("reads the same expense before and after the migration for payments null, absent and []", async () => {
      await seedVersion3Fixture(database);
      const payer = new ObjectId();
      const ids = [(await insertExpense({ paidBy: payer, payments: null, currency: "ARS" }))._id,
        (await insertExpense({ paidBy: payer, currency: "ARS" }))._id,
        (await insertExpense({ paidBy: payer, payments: [], currency: "ARS" }))._id];
      const readable = async () => (await expenses()).map((document) => toPostExpense(document as unknown as PostExpenseDocument));
      const before = await readable();
      await migrateMongoSchema(database);
      const after = await readable();
      expect(after).toEqual(before);
      const payment = [{ userId: payer.toHexString(), unit: "percent", value: 100 }];
      expect(after.find(({ id }) => id === ids[0].toHexString())!.payments).toEqual(payment);
      expect(after.find(({ id }) => id === ids[1].toHexString())!.payments).toEqual(payment);
      expect(after.find(({ id }) => id === ids[2].toHexString())!.payments).toEqual([]);
    });

    it("keeps the payer who is a former member, expelled or who left the Trip, as historic identity with currency and shares untouched", async () => {
      await seedVersion3Fixture(database);
      const left = new ObjectId();
      await database.collection("tripMembers").insertOne({ tripId: legacyIds.trip, userId: left, role: "participant" });
      const paid = await insertExpense({ paidBy: left, currency: "USD", breakdown: null });
      await database.collection("tripMembers").deleteOne({ tripId: legacyIds.trip, userId: left });
      const current = await insertExpense({ paidBy: legacyIds.user });
      await migrateMongoSchema(database);
      const after = await expenses();
      expect(after.find(({ _id }) => _id.equals(paid._id))).toEqual({ ...paid, payments: [{ userId: left, unit: "percent", value: 100 }] });
      expect(after.find(({ _id }) => _id.equals(current._id))).toEqual({ ...current, payments: [{ userId: legacyIds.user, unit: "percent", value: 100 }] });
      expect(await database.collection("tripMembers").countDocuments({ userId: left })).toBe(0);
    });

    it("reads the same expense before and after the migration (read derivation and migration share one rule)", async () => {
      await seedVersion3Fixture(database);
      const readable = async () => (await expenses()).map((document) => toPostExpense(document as unknown as PostExpenseDocument));
      const before = await readable();
      await migrateMongoSchema(database);
      expect(await readable()).toEqual(before);
      const legacy = before.find(({ id }) => id === legacyIds.legacyExpense.toHexString())!;
      expect(legacy.payments).toEqual([{ userId: legacyIds.formerUser.toHexString(), unit: "percent", value: 100 }]);
      expect(legacy.currency).toBeNull(); expect(legacy.shares).toEqual([]);
      expect(before.find(({ id }) => id === legacyIds.nullPayerExpense.toHexString())!.payments).toEqual([]);
    });

    it("leaves a legacy expense incomplete (no currency, no shares) and out of the balance, and the null payer without payments", async () => {
      await seedVersion3Fixture(database);
      await migrateMongoSchema(database);
      const stored = await expenses();
      const read = (expenseId: ObjectId) => toPostExpense(stored.find(({ _id }) => _id.equals(expenseId)) as unknown as PostExpenseDocument);
      const legacy = read(legacyIds.legacyExpense);
      expect(describePostExpense(legacy, [])).toMatchObject({ completeness: { status: "incomplete", reasons: ["missing_currency", "missing_shares"] },
        formerMemberIds: [legacyIds.formerUser.toHexString()] });
      expect(resolveExpense({ totalAmount: legacy.totalAmount, payments: legacy.payments, shares: legacy.shares }))
        .toMatchObject({ status: "incomplete", reasons: ["missing_currency", "missing_shares"] });
      expect(describePostExpense(read(legacyIds.nullPayerExpense), []).completeness)
        .toEqual({ status: "incomplete", reasons: ["missing_currency", "missing_payments", "missing_shares"] });
      expect(describePostExpense(read(legacyIds.completeExpense), [legacyIds.user.toHexString() as never]).completeness).toEqual({ status: "complete", reasons: [] });
    });

    it("only reads, never writes, an expense that appears after the migration was recorded", async () => {
      await migrateMongoSchema(database);
      const late = await insertExpense({ paidBy: legacyIds.formerUser });
      await migrateMongoSchema(database);
      const [stored] = await expenses();
      expect(stored).toEqual(late);
      expect(toPostExpense(stored as unknown as PostExpenseDocument).payments).toEqual([{ userId: legacyIds.formerUser.toHexString(), unit: "percent", value: 100 }]);
    });

    it("is recorded once on a fresh database without data", async () => {
      await migrateMongoSchema(database);
      await migrateMongoSchema(database);
      expect(await database.collection("_migrations").countDocuments({ id: expensePaymentsVersion })).toBe(1);
      expect(await expenses()).toEqual([]);
    });
  });
});
