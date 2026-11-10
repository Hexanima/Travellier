import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MongoClient, ObjectId, type CommandStartedEvent, type Db } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";

import { memberJoinedNotifier, type TripNotificationDraft } from "app-domain";
import { createMongoTripInvitationRepositories } from "./trip-invitation-repositories.js";

/** Notifier of the calls that do not care about events. */
const silent = () => [] as TripNotificationDraft[];
const now = () => new Date("2026-10-04T12:00:00.789Z");

describe("Mongo trip invitation repositories", () => {
  let server: MongoMemoryReplSet;
  let client: MongoClient;
  let database: Db;

  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    client = new MongoClient(server.getUri(), { monitorCommands: true });
    await client.connect();
    database = client.db("travellier_trip_invitation_test");
    await database.collection("tripMembers").createIndex({ tripId: 1, userId: 1 }, { unique: true });
  }, 120_000);

  afterAll(async () => {
    await client?.close();
    await server?.stop();
  });

  it("does not recreate a membership when a group was deleted after invitation lookup", async () => {
    const tripId = new ObjectId();
    const userId = new ObjectId();
    const { members } = createMongoTripInvitationRepositories(database);
    expect(await members.addParticipant(tripId.toHexString() as never, userId.toHexString() as never, silent))
      .toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    expect(await database.collection("tripMembers").countDocuments({ tripId })).toBe(0);
  });

  it("finds an invitation and inserts a participant only once", async () => {
    const tripId = new ObjectId();
    const userId = new ObjectId();
    await database.collection("trips").insertOne({ _id: tripId, inviteCode: "VIAJE-X7K2" });
    const { trips, members } = createMongoTripInvitationRepositories(database);

    expect(await trips.findByInviteCode("VIAJE-X7K2")).toEqual({ ok: true, value: { id: tripId.toHexString() } });
    expect(await members.addParticipant(tripId.toHexString() as never, userId.toHexString() as never, silent)).toEqual({ ok: true, value: true });
    expect(await members.addParticipant(tripId.toHexString() as never, userId.toHexString() as never, silent)).toEqual({ ok: true, value: false });
    expect(await database.collection("tripMembers").find({ tripId, userId }).toArray()).toMatchObject([
      { role: "participant", joinedAt: expect.any(Date) },
    ]);
  });

  it("preserves an admin membership when the same user follows an invitation", async () => {
    const tripId = new ObjectId();
    const userId = new ObjectId();
    await database.collection("trips").insertOne({ _id: tripId, inviteCode: "ADMIN-TEST" });
    await database.collection("tripMembers").insertOne({ tripId, userId, role: "admin", joinedAt: new Date() });
    const { members } = createMongoTripInvitationRepositories(database);

    expect(await members.addParticipant(tripId.toHexString() as never, userId.toHexString() as never, silent)).toEqual({ ok: true, value: false });
    expect(await database.collection("tripMembers").findOne({ tripId, userId })).toMatchObject({ role: "admin" });
  });

  it("keeps one membership when two joins arrive at the same time", async () => {
    const tripId = new ObjectId();
    const userId = new ObjectId();
    await database.collection("trips").insertOne({ _id: tripId, inviteCode: "CONCURRENT-TEST" });
    const { members } = createMongoTripInvitationRepositories(database);

    const results = await Promise.all([
      members.addParticipant(tripId.toHexString() as never, userId.toHexString() as never, silent),
      members.addParticipant(tripId.toHexString() as never, userId.toHexString() as never, silent),
    ]);

    expect(results).toContainEqual({ ok: true, value: true });
    expect(results).toContainEqual({ ok: true, value: false });
    expect(await database.collection("tripMembers").countDocuments({ tripId, userId })).toBe(1);
  });

  it("adds a public participant once and preserves an existing admin role", async () => {
    const tripId = new ObjectId();
    const participantId = new ObjectId();
    const adminId = new ObjectId();
    await database.collection("trips").insertOne({ _id: tripId, visibility: "public" });
    await database.collection("tripMembers").insertOne({ tripId, userId: adminId, role: "admin", joinedAt: new Date() });
    const { members } = createMongoTripInvitationRepositories(database);
    expect(members.addPublicParticipant).toBeTypeOf("function");

    expect(await members.addPublicParticipant(tripId.toHexString() as never, participantId.toHexString() as never, silent))
      .toEqual({ ok: true, value: true });
    expect(await members.addPublicParticipant(tripId.toHexString() as never, participantId.toHexString() as never, silent))
      .toEqual({ ok: true, value: false });
    expect(await members.addPublicParticipant(tripId.toHexString() as never, adminId.toHexString() as never, silent))
      .toEqual({ ok: true, value: false });
    expect(await database.collection("tripMembers").findOne({ tripId, userId: adminId })).toMatchObject({ role: "admin" });
  });

  it("keeps one membership when two public joins arrive together", async () => {
    const tripId = new ObjectId();
    const userId = new ObjectId();
    await database.collection("trips").insertOne({ _id: tripId, visibility: "public" });
    const { members } = createMongoTripInvitationRepositories(database);
    const results = await Promise.all([
      members.addPublicParticipant(tripId.toHexString() as never, userId.toHexString() as never, silent),
      members.addPublicParticipant(tripId.toHexString() as never, userId.toHexString() as never, silent),
    ]);
    expect(results).toContainEqual({ ok: true, value: true });
    expect(results).toContainEqual({ ok: true, value: false });
    expect(await database.collection("tripMembers").countDocuments({ tripId, userId })).toBe(1);
  });

  it("rejects a private trip without inserting a membership", async () => {
    const tripId = new ObjectId();
    const userId = new ObjectId();
    await database.collection("trips").insertOne({ _id: tripId, visibility: "private" });
    const { members } = createMongoTripInvitationRepositories(database);
    expect(members.addPublicParticipant).toBeTypeOf("function");
    expect(await members.addPublicParticipant(tripId.toHexString() as never, userId.toHexString() as never, silent))
      .toEqual({ ok: true, value: undefined });
    expect(await database.collection("tripMembers").countDocuments({ tripId, userId })).toBe(0);
  });

  it("rejects a join when a concurrent visibility change commits first", async () => {
    const tripId = new ObjectId();
    const userId = new ObjectId();
    await database.collection("trips").insertOne({ _id: tripId, visibility: "public" });
    const { members } = createMongoTripInvitationRepositories(database);
    expect(members.addPublicParticipant).toBeTypeOf("function");

    const configurationSession = client.startSession();
    try {
      configurationSession.startTransaction();
      await database.collection("trips").updateOne(
        { _id: tripId }, { $set: { visibility: "private" } }, { session: configurationSession },
      );
      const lockAttempted = new Promise<void>((resolve) => {
        const observe = (event: CommandStartedEvent) => {
          if (event.commandName !== "findAndModify" || event.command.findAndModify !== "trips") return;
          client.off("commandStarted", observe);
          resolve();
        };
        client.on("commandStarted", observe);
      });
      const joining = members.addPublicParticipant(tripId.toHexString() as never, userId.toHexString() as never, silent);
      await lockAttempted;
      await configurationSession.commitTransaction();
      expect(await joining).toEqual({ ok: true, value: undefined });
      expect(await database.collection("tripMembers").countDocuments({ tripId, userId })).toBe(0);
    } finally {
      if (configurationSession.inTransaction()) await configurationSession.abortTransaction();
      await configurationSession.endSession();
    }
  }, 15_000);

  describe("member.joined events (T91)", () => {
    const hex = (id: ObjectId) => id.toHexString() as never;
    const events = (tripId: ObjectId) => database.collection("outboxEvents").find({ tripId }).sort({ userId: 1 }).toArray();
    const seedMembers = async (tripId: ObjectId, ...users: ObjectId[]) => {
      await database.collection("tripMembers").insertMany(users.map((userId, index) => ({ tripId, userId, role: index === 0 ? "admin" : "participant", joinedAt: new Date() })));
    };

    it("a new membership stores one member.joined per other current member, with the membership id, and none for who joined", async () => {
      const tripId = new ObjectId(), userId = new ObjectId(), admin = new ObjectId(), other = new ObjectId();
      await database.collection("trips").insertOne({ _id: tripId, inviteCode: "EVENTS-1" });
      await seedMembers(tripId, admin, other);
      const { members } = createMongoTripInvitationRepositories(database);
      expect(await members.addParticipant(hex(tripId), hex(userId), memberJoinedNotifier({ tripId: hex(tripId), userId: hex(userId), now }))).toEqual({ ok: true, value: true });
      const membership = await database.collection("tripMembers").findOne({ tripId, userId });
      const stored = await events(tripId);
      expect(stored.map((event) => event.userId.toHexString()).sort()).toEqual([admin, other].map((id) => id.toHexString()).sort());
      for (const event of stored) {
        expect(event).toMatchObject({ type: "member.joined", status: "pending", actorId: userId, createdAt: now(), eventKey: `member.joined:${membership!._id}:${event.userId}`,
          payload: { memberId: membership!._id, userId } });
      }
    });

    it("a repeated join, an existing admin or a private Trip create no event nor call the notifier", async () => {
      const tripId = new ObjectId(), userId = new ObjectId(), admin = new ObjectId();
      await database.collection("trips").insertOne({ _id: tripId, inviteCode: "EVENTS-2", visibility: "public" });
      await seedMembers(tripId, admin);
      const { members } = createMongoTripInvitationRepositories(database);
      const notifier = (id: ObjectId) => vi.fn(memberJoinedNotifier({ tripId: hex(tripId), userId: hex(id), now }));
      const first = notifier(userId);
      expect(await members.addParticipant(hex(tripId), hex(userId), first)).toEqual({ ok: true, value: true });
      const saved = await events(tripId);
      const again = notifier(userId), existingAdmin = notifier(admin);
      expect(await members.addParticipant(hex(tripId), hex(userId), again)).toEqual({ ok: true, value: false });
      expect(await members.addPublicParticipant(hex(tripId), hex(admin), existingAdmin)).toEqual({ ok: true, value: false });
      expect(again).not.toHaveBeenCalled(); expect(existingAdmin).not.toHaveBeenCalled();
      expect(await events(tripId)).toEqual(saved);
      const privateTrip = new ObjectId(), privateNotifier = notifier(userId);
      await database.collection("trips").insertOne({ _id: privateTrip, visibility: "private" });
      expect(await members.addPublicParticipant(hex(privateTrip), hex(userId), privateNotifier)).toEqual({ ok: true, value: undefined });
      expect(privateNotifier).not.toHaveBeenCalled();
      expect(await events(privateTrip)).toEqual([]);
    });

    it("a public join stores the same events and a missing Trip stores none", async () => {
      const tripId = new ObjectId(), userId = new ObjectId(), admin = new ObjectId();
      await database.collection("trips").insertOne({ _id: tripId, visibility: "public" });
      await seedMembers(tripId, admin);
      const { members } = createMongoTripInvitationRepositories(database);
      expect(await members.addPublicParticipant(hex(tripId), hex(userId), memberJoinedNotifier({ tripId: hex(tripId), userId: hex(userId), now }))).toEqual({ ok: true, value: true });
      expect((await events(tripId)).map((event) => event.userId)).toEqual([admin]);
      const missing = new ObjectId();
      expect(await members.addParticipant(hex(missing), hex(userId), memberJoinedNotifier({ tripId: hex(missing), userId: hex(userId), now }))).toMatchObject({ ok: false });
      expect(await events(missing)).toEqual([]);
    });

    it("two simultaneous joins of the same user leave one membership and one set of events", async () => {
      const tripId = new ObjectId(), userId = new ObjectId(), admin = new ObjectId();
      await database.collection("trips").insertOne({ _id: tripId, inviteCode: "EVENTS-3" });
      await seedMembers(tripId, admin);
      const { members } = createMongoTripInvitationRepositories(database);
      const notify = memberJoinedNotifier({ tripId: hex(tripId), userId: hex(userId), now });
      const results = await Promise.all([members.addParticipant(hex(tripId), hex(userId), notify), members.addParticipant(hex(tripId), hex(userId), notify)]);
      expect(results).toContainEqual({ ok: true, value: true });
      expect(await events(tripId)).toHaveLength(1);
    });

    it("a join whose events cannot be written leaves no membership", async () => {
      const tripId = new ObjectId(), userId = new ObjectId(), admin = new ObjectId();
      await database.collection("trips").insertOne({ _id: tripId, inviteCode: "EVENTS-4" });
      await seedMembers(tripId, admin);
      const outbox = database.collection("outboxEvents"), original = database.collection.bind(database);
      vi.spyOn(outbox, "bulkWrite").mockRejectedValueOnce(new Error("forced failure"));
      vi.spyOn(database, "collection").mockImplementation((name, options) => name === "outboxEvents" ? outbox : original(name, options));
      try {
        const { members } = createMongoTripInvitationRepositories(database);
        expect(await members.addParticipant(hex(tripId), hex(userId), memberJoinedNotifier({ tripId: hex(tripId), userId: hex(userId), now }))).toMatchObject({ ok: false });
        expect(await database.collection("tripMembers").countDocuments({ tripId, userId })).toBe(0);
        expect(await events(tripId)).toEqual([]);
      } finally { vi.restoreAllMocks(); }
    });
  });
});
