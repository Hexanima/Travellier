import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoClient, ObjectId, type CommandStartedEvent, type Db } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";

import { createMongoTripInvitationRepositories } from "./trip-invitation-repositories.js";

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
    expect(await members.addParticipant(tripId.toHexString() as never, userId.toHexString() as never))
      .toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    expect(await database.collection("tripMembers").countDocuments({ tripId })).toBe(0);
  });

  it("finds an invitation and inserts a participant only once", async () => {
    const tripId = new ObjectId();
    const userId = new ObjectId();
    await database.collection("trips").insertOne({ _id: tripId, inviteCode: "VIAJE-X7K2" });
    const { trips, members } = createMongoTripInvitationRepositories(database);

    expect(await trips.findByInviteCode("VIAJE-X7K2")).toEqual({ ok: true, value: { id: tripId.toHexString() } });
    expect(await members.addParticipant(tripId.toHexString() as never, userId.toHexString() as never)).toEqual({ ok: true, value: true });
    expect(await members.addParticipant(tripId.toHexString() as never, userId.toHexString() as never)).toEqual({ ok: true, value: false });
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

    expect(await members.addParticipant(tripId.toHexString() as never, userId.toHexString() as never)).toEqual({ ok: true, value: false });
    expect(await database.collection("tripMembers").findOne({ tripId, userId })).toMatchObject({ role: "admin" });
  });

  it("keeps one membership when two joins arrive at the same time", async () => {
    const tripId = new ObjectId();
    const userId = new ObjectId();
    await database.collection("trips").insertOne({ _id: tripId, inviteCode: "CONCURRENT-TEST" });
    const { members } = createMongoTripInvitationRepositories(database);

    const results = await Promise.all([
      members.addParticipant(tripId.toHexString() as never, userId.toHexString() as never),
      members.addParticipant(tripId.toHexString() as never, userId.toHexString() as never),
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

    expect(await members.addPublicParticipant(tripId.toHexString() as never, participantId.toHexString() as never))
      .toEqual({ ok: true, value: true });
    expect(await members.addPublicParticipant(tripId.toHexString() as never, participantId.toHexString() as never))
      .toEqual({ ok: true, value: false });
    expect(await members.addPublicParticipant(tripId.toHexString() as never, adminId.toHexString() as never))
      .toEqual({ ok: true, value: false });
    expect(await database.collection("tripMembers").findOne({ tripId, userId: adminId })).toMatchObject({ role: "admin" });
  });

  it("keeps one membership when two public joins arrive together", async () => {
    const tripId = new ObjectId();
    const userId = new ObjectId();
    await database.collection("trips").insertOne({ _id: tripId, visibility: "public" });
    const { members } = createMongoTripInvitationRepositories(database);
    const results = await Promise.all([
      members.addPublicParticipant(tripId.toHexString() as never, userId.toHexString() as never),
      members.addPublicParticipant(tripId.toHexString() as never, userId.toHexString() as never),
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
    expect(await members.addPublicParticipant(tripId.toHexString() as never, userId.toHexString() as never))
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
      const joining = members.addPublicParticipant(tripId.toHexString() as never, userId.toHexString() as never);
      await lockAttempted;
      await configurationSession.commitTransaction();
      expect(await joining).toEqual({ ok: true, value: undefined });
      expect(await database.collection("tripMembers").countDocuments({ tripId, userId })).toBe(0);
    } finally {
      if (configurationSession.inTransaction()) await configurationSession.abortTransaction();
      await configurationSession.endSession();
    }
  }, 15_000);
});
