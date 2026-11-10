import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createObjectId, type ObjectId as DomainObjectId } from "app-domain";

import { migrateMongoSchema } from "./migrations.js";
import { createMongoPhotoLinkRepository } from "./photo-link-repository.js";
import { createMongoStorageDeletionJobRepository } from "./storage-deletion-job-repository.js";

const domainId = (id: ObjectId): DomainObjectId => {
  const result = createObjectId(id.toHexString());
  if (!result.ok) throw result.error;
  return result.value;
};
const NOW = new Date("2026-11-10T12:00:00.000Z");
const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);

describe("MongoDB storage deletion job repository", () => {
  let server: MongoMemoryServer, client: MongoClient, database: Db;
  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    client = new MongoClient(server.getUri());
    await client.connect();
    database = client.db("storage_deletion_jobs_test");
    await migrateMongoSchema(database);
  }, 120_000);
  afterAll(async () => { await client?.close(); await server?.stop(); });
  beforeEach(async () => { for (const collection of await database.collections()) await collection.deleteMany({}); });

  const jobs = () => createMongoStorageDeletionJobRepository(database);
  const insert = (over: Record<string, unknown> = {}) => database.collection("storageDeletionJobs").insertOne({
    tripId: new ObjectId(), objectKeys: ["a", "b"], createdAt: at(-100), status: "pending", attempts: 0, resolvedKeys: [], rejectedKeys: [],
    nextAttemptAt: at(-100), ...over });

  it("claims an eligible job, leases it and reports its progress", async () => {
    const { insertedId } = await insert({ resolvedKeys: ["a"], attempts: 2 });
    const claim = await jobs().claimNext({ now: NOW, leaseUntil: at(120), owner: "w1" });
    expect(claim).toMatchObject({ ok: true, value: { id: insertedId.toHexString(), objectKeys: ["a", "b"], resolvedKeys: ["a"], rejectedKeys: [], attempts: 2 } });
    expect(await database.collection("storageDeletionJobs").findOne({ _id: insertedId })).toMatchObject({ leaseOwner: "w1", leaseUntil: at(120), lastAttemptAt: NOW });
  });

  it("does not claim completed, failed, not-yet-due or leased jobs, and reclaims an expired lease", async () => {
    await insert({ status: "completed" });
    await insert({ status: "failed" });
    await insert({ nextAttemptAt: at(1) });
    const leased = await insert({ leaseOwner: "w0", leaseUntil: at(10) });
    expect(await jobs().claimNext({ now: NOW, leaseUntil: at(120), owner: "w1" })).toEqual({ ok: true, value: undefined });
    expect(await jobs().claimNext({ now: at(10), leaseUntil: at(130), owner: "w1" })).toMatchObject({ ok: true, value: { id: leased.insertedId.toHexString() } });
    expect(await database.collection("storageDeletionJobs").findOne({ _id: leased.insertedId })).toMatchObject({ leaseOwner: "w1" });
  });

  it("claims a legacy-shaped job without lease fields and gives a job to only one of concurrent claimers", async () => {
    await insert();
    const results = await Promise.all(["w1", "w2", "w3", "w4"].map((owner) => jobs().claimNext({ now: NOW, leaseUntil: at(120), owner })));
    expect(results.filter((result) => result.ok && result.value !== undefined)).toHaveLength(1);
  });

  it("filters every write after the claim by the lease owner", async () => {
    const { insertedId } = await insert();
    await jobs().claimNext({ now: NOW, leaseUntil: at(120), owner: "w1" });
    const collection = database.collection("storageDeletionJobs");
    expect(await jobs().recordResolved(domainId(insertedId), "w2", { resolved: ["a"], rejected: ["b"] })).toEqual({ ok: true, value: false });
    expect(await jobs().complete(domainId(insertedId), "w2", NOW)).toEqual({ ok: true, value: false });
    expect(await jobs().releaseFailed(domainId(insertedId), "w2", { now: NOW, nextAttemptAt: at(60), attempts: 1, status: "pending", lastErrorCode: "x" }))
      .toEqual({ ok: true, value: false });
    expect(await collection.findOne({ _id: insertedId })).toMatchObject({ status: "pending", resolvedKeys: [], rejectedKeys: [], attempts: 0, leaseOwner: "w1" });
    expect(await jobs().recordResolved(domainId(insertedId), "w1", { resolved: ["a"], rejected: ["b"] })).toEqual({ ok: true, value: true });
    expect(await jobs().recordResolved(domainId(insertedId), "w1", { resolved: ["a"], rejected: [] })).toEqual({ ok: true, value: true });
    expect(await collection.findOne({ _id: insertedId })).toMatchObject({ resolvedKeys: ["a"], rejectedKeys: ["b"] });
  });

  it("completes and releases a job keeping the document", async () => {
    const first = await insert(), second = await insert({ nextAttemptAt: at(-50) });
    const collection = database.collection("storageDeletionJobs");
    expect(await jobs().claimNext({ now: NOW, leaseUntil: at(120), owner: "w1" })).toMatchObject({ ok: true, value: { id: first.insertedId.toHexString() } });
    expect(await jobs().complete(domainId(first.insertedId), "w1", NOW)).toEqual({ ok: true, value: true });
    expect(await collection.findOne({ _id: first.insertedId })).toMatchObject({ status: "completed", completedAt: NOW });
    expect(await collection.findOne({ _id: first.insertedId })).not.toHaveProperty("leaseUntil");
    expect(await jobs().claimNext({ now: NOW, leaseUntil: at(120), owner: "w1" })).toMatchObject({ ok: true, value: { id: second.insertedId.toHexString() } });
    expect(await jobs().releaseFailed(domainId(second.insertedId), "w1", { now: NOW, nextAttemptAt: at(60), attempts: 3, status: "failed", lastErrorCode: "delete_failed" }))
      .toEqual({ ok: true, value: true });
    expect(await collection.findOne({ _id: second.insertedId })).toMatchObject({ status: "failed", attempts: 3, nextAttemptAt: at(60), lastErrorCode: "delete_failed", lastAttemptAt: NOW });
    expect(await collection.findOne({ _id: second.insertedId })).not.toHaveProperty("leaseOwner");
    expect(await collection.countDocuments({})).toBe(2);
  });

  it("finds the keys still linked in postPhotos of any Trip", async () => {
    await database.collection("postPhotos").insertMany([{ tripId: new ObjectId(), postId: new ObjectId(), order: 1, s3Key: "k1" }, { tripId: new ObjectId(), postId: new ObjectId(), order: 1, s3Key: "k2" }]);
    expect(await createMongoPhotoLinkRepository(database).findLinkedKeys(["k1", "k3"])).toEqual({ ok: true, value: new Set(["k1"]) });
    expect(await createMongoPhotoLinkRepository(database).findLinkedKeys([])).toEqual({ ok: true, value: new Set() });
  });
});
