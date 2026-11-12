import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoClient, ObjectId } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";

import { migrateMongoSchema } from "./migrations.js";

/**
 * Real expiration of notices (T135): the TTL monitor of a dedicated in-memory mongod runs every second (ttlMonitorSleepSecs=1), so the
 * index created by migration 0011 is exercised end to end instead of only its definition.
 */
describe("retention of notices by the TTL index (T135)", () => {
  let server: MongoMemoryServer;
  let client: MongoClient;

  beforeAll(async () => {
    server = await MongoMemoryServer.create({ instance: { args: ["--setParameter", "ttlMonitorSleepSecs=1"] } });
    client = await new MongoClient(server.getUri()).connect();
  }, 120_000);
  afterAll(async () => { await client?.close(); await server?.stop(); });

  const day = 24 * 3600 * 1000;
  const event = (eventKey: string, status: string, ageDays: number) => ({ _id: new ObjectId(), eventKey, status, type: "post.created", tripId: new ObjectId(),
    userId: new ObjectId(), createdAt: new Date(Date.now() - ageDays * day), availableAt: new Date(Date.now() - ageDays * day) });

  it("deletes old finished events and keeps pending ones, recent ones and unrelated collections", async () => {
    const database = client.db("retention_ttl");
    await migrateMongoSchema(database);
    const events = database.collection("outboxEvents");
    const docs = [
      event("old-sent", "sent", 91), event("old-skipped", "skipped", 120), event("old-failed", "failed", 100),
      event("old-pending", "pending", 200), event("recent-sent", "sent", 89), event("recent-failed", "failed", 1),
    ];
    await events.insertMany(docs);
    const marker = { _id: new ObjectId(), createdAt: new Date(Date.now() - 500 * day), status: "sent" };
    await database.collection("pushDevices").insertOne(marker);

    const deadline = Date.now() + 30_000;
    const survivors = async () => (await events.find().toArray()).map((doc) => doc.eventKey as string).sort();
    while (Date.now() < deadline && (await events.countDocuments({ eventKey: { $in: ["old-sent", "old-skipped", "old-failed"] } })) > 0) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(await survivors()).toEqual(["old-pending", "recent-failed", "recent-sent"]);
    // Let the monitor pass a few more times: a pending event never goes, however old.
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    expect(await survivors()).toEqual(["old-pending", "recent-failed", "recent-sent"]);
    expect(await database.collection("pushDevices").countDocuments({ _id: marker._id })).toBe(1);
  }, 60_000);

  it("expires an event once its dispatch finishes, if it was already older than 90 days", async () => {
    const database = client.db("retention_ttl_transition");
    await migrateMongoSchema(database);
    const events = database.collection("outboxEvents");
    const doc = event("late", "pending", 95);
    await events.insertOne(doc);
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    expect(await events.countDocuments({ _id: doc._id })).toBe(1);
    await events.updateOne({ _id: doc._id }, { $set: { status: "skipped", outcome: "expired" } });
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline && (await events.countDocuments({ _id: doc._id })) > 0) await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await events.countDocuments({ _id: doc._id })).toBe(0);
  }, 60_000);
});
