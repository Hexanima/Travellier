import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createObjectId, type ObjectId as DomainObjectId, type PushPlatform, type PushProvider } from "app-domain";

import { migrateMongoSchema } from "./migrations.js";
import { createMongoPushDeviceRepository } from "./push-device-repository.js";

const domainId = (id: ObjectId): DomainObjectId => {
  const result = createObjectId(id.toHexString());
  if (!result.ok) throw result.error;
  return result.value;
};
const NOW = new Date("2026-11-10T12:00:00.000Z");
const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);
const SENTINEL = "SENTINEL-token-0123456789-abcdefXYZ";

describe("MongoDB push device repository", () => {
  let server: MongoMemoryReplSet, client: MongoClient, database: Db;
  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    client = new MongoClient(server.getUri());
    await client.connect();
    database = client.db("push_devices_test");
    await migrateMongoSchema(database);
  }, 120_000);
  afterAll(async () => { await client?.close(); await server?.stop(); });
  beforeEach(async () => { await database.collection("pushDevices").deleteMany({}); });

  const repo = () => createMongoPushDeviceRepository(database);
  const devices = () => database.collection("pushDevices");
  const input = (userId: ObjectId, token: string, over: { now?: Date; limit?: number; provider?: PushProvider; platform?: PushPlatform } = {}) => ({
    userId: domainId(userId), provider: over.provider ?? "fcm", platform: over.platform ?? "android", token, now: over.now ?? NOW, limit: over.limit ?? 10,
  });

  it("creates a device with its timestamps", async () => {
    const user = new ObjectId();
    const result = await repo().register(input(user, "tok-1"));
    expect(result).toMatchObject({ ok: true, value: { created: true, device: { userId: user.toHexString(), provider: "fcm", platform: "android", token: "tok-1", createdAt: NOW, updatedAt: NOW, lastRegisteredAt: NOW } } });
    expect(await devices().countDocuments()).toBe(1);
  });

  it("registering the same token twice for the same user keeps one document, its id and createdAt, and advances updatedAt", async () => {
    const user = new ObjectId();
    const first = await repo().register(input(user, "tok-1"));
    const second = await repo().register(input(user, "tok-1", { now: at(60) }));
    if (!first.ok || !second.ok) throw new Error("expected success");
    expect(second.value.created).toBe(false);
    expect(second.value.device).toMatchObject({ id: first.value.device.id, createdAt: NOW, updatedAt: at(60), lastRegisteredAt: at(60) });
    expect(await devices().countDocuments()).toBe(1);
  });

  it("reassigns a token to the next account and leaves a single document", async () => {
    const a = new ObjectId(), b = new ObjectId();
    const first = await repo().register(input(a, "tok-1"));
    const second = await repo().register(input(b, "tok-1", { now: at(5) }));
    if (!first.ok || !second.ok) throw new Error("expected success");
    expect(second.value.device).toMatchObject({ id: first.value.device.id, userId: b.toHexString() });
    const docs = await devices().find().toArray();
    expect(docs).toHaveLength(1);
    expect(docs[0].userId.equals(b)).toBe(true);
  });

  it("treats the same token under another provider as a different device", async () => {
    const user = new ObjectId();
    await repo().register(input(user, "tok-1"));
    await repo().register(input(user, "tok-1", { provider: "apns", platform: "ios" }));
    expect(await devices().countDocuments()).toBe(2);
  });

  it("ends with one document when two users register the same token concurrently", async () => {
    const a = new ObjectId(), b = new ObjectId();
    const results = await Promise.all(Array.from({ length: 8 }, (_, index) => repo().register(input(index % 2 === 0 ? a : b, "tok-race"))));
    expect(results.every((result) => result.ok)).toBe(true);
    expect(await devices().countDocuments({ token: "tok-race" })).toBe(1);
  });

  it("ends with one document when the same user registers the same token concurrently", async () => {
    const user = new ObjectId();
    const results = await Promise.all(Array.from({ length: 6 }, () => repo().register(input(user, "tok-same"))));
    expect(results.every((result) => result.ok)).toBe(true);
    expect(await devices().countDocuments({ token: "tok-same" })).toBe(1);
  });

  describe("limit", () => {
    const fill = async (user: ObjectId, count: number) => {
      for (let index = 0; index < count; index += 1) expect((await repo().register(input(user, `own-${index}`, { now: at(index) }))).ok).toBe(true);
    };
    const tokensOf = async (user: ObjectId) => (await devices().find({ userId: user }).toArray()).map((doc) => doc.token).sort();

    it("evicts the oldest own device when registering an eleventh new one", async () => {
      const user = new ObjectId();
      await fill(user, 10);
      const result = await repo().register(input(user, "own-new", { now: at(100) }));
      expect(result).toMatchObject({ ok: true, value: { created: true } });
      const tokens = await tokensOf(user);
      expect(tokens).toHaveLength(10);
      expect(tokens).toContain("own-new");
      expect(tokens).not.toContain("own-0");
      expect(tokens).toContain("own-1");
    });

    it("breaks lastRegisteredAt ties by _id when evicting", async () => {
      const user = new ObjectId();
      for (let index = 0; index < 10; index += 1) await repo().register(input(user, `tie-${index}`));
      await repo().register(input(user, "tie-new"));
      const tokens = await tokensOf(user);
      expect(tokens).toHaveLength(10);
      expect(tokens).not.toContain("tie-0");
      expect(tokens).toContain("tie-1");
    });

    it("evicts by lastRegisteredAt: a recently re-registered device survives", async () => {
      const user = new ObjectId();
      await fill(user, 10);
      await repo().register(input(user, "own-0", { now: at(50) }));
      await repo().register(input(user, "own-new", { now: at(100) }));
      const tokens = await tokensOf(user);
      expect(tokens).toContain("own-0");
      expect(tokens).not.toContain("own-1");
      expect(tokens).toHaveLength(10);
    });

    it("re-registering an existing own token at the limit does not evict anything", async () => {
      const user = new ObjectId();
      await fill(user, 10);
      const result = await repo().register(input(user, "own-3", { now: at(99) }));
      expect(result).toMatchObject({ ok: true, value: { created: false } });
      expect(await tokensOf(user)).toHaveLength(10);
      expect(await tokensOf(user)).toContain("own-0");
    });

    it("a reassignment to a receiver at the limit is performed and neither evicts nor fails", async () => {
      const user = new ObjectId(), other = new ObjectId();
      await fill(user, 10);
      await repo().register(input(other, "foreign"));
      const result = await repo().register(input(user, "foreign", { now: at(100) }));
      expect(result).toMatchObject({ ok: true, value: { created: false } });
      expect((await devices().findOne({ token: "foreign" }))?.userId.equals(user)).toBe(true);
      expect(await devices().countDocuments({ userId: user })).toBe(11);
      expect(await tokensOf(user)).toContain("own-0");
      expect(await devices().countDocuments({ userId: other })).toBe(0);
    });

    it("honors the limit passed by the caller", async () => {
      const user = new ObjectId();
      await repo().register(input(user, "a", { limit: 1, now: at(1) }));
      expect((await repo().register(input(user, "b", { limit: 1, now: at(2) }))).ok).toBe(true);
      expect(await tokensOf(user)).toEqual(["b"]);
    });

    it("never carries the token in an error nor leaves it out of the evicting registration", async () => {
      const user = new ObjectId();
      await repo().register(input(user, "a", { limit: 1 }));
      const result = await repo().register(input(user, SENTINEL, { limit: 1, now: at(1) }));
      expect(result.ok).toBe(true);
      expect(await tokensOf(user)).toEqual([SENTINEL]);
    });

    it("is a soft limit under a burst, and a later sequential registration converges back to at most the limit", async () => {
      const user = new ObjectId();
      await fill(user, 10);
      await Promise.all(Array.from({ length: 5 }, (_, index) => repo().register(input(user, `burst-${index}`, { now: at(200 + index) }))));
      expect(await devices().countDocuments({ userId: user })).toBeGreaterThanOrEqual(10);
      expect((await repo().register(input(user, "after-burst", { now: at(300) }))).ok).toBe(true);
      expect(await devices().countDocuments({ userId: user })).toBeLessThanOrEqual(10);
      expect(await tokensOf(user)).toContain("after-burst");
    });
  });

  describe("revocation", () => {
    it("revokes by id only for the owner and is idempotent", async () => {
      const a = new ObjectId(), b = new ObjectId();
      const registered = await repo().register(input(a, "tok-1"));
      if (!registered.ok) throw new Error("expected success");
      const id = registered.value.device.id;

      expect(await repo().revokeById(domainId(b), id)).toEqual({ ok: true, value: undefined });
      expect(await devices().countDocuments()).toBe(1);
      expect(await repo().revokeById(domainId(a), id)).toEqual({ ok: true, value: undefined });
      expect(await devices().countDocuments()).toBe(0);
      expect(await repo().revokeById(domainId(a), id)).toEqual({ ok: true, value: undefined });
    });

    it("revokes by provider and token only for the owner and is idempotent", async () => {
      const a = new ObjectId(), b = new ObjectId();
      await repo().register(input(a, "tok-1"));
      expect(await repo().revokeByToken(domainId(b), "fcm", "tok-1")).toEqual({ ok: true, value: undefined });
      expect(await repo().revokeByToken(domainId(a), "apns", "tok-1")).toEqual({ ok: true, value: undefined });
      expect(await devices().countDocuments()).toBe(1);
      expect(await repo().revokeByToken(domainId(a), "fcm", "tok-1")).toEqual({ ok: true, value: undefined });
      expect(await devices().countDocuments()).toBe(0);
      expect(await repo().revokeByToken(domainId(a), "fcm", "tok-1")).toEqual({ ok: true, value: undefined });
    });

    it("removeInvalid deletes by provider and token whoever owns them", async () => {
      const a = new ObjectId(), b = new ObjectId();
      await repo().register(input(a, "bad-1"));
      await repo().register(input(b, "bad-2"));
      await repo().register(input(b, "good"));
      await repo().register(input(b, "bad-1", { provider: "apns", platform: "ios" }));
      expect(await repo().removeInvalid("fcm", ["bad-1", "bad-2", "missing"])).toEqual({ ok: true, value: 2 });
      expect((await devices().find().toArray()).map((doc) => `${doc.provider}:${doc.token}`).sort()).toEqual(["apns:bad-1", "fcm:good"]);
    });
  });

  it("returns an opaque error without the token when the database fails", async () => {
    const broken = createMongoPushDeviceRepository({
      collection: () => { throw new Error(`boom ${SENTINEL}`); },
      client: { startSession: () => { throw new Error(`boom ${SENTINEL}`); } },
    } as unknown as Db);
    const user = domainId(new ObjectId());
    for (const result of [
      await broken.register({ userId: user, provider: "fcm", platform: "android", token: SENTINEL, now: NOW, limit: 10 }),
      await broken.revokeById(user, domainId(new ObjectId())),
      await broken.revokeByToken(user, "fcm", SENTINEL),
      await broken.listForUser(user),
      await broken.removeInvalid("fcm", [SENTINEL]),
    ]) {
      expect(result).toMatchObject({ ok: false, error: { tag: "UnknownError", message: "Database operation failed." } });
      expect(JSON.stringify(result)).not.toContain(SENTINEL);
    }
  });

  it("lists only the devices of the user with their token, most recently registered first", async () => {
    const user = new ObjectId(), other = new ObjectId();
    await repo().register(input(user, "tok-old", { now: at(-60) }));
    await repo().register(input(user, "tok-new", { provider: "apns", platform: "ios" }));
    await repo().register(input(other, "tok-other"));
    const listed = await repo().listForUser(domainId(user));
    if (!listed.ok) throw new Error("expected success");
    expect(listed.value.map((device) => device.token)).toEqual(["tok-new", "tok-old"]);
    expect(listed.value[0]).toMatchObject({ userId: user.toHexString(), provider: "apns", platform: "ios" });
    expect(await repo().listForUser(domainId(new ObjectId()))).toEqual({ ok: true, value: [] });
  });

  it("enforces the unique (provider, token) index at the database level", async () => {
    const indexes = await devices().listIndexes().toArray();
    expect(indexes).toContainEqual(expect.objectContaining({ name: "provider_token_unique", key: { provider: 1, token: 1 }, unique: true }));
    await devices().insertOne({ userId: new ObjectId(), provider: "fcm", platform: "android", token: "dup", createdAt: NOW, updatedAt: NOW, lastRegisteredAt: NOW });
    await expect(devices().insertOne({ userId: new ObjectId(), provider: "fcm", platform: "android", token: "dup" })).rejects.toMatchObject({ code: 11000 });
  });
});
