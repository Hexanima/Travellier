import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { auditMongoContracts } from "./contract-audit.js";
import { legacyIds, seedVersion3Fixture, snapshotDocuments } from "../../../test/legacy-contract-fixture.js";

let server: MongoMemoryServer;
let client: MongoClient;
let database: Db;
let counter = 0;
beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = await new MongoClient(server.getUri(), { monitorCommands: true }).connect();
});
beforeEach(() => { database = client.db(`audit_${++counter}`); });
afterAll(async () => { await client?.close(); await server?.stop(); });

describe("read-only approved contract audit", () => {
  it("diagnoses simultaneous links without flagging valid branches or independent posts", async () => {
    await seedVersion3Fixture(database);
    const report = await auditMongoContracts(database);
    expect(report.findings.filter(({ code }) => code === "post_multiple_links")).toEqual([expect.objectContaining({
      collection: "posts", documentId: legacyIds.multipleLinks, tripId: legacyIds.trip,
      fields: ["activityId", "parentPostId", "transportId"],
    })]);
    expect(report.findings.filter(({ documentId }) => documentId.equals(legacyIds.child) || documentId.equals(legacyIds.branch) || documentId.equals(legacyIds.independent))).toEqual([]);
  });

  it("reports inherited post days with valid, missing and cross-Trip reference statuses", async () => {
    await seedVersion3Fixture(database);
    const report = await auditMongoContracts(database);
    expect(report.findings.filter(({ code }) => code === "post_legacy_day")).toEqual([
      expect.objectContaining({ documentId: legacyIds.root, fields: ["dayId"], referenceStatus: "valid" }),
      expect.objectContaining({ documentId: legacyIds.orphanDayPost, referenceStatus: "missing" }),
      expect.objectContaining({ documentId: legacyIds.foreignDayPost, referenceStatus: "different_trip" }),
    ]);
    expect(report.findings.map(({ collection }) => collection)).not.toContain("activities");
  });

  it("reports known legacy paidBy separately and missing currency, payments and shares without adapting", async () => {
    await seedVersion3Fixture(database);
    const report = await auditMongoContracts(database);
    expect(report.findings).toContainEqual(expect.objectContaining({
      code: "expense_legacy_paid_by", collection: "postExpenses", documentId: legacyIds.legacyExpense,
      fields: ["paidBy"], relatedIds: [legacyIds.formerUser],
    }));
    expect(report.findings).toContainEqual(expect.objectContaining({
      code: "expense_incomplete", documentId: legacyIds.legacyExpense, fields: ["currency", "payments", "shares"],
    }));
    expect(report.findings).toContainEqual(expect.objectContaining({
      code: "expense_incomplete", documentId: legacyIds.nullPayerExpense, fields: ["currency", "payments", "shares"],
    }));
    expect(report.findings.some(({ documentId }) => documentId.equals(legacyIds.completeExpense))).toBe(false);
  });

  it("is repeatable without writes, even for legacy data and migration version timestamps", async () => {
    await seedVersion3Fixture(database);
    const before = await snapshotDocuments(database);
    const commands: string[] = [];
    const observer = (event: { commandName: string }) => commands.push(event.commandName);
    client.on("commandStarted", observer);
    try {
      const first = await auditMongoContracts(database);
      expect(first.findings.length).toBeGreaterThan(0);
      expect(await auditMongoContracts(database)).toEqual(first);
      expect(await snapshotDocuments(database)).toEqual(before);
      expect(commands.filter((command) => !["find", "getMore", "listCollections", "killCursors"].includes(command))).toEqual([]);
    } finally { client.off("commandStarted", observer); }
  });

  it("does not create collections when auditing an empty database", async () => {
    expect(await auditMongoContracts(database)).toEqual({ findings: [] });
    expect(await database.listCollections().toArray()).toEqual([]);
  });

  it("reports an invalid inherited day ID without coercing it into an ObjectId", async () => {
    const post = new ObjectId();
    await database.collection("posts").insertOne({ _id: post, tripId: legacyIds.trip, dayId: "unknown" });
    expect((await auditMongoContracts(database)).findings).toContainEqual(expect.objectContaining({
      documentId: post, code: "post_legacy_day", referenceStatus: "invalid", relatedIds: [],
    }));
  });

  const payment = (unit: string, value: number) => ({ userId: legacyIds.formerUser, unit, value });
  const share = (unit: string, value: number | null, userId = legacyIds.formerUser) => ({ userId, unit, value });
  const completeExpense = () => ({ tripId: legacyIds.trip, postId: legacyIds.independent, totalAmount: 100, currency: "EUR",
    payments: [payment("percent", 100)], shares: [share("percent", 100)] });

  it.each([
    ["empty payments", { payments: [] }, ["payments"]],
    ["empty shares", { shares: [] }, ["shares"]],
    ["partial payments", { payments: [payment("amount", 50)] }, ["payments"]],
    ["partial shares", { shares: [share("percent", 50)] }, ["shares"]],
    ["unsupported currency", { currency: "BRL" }, ["currency"]],
    ["malformed payments", { payments: [{ userId: "unknown", unit: "amount", value: 100 }] }, ["payments"]],
    ["duplicate shares", { shares: [share("amount", 50), share("amount", 50)] }, ["shares"]],
    ["excess payments", { payments: [payment("amount", 101)] }, ["payments"]],
    ["excess fixed shares with remainder", { shares: [share("amount", 101), share("remainder", null, legacyIds.user)] }, ["shares"]],
  ])("diagnoses %s", async (_name, overrides, fields) => {
    const { insertedId } = await database.collection("postExpenses").insertOne({ ...completeExpense(), ...overrides });
    expect((await auditMongoContracts(database)).findings).toContainEqual(expect.objectContaining({
      code: "expense_incomplete", documentId: insertedId, fields,
    }));
  });

  it("accepts multiple payments, remainder/excluded shares and historical identities", async () => {
    await database.collection("postExpenses").insertOne({ ...completeExpense(), paidBy: legacyIds.formerUser,
      payments: [payment("amount", 35), payment("percent", 65)],
      shares: [share("amount", 35), share("excluded", null, new ObjectId()), share("remainder", null, legacyIds.user)] });
    expect(await auditMongoContracts(database)).toEqual({ findings: [] });
  });

  it("accepts complete percentages whose individual rounding leaves a cent residue", async () => {
    await database.collection("postExpenses").insertOne({ ...completeExpense(), totalAmount: 0.05,
      payments: [payment("percent", 50), payment("percent", 50)],
      shares: [share("percent", 50), share("percent", 50, legacyIds.user)] });
    expect(await auditMongoContracts(database)).toEqual({ findings: [] });
  });

  it("reports partial percentage coverage on a one-cent expense without modifying it", async () => {
    const { insertedId } = await database.collection("postExpenses").insertOne({ ...completeExpense(), totalAmount: 0.01,
      payments: [payment("percent", 60)], shares: [share("percent", 60)] });
    const before = await snapshotDocuments(database);
    expect((await auditMongoContracts(database)).findings).toEqual([expect.objectContaining({
      code: "expense_incomplete", collection: "postExpenses", documentId: insertedId,
      fields: ["payments", "shares"],
    })]);
    expect(await snapshotDocuments(database)).toEqual(before);
  });

  it("accepts decimal half-cent rounding in totals and fixed rows without adapting stored amounts", async () => {
    await database.collection("postExpenses").insertMany([
      { ...completeExpense(), totalAmount: 1.01, payments: [payment("amount", 1.005)], shares: [share("amount", 1.005)] },
      { ...completeExpense(), postId: legacyIds.root, totalAmount: 1.005, payments: [payment("amount", 1.01)] },
    ]);
    const before = await snapshotDocuments(database);
    expect(await auditMongoContracts(database)).toEqual({ findings: [] });
    expect(await snapshotDocuments(database)).toEqual(before);
  });

  it("reports shares whose per-row rounding makes the remainder negative without modifying the expense", async () => {
    const identities = [1, 2, 3, 4].map((n) => new ObjectId(n.toString(16).padStart(24, "0")));
    const { insertedId } = await database.collection("postExpenses").insertOne({ ...completeExpense(), totalAmount: 0.02,
      shares: [...identities.slice(0, 3).map((identity) => share("percent", 30, identity)), share("remainder", null, identities[3])] });
    const before = await snapshotDocuments(database);
    expect((await auditMongoContracts(database)).findings).toEqual([expect.objectContaining({
      code: "expense_incomplete", documentId: insertedId, fields: ["shares"],
    })]);
    expect(await snapshotDocuments(database)).toEqual(before);
  });

  it("reports a missing fixed cent in a large expense without changing its stored amounts", async () => {
    const { insertedId } = await database.collection("postExpenses").insertOne({ ...completeExpense(), totalAmount: 10000000000000,
      payments: [payment("amount", 9999999999999.99)] });
    const before = await snapshotDocuments(database);
    expect((await auditMongoContracts(database)).findings).toEqual([expect.objectContaining({
      code: "expense_incomplete", documentId: insertedId, fields: ["payments"],
    })]);
    expect(await snapshotDocuments(database)).toEqual(before);
  });
});
