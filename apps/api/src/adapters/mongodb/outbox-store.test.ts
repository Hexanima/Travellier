import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { buildTripNotifications, createObjectId, type ObjectId as DomainId, type TripNotificationDraft } from "app-domain";
import { migrateMongoSchema } from "./migrations.js";
import { createOutboxStore } from "./outbox-store.js";

const domainId = (value: ObjectId): DomainId => {
  const parsed = createObjectId(value.toHexString());
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};

describe("outbox store (T91)", () => {
  let server: MongoMemoryReplSet, client: MongoClient, db: Db, counter = 0;
  const trip = new ObjectId(), member = new ObjectId(), other = new ObjectId();
  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    client = await new MongoClient(server.getUri()).connect();
  }, 120_000);
  afterAll(async () => { await client?.close(); await server?.stop(); });
  beforeEach(async () => {
    db = client.db(`outbox_store_${++counter}`);
    await migrateMongoSchema(db);
    await db.collection("tripMembers").insertMany([{ tripId: trip, userId: member, role: "admin", joinedAt: new Date() },
      { tripId: trip, userId: other, role: "participant", joinedAt: new Date() }, { tripId: new ObjectId(), userId: new ObjectId(), role: "admin", joinedAt: new Date() }]);
  });

  const inTransaction = async <T>(work: (store: ReturnType<typeof createOutboxStore>) => Promise<T>): Promise<T> => {
    const session = client.startSession();
    try { return await session.withTransaction(() => work(createOutboxStore(db, domainId(trip), session))) as T; } finally { await session.endSession(); }
  };
  const drafts = (activityId = new ObjectId(), recipients = [member, other]): TripNotificationDraft[] => buildTripNotifications({ type: "activity.created", tripId: domainId(trip),
    operationRef: domainId(activityId), actorId: domainId(new ObjectId()), recipients: recipients.map(domainId),
    payload: { activityId: domainId(activityId), actorId: domainId(member), scheduledAt: new Date("2026-09-25T12:00:00.456Z"), durationMinutes: 90 },
    createdAt: new Date("2026-10-04T12:00:00.789Z") });

  it("lists the user ids of the current members of the Trip only", async () => {
    const ids = await inTransaction(async (store) => store.listMemberIds());
    expect(ids.ok && ids.value.sort()).toEqual([domainId(member), domainId(other)].sort());
  });

  it("stores one pending document per recipient with ObjectIds and Dates, never texts", async () => {
    const activityId = new ObjectId();
    await inTransaction(async (store) => store.appendNotifications(drafts(activityId)));
    const stored = await db.collection("outboxEvents").find().sort({ userId: 1 }).toArray();
    expect(stored).toHaveLength(2);
    const first = stored.find((doc) => doc.userId.equals(member))!;
    expect(Object.keys(first).sort()).toEqual(["_id", "actorId", "availableAt", "createdAt", "eventKey", "operationKey", "payload", "status", "tripId", "type", "userId"]);
    expect(first).toMatchObject({ tripId: trip, type: "activity.created", status: "pending", eventKey: `activity.created:${activityId}:${member}`,
      operationKey: `activity.created:${activityId}`, createdAt: new Date("2026-10-04T12:00:00.789Z"), availableAt: new Date("2026-10-04T12:00:00.789Z") });
    expect(first.actorId).toBeInstanceOf(ObjectId);
    expect(first.payload.activityId).toEqual(activityId);
    expect(first.payload.actorId).toBeInstanceOf(ObjectId);
    expect(first.payload.scheduledAt).toEqual(new Date("2026-09-25T12:00:00.456Z"));
    expect(first.payload.durationMinutes).toBe(90);
  });

  it("is idempotent: the same event key twice leaves one document and never aborts the transaction", async () => {
    const same = drafts();
    await inTransaction(async (store) => store.appendNotifications(same));
    const written = await db.collection("outboxEvents").find().toArray();
    const again = await inTransaction(async (store) => { const first = await store.appendNotifications(same); const second = await store.appendNotifications(same); return [first, second]; });
    expect(again.every((result) => result.ok)).toBe(true);
    expect(await db.collection("outboxEvents").find().toArray()).toEqual(written);
    // A different recipient of the same operation is a different document.
    await inTransaction(async (store) => store.appendNotifications(drafts(new ObjectId(), [member])));
    expect(await db.collection("outboxEvents").countDocuments()).toBe(3);
  });

  it("writes nothing for an empty list and rolls back with the transaction", async () => {
    await inTransaction(async (store) => store.appendNotifications([]));
    expect(await db.collection("outboxEvents").countDocuments()).toBe(0);
    const session = client.startSession();
    await expect(session.withTransaction(async () => {
      await createOutboxStore(db, domainId(trip), session).appendNotifications(drafts());
      throw new Error("abort");
    })).rejects.toThrow("abort");
    await session.endSession();
    expect(await db.collection("outboxEvents").countDocuments()).toBe(0);
  });

  it("refuses a draft of another Trip", async () => {
    const foreign = buildTripNotifications({ type: "member.expelled", tripId: domainId(new ObjectId()), operationRef: domainId(new ObjectId()),
      actorId: null, recipients: [domainId(member)], payload: { tripId: domainId(trip) }, createdAt: new Date() });
    await expect(inTransaction(async (store) => store.appendNotifications(foreign))).rejects.toMatchObject({ tag: "TripNotFoundError" });
    expect(await db.collection("outboxEvents").countDocuments()).toBe(0);
  });
});
