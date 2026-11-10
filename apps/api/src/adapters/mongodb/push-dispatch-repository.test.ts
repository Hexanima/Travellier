import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { PUSH_DISPATCH_MAX_ATTEMPTS, createObjectId, dispatchPushNotifications, ok, type ObjectId as DomainObjectId, type PushDevice, type PushSendResult } from "app-domain";

import { migrateMongoSchema } from "./migrations.js";
import { createMongoDispatchAudience, createMongoPushDispatchRepository } from "./push-dispatch-repository.js";
import { createMongoUserNotificationQueryRepository } from "./user-notification-repository.js";

const domainId = (id: ObjectId): DomainObjectId => {
  const result = createObjectId(id.toHexString());
  if (!result.ok) throw result.error;
  return result.value;
};
const NOW = new Date("2026-11-10T12:00:00.000Z");
const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);

describe("MongoDB push dispatch repository", () => {
  let server: MongoMemoryServer, client: MongoClient, database: Db;
  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    client = new MongoClient(server.getUri());
    await client.connect();
    database = client.db("push_dispatch_test");
    await migrateMongoSchema(database);
  }, 120_000);
  afterAll(async () => { await client?.close(); await server?.stop(); });
  beforeEach(async () => { for (const collection of await database.collections()) await collection.deleteMany({}); });

  const dispatch = () => createMongoPushDispatchRepository(database);
  const events = () => database.collection("outboxEvents");
  const user = new ObjectId(), trip = new ObjectId(), activity = new ObjectId();
  /** Same shape T91 persists: no dispatch fields. */
  const insert = (over: Record<string, unknown> = {}) => events().insertOne({
    tripId: trip, eventKey: `activity.updated:${new ObjectId().toHexString()}:${user.toHexString()}`, type: "activity.updated", status: "pending", availableAt: at(-10),
    createdAt: at(-10), userId: user, actorId: new ObjectId(), operationKey: "op", payload: { activityId: activity, actorId: new ObjectId(), changedFields: ["scheduledAt"] }, ...over });
  const claim = (owner: string, now = NOW) => dispatch().claimNext({ now, leaseUntil: new Date(now.getTime() + 120_000), owner });

  it("claims a pending event of T91 without dispatch fields and returns it as a domain event", async () => {
    const { insertedId } = await insert();
    const claimed = await claim("w1");
    expect(claimed).toMatchObject({ ok: true, value: { id: insertedId.toHexString(), type: "activity.updated", tripId: trip.toHexString(), userId: user.toHexString(),
      createdAt: at(-10), attempts: 1, deliveredDeviceIds: [], payload: { activityId: activity.toHexString(), changedFields: ["scheduledAt"] } } });
    expect(await events().findOne({ _id: insertedId })).toMatchObject({ leaseOwner: "w1", leaseUntil: at(120), lastAttemptAt: NOW, status: "pending", attempts: 1 });
  });

  it("returns dates of the payload as Date, so the message can be built", async () => {
    await insert({ type: "activity.created", payload: { activityId: activity, actorId: new ObjectId(), scheduledAt: at(3600), durationMinutes: 60 } });
    const claimed = await claim("w1");
    if (!claimed.ok || claimed.value === undefined || claimed.value.type !== "activity.created") throw new Error("expected activity.created");
    expect(claimed.value.payload.scheduledAt).toEqual(at(3600));
  });

  it("gives an event to only one of two concurrent workers", async () => {
    await insert();
    const results = await Promise.all([claim("w1"), claim("w2")]);
    expect(results.filter((result) => result.ok && result.value !== undefined)).toHaveLength(1);
  });

  it("does not claim sent, skipped, failed, future or live-leased events, and reclaims an expired lease", async () => {
    await insert({ status: "sent" });
    await insert({ status: "skipped" });
    await insert({ status: "failed" });
    await insert({ availableAt: at(1) });
    const leased = await insert({ leaseOwner: "w0", leaseUntil: at(10) });
    expect(await claim("w1")).toEqual({ ok: true, value: undefined });
    expect(await claim("w1", at(10))).toMatchObject({ ok: true, value: { id: leased.insertedId.toHexString(), attempts: 1 } });
    expect(await events().findOne({ _id: leased.insertedId })).toMatchObject({ leaseOwner: "w1" });
  });

  it("claims the oldest available event first", async () => {
    await insert({ availableAt: at(-5) });
    const oldest = await insert({ availableAt: at(-50) });
    expect(await claim("w1")).toMatchObject({ ok: true, value: { id: oldest.insertedId.toHexString() } });
  });

  it("adds one attempt at every claim, atomically, and marks the claim time", async () => {
    const { insertedId } = await insert({ attempts: 2 });
    expect(await claim("w1")).toMatchObject({ ok: true, value: { attempts: 3 } });
    expect(await claim("w2", at(121))).toMatchObject({ ok: true, value: { attempts: 4 } });
    expect(await events().findOne({ _id: insertedId })).toMatchObject({ attempts: 4, leaseOwner: "w2", lastAttemptAt: at(121) });
    const second = await insert();
    await Promise.all([claim("w3", at(500)), claim("w4", at(500)), claim("w5", at(500))]);
    expect((await events().findOne({ _id: second.insertedId }))?.attempts).toBe(1);
  });

  it("reports the progress of a previous attempt", async () => {
    const device = new ObjectId();
    await insert({ attempts: 2, deliveredDeviceIds: [device] });
    expect(await claim("w1")).toMatchObject({ ok: true, value: { attempts: 3, deliveredDeviceIds: [device.toHexString()] } });
  });

  it("filters every write after the claim by the lease owner", async () => {
    const { insertedId } = await insert();
    await claim("w1");
    const eventId = domainId(insertedId), device = domainId(new ObjectId());
    expect(await dispatch().recordDelivered(eventId, "intruder", device)).toEqual({ ok: true, value: false });
    expect(await dispatch().complete(eventId, "intruder", { status: "sent", outcome: "delivered", now: NOW })).toEqual({ ok: true, value: false });
    expect(await dispatch().release(eventId, "intruder", { nextAttemptAt: at(60), status: "pending", lastErrorCode: "x" })).toEqual({ ok: true, value: false });
    expect(await events().findOne({ _id: insertedId })).toMatchObject({ status: "pending", leaseOwner: "w1" });
    expect((await events().findOne({ _id: insertedId }))?.deliveredDeviceIds).toBeUndefined();
  });

  it("records delivered devices idempotently", async () => {
    const { insertedId } = await insert();
    await claim("w1");
    const device = new ObjectId();
    expect(await dispatch().recordDelivered(domainId(insertedId), "w1", domainId(device))).toEqual({ ok: true, value: true });
    expect(await dispatch().recordDelivered(domainId(insertedId), "w1", domainId(device))).toEqual({ ok: true, value: true });
    expect((await events().findOne({ _id: insertedId }))?.deliveredDeviceIds).toEqual([device]);
  });

  it("completes an event with its status and outcome and frees the lease", async () => {
    const { insertedId } = await insert();
    await claim("w1");
    expect(await dispatch().complete(domainId(insertedId), "w1", { status: "sent", outcome: "no_devices", now: at(5) })).toEqual({ ok: true, value: true });
    const stored = await events().findOne({ _id: insertedId });
    expect(stored).toMatchObject({ status: "sent", outcome: "no_devices", completedAt: at(5) });
    expect(stored?.leaseOwner).toBeUndefined();
    expect(stored?.leaseUntil).toBeUndefined();
    expect(await claim("w2", at(1000))).toEqual({ ok: true, value: undefined });
  });

  it("releases an event for a later attempt, or leaves it failed, and keeps it claimable only when pending and due", async () => {
    const { insertedId } = await insert();
    await claim("w1");
    expect(await dispatch().release(domainId(insertedId), "w1", { nextAttemptAt: at(60), status: "pending", lastErrorCode: "throttled" })).toEqual({ ok: true, value: true });
    expect(await events().findOne({ _id: insertedId })).toMatchObject({ status: "pending", attempts: 1, availableAt: at(60), lastErrorCode: "throttled" });
    expect(await claim("w2", at(30))).toEqual({ ok: true, value: undefined });
    expect(await claim("w2", at(60))).toMatchObject({ ok: true, value: { attempts: 2 } });
    await dispatch().release(domainId(insertedId), "w2", { nextAttemptAt: at(600), status: "failed", lastErrorCode: "throttled" });
    expect(await events().findOne({ _id: insertedId })).toMatchObject({ status: "failed", attempts: 2 });
    expect(await claim("w3", at(100_000))).toEqual({ ok: true, value: undefined });
  });

  it("a release can give back the attempt counted at claim time", async () => {
    const { insertedId } = await insert();
    await claim("w1");
    await dispatch().release(domainId(insertedId), "w1", { nextAttemptAt: at(0), refundAttempt: true, status: "pending", lastErrorCode: "deadline" });
    expect(await events().findOne({ _id: insertedId })).toMatchObject({ status: "pending", attempts: 0 });
  });

  describe("dispatch with real claims", () => {
    const device = (id: ObjectId, token: string): PushDevice => ({ id: domainId(id), userId: domainId(user), provider: "fcm", platform: "android", token,
      createdAt: NOW, updatedAt: NOW, lastRegisteredAt: NOW });
    const devA = new ObjectId(), devB = new ObjectId();
    const run = (now: () => Date, send: (token: string) => Promise<PushSendResult>, owner: string) => dispatchPushNotifications({
      dispatch: dispatch(), audience: { isCurrentMember: async () => ok(true), tripExists: async () => ok(true) },
      devices: { listForUser: async () => ok([device(devA, "token-a"), device(devB, "token-b")]) },
      provider: { send: async ({ device: target }) => ok(await send(target.token)) }, removeInvalid: { removeInvalid: async (_p, tokens) => ok(tokens.length) },
      now, createOwner: () => owner, deadline: new Date(NOW.getTime() + 10 * 3600_000), maxEvents: 5 });

    it("a worker that dies on every claim converges to failed without sending, and never loops", async () => {
      const { insertedId } = await insert({ createdAt: at(-10) });
      for (let index = 1; index <= PUSH_DISPATCH_MAX_ATTEMPTS; index += 1) {
        expect(await claim(`dead-${index}`, at(index * 130))).toMatchObject({ ok: true, value: { attempts: index } });
      }
      const sent: string[] = [];
      const result = await run(() => at(10 * 130), async (token) => { sent.push(token); return { kind: "delivered" }; }, "live");
      expect(result).toMatchObject({ ok: true, value: { claimed: 1, exhausted: 1, delivered: 0 } });
      expect(sent).toEqual([]);
      expect(await events().findOne({ _id: insertedId })).toMatchObject({ status: "failed", lastErrorCode: "exhausted", attempts: PUSH_DISPATCH_MAX_ATTEMPTS + 1 });
      expect(await claim("later", at(100_000))).toEqual({ ok: true, value: undefined });
    });

    it("a worker with a send in flight loses the lease: the next worker sends the missing device and the first one cannot overwrite it", async () => {
      const { insertedId } = await insert({ createdAt: at(-10) });
      let clock = NOW;
      const sentByA: string[] = [], sentByB: string[] = [];
      let releaseA!: () => void;
      const blockedA = new Promise<void>((resolve) => { releaseA = resolve; });
      const workerA = run(() => clock, async (token) => {
        sentByA.push(token);
        if (token === "token-b") await blockedA;
        return { kind: "delivered" };
      }, "A");
      // A delivers token-a and stays pending on token-b.
      for (let spin = 0; spin < 200 && sentByA.length < 2; spin += 1) await new Promise((resolve) => setTimeout(resolve, 5));
      expect(sentByA).toEqual(["token-a", "token-b"]);
      expect(await events().findOne({ _id: insertedId })).toMatchObject({ leaseOwner: "A", attempts: 1 });
      clock = at(121);
      const workerB = await run(() => clock, async (token) => { sentByB.push(token); return { kind: "delivered" }; }, "B");
      expect(workerB).toMatchObject({ ok: true, value: { claimed: 1, delivered: 1 } });
      expect(sentByB).toEqual(["token-b"]);
      const afterB = await events().findOne({ _id: insertedId });
      expect(afterB).toMatchObject({ status: "sent", outcome: "delivered", attempts: 2 });
      releaseA();
      const resultA = await workerA;
      expect(resultA).toMatchObject({ ok: true, value: { leaseLost: 1, delivered: 0 } });
      expect(await events().findOne({ _id: insertedId })).toEqual(afterB);
      expect(await dispatch().recordDelivered(domainId(insertedId), "A", domainId(devB))).toEqual({ ok: true, value: false });
      expect(await dispatch().complete(domainId(insertedId), "A", { status: "sent", outcome: "delivered", now: clock })).toEqual({ ok: true, value: false });
    });
  });

  it("answers whether the user is a current member and whether the Trip exists", async () => {
    const audience = createMongoDispatchAudience(database);
    await database.collection("trips").insertOne({ _id: trip });
    await database.collection("tripMembers").insertOne({ tripId: trip, userId: user });
    expect(await audience.isCurrentMember(domainId(trip), domainId(user))).toEqual({ ok: true, value: true });
    expect(await audience.isCurrentMember(domainId(trip), domainId(new ObjectId()))).toEqual({ ok: true, value: false });
    expect(await audience.isCurrentMember(domainId(new ObjectId()), domainId(user))).toEqual({ ok: true, value: false });
    expect(await audience.tripExists(domainId(trip))).toEqual({ ok: true, value: true });
    expect(await audience.tripExists(domainId(new ObjectId()))).toEqual({ ok: true, value: false });
  });

  it("returns opaque errors on database failures", async () => {
    const broken = createMongoPushDispatchRepository({ collection: () => { throw new Error("mongodb://user:pass@host/db"); } } as unknown as Db);
    const brokenAudience = createMongoDispatchAudience({ collection: () => { throw new Error("mongodb://user:pass@host/db"); } } as unknown as Db);
    for (const result of [await broken.claimNext({ now: NOW, leaseUntil: at(1), owner: "w" }), await brokenAudience.tripExists(domainId(trip)),
      await brokenAudience.isCurrentMember(domainId(trip), domainId(user))]) {
      expect(result).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
      expect(JSON.stringify(result)).not.toContain("pass");
    }
  });

  it("regression: the inbox still lists sent, skipped and failed events and dispatching never changes the number of notices", async () => {
    await database.collection("tripMembers").insertOne({ tripId: trip, userId: user });
    for (const status of ["pending", "sent", "skipped", "failed"]) await insert({ status });
    const inbox = createMongoUserNotificationQueryRepository(database);
    const list = async () => {
      const result = await inbox.listForUser({ userId: domainId(user), limit: 50 });
      if (!result.ok) throw new Error("inbox failed");
      return result.value.map((notification) => ({ ...notification }));
    };
    const before = await list();
    expect(before).toHaveLength(4);
    const count = await events().countDocuments();
    let claimed = await claim("w1");
    while (claimed.ok && claimed.value !== undefined) {
      await dispatch().recordDelivered(claimed.value.id, "w1", domainId(new ObjectId()));
      await dispatch().complete(claimed.value.id, "w1", { status: "sent", outcome: "delivered", now: NOW });
      claimed = await claim("w1");
    }
    expect(await events().countDocuments()).toBe(count);
    expect(await list()).toEqual(before);
  });
});
