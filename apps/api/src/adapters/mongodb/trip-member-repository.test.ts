import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";

import { createMongoTripMemberRepository } from "./trip-member-repository.js";

describe("Mongo trip member repository", () => {
  let server: MongoMemoryReplSet;
  let client: MongoClient;
  let database: Db;

  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    client = new MongoClient(server.getUri());
    await client.connect();
    database = client.db("travellier_trip_members_test");
  }, 120_000);

  afterAll(async () => {
    await client?.close();
    await server?.stop();
  });

  it("finds membership only for the specified trip and lists safe member fields", async () => {
    const tripId = new ObjectId();
    const otherTripId = new ObjectId();
    const userId = new ObjectId();
    const membershipId = new ObjectId();
    const joinedAt = new Date("2026-09-24T12:00:00.000Z");
    await database.collection("users").insertOne({ _id: userId, name: "Nico", email: "nico@example.com", passwordHash: "secret" });
    await database.collection("tripMembers").insertOne({ _id: membershipId, tripId, userId, role: "admin", joinedAt });
    const repository = createMongoTripMemberRepository(database);

    expect(await repository.findByTripAndUser(tripId.toHexString() as never, userId.toHexString() as never)).toEqual({
      ok: true,
      value: { id: membershipId.toHexString(), tripId: tripId.toHexString(), userId: userId.toHexString(), role: "admin", joinedAt },
    });
    expect(await repository.findByTripAndUser(otherTripId.toHexString() as never, userId.toHexString() as never)).toEqual({ ok: true, value: undefined });
    expect(await repository.listByTrip(tripId.toHexString() as never)).toEqual({
      ok: true,
      value: [{ id: membershipId.toHexString(), userId: userId.toHexString(), name: "Nico", role: "admin", joinedAt }],
    });
  });

  it("lists members without a name as null and keeps the other names", async () => {
    const tripId = new ObjectId();
    const namedUser = new ObjectId(), missingNameUser = new ObjectId(), nullNameUser = new ObjectId();
    const namedMember = new ObjectId(), missingNameMember = new ObjectId(), nullNameMember = new ObjectId();
    await database.collection("users").insertMany([
      { _id: namedUser, name: "Nico", email: "named@example.com", passwordHash: "secret" },
      { _id: missingNameUser, email: "missing@example.com", passwordHash: "secret" },
      { _id: nullNameUser, name: null, email: "null@example.com", passwordHash: "secret" },
    ]);
    await database.collection("tripMembers").insertMany([
      { _id: namedMember, tripId, userId: namedUser, role: "admin", joinedAt: new Date("2026-09-24T12:00:00.000Z") },
      { _id: missingNameMember, tripId, userId: missingNameUser, role: "participant", joinedAt: new Date("2026-09-24T12:01:00.000Z") },
      { _id: nullNameMember, tripId, userId: nullNameUser, role: "participant", joinedAt: new Date("2026-09-24T12:02:00.000Z") },
    ]);

    const listed = await createMongoTripMemberRepository(database).listByTrip(tripId.toHexString() as never);

    expect(listed).toMatchObject({
      ok: true,
      value: [
        { id: namedMember.toHexString(), name: "Nico" },
        { id: missingNameMember.toHexString(), name: null },
        { id: nullNameMember.toHexString(), name: null },
      ],
    });
    expect(JSON.stringify(listed)).not.toContain("@example.com");
  });

  it("still fails when a member's user no longer exists", async () => {
    const tripId = new ObjectId();
    await database.collection("tripMembers").insertOne({
      _id: new ObjectId(), tripId, userId: new ObjectId(), role: "participant", joinedAt: new Date(),
    });

    expect(await createMongoTripMemberRepository(database).listByTrip(tripId.toHexString() as never))
      .toMatchObject({ ok: false, error: { tag: "UnknownError" } });
  });

  it("removes only a participant matching membership, trip and user", async () => {
    const tripId = new ObjectId();
    const otherTripId = new ObjectId();
    const userId = new ObjectId();
    const adminUserId = new ObjectId();
    const adminId = new ObjectId();
    const participantId = new ObjectId();
    const members = database.collection("tripMembers");
    await database.collection("trips").insertOne({ _id: tripId, destinationOrderRevision: 0 });
    await members.insertMany([
      { _id: adminId, tripId, userId: adminUserId, role: "admin", joinedAt: new Date() },
      { _id: participantId, tripId, userId, role: "participant", joinedAt: new Date() },
    ]);
    const repository = createMongoTripMemberRepository(database);

    expect(await repository.removeParticipant(participantId.toHexString() as never, otherTripId.toHexString() as never, userId.toHexString() as never)).toEqual({ ok: true, value: false });
    expect(await repository.removeParticipant(participantId.toHexString() as never, tripId.toHexString() as never, adminId.toHexString() as never)).toEqual({ ok: true, value: false });
    expect(await repository.removeParticipant(adminId.toHexString() as never, tripId.toHexString() as never, adminUserId.toHexString() as never)).toEqual({ ok: true, value: false });
    expect(await repository.removeParticipant(participantId.toHexString() as never, tripId.toHexString() as never, userId.toHexString() as never)).toEqual({ ok: true, value: true });
    expect(await members.findOne({ _id: participantId })).toBeNull();
    expect(await members.findOne({ _id: adminId })).not.toBeNull();
  });

  it("increments Trip coordination atomically with participant removal", async () => {
    const tripId = new ObjectId(), userId = new ObjectId(), membershipId = new ObjectId();
    await database.collection("trips").insertOne({ _id: tripId, destinationOrderRevision: 0 });
    await database.collection("tripMembers").insertOne({ _id: membershipId, tripId, userId, role: "participant" });
    const repository = createMongoTripMemberRepository(database);
    expect(await repository.removeParticipant(membershipId.toHexString() as never, tripId.toHexString() as never, userId.toHexString() as never))
      .toEqual({ ok: true, value: true });
    expect(await database.collection("trips").findOne({ _id: tripId })).toMatchObject({ destinationOrderRevision: 1 });
    expect(await database.collection("tripMembers").findOne({ _id: membershipId })).toBeNull();
  });

  it("does not remove membership when the Trip no longer exists", async () => {
    const tripId = new ObjectId(), userId = new ObjectId(), membershipId = new ObjectId();
    await database.collection("tripMembers").insertOne({ _id: membershipId, tripId, userId, role: "participant" });
    expect(await createMongoTripMemberRepository(database).removeParticipant(membershipId.toHexString() as never,
      tripId.toHexString() as never, userId.toHexString() as never)).toEqual({ ok: true, value: false });
    expect(await database.collection("tripMembers").findOne({ _id: membershipId })).not.toBeNull();
  });

  it("rolls back membership deletion and Trip coordination if removal fails", async () => {
    const tripId = new ObjectId(), userId = new ObjectId(), membershipId = new ObjectId();
    await database.collection("trips").insertOne({ _id: tripId, destinationOrderRevision: 0 });
    const members = database.collection("tripMembers"), original = database.collection.bind(database), remove = members.deleteOne.bind(members);
    await members.insertOne({ _id: membershipId, tripId, userId, role: "participant" });
    vi.spyOn(database, "collection").mockImplementation((name, options) => name === "tripMembers" ? members : original(name, options));
    vi.spyOn(members, "deleteOne").mockImplementationOnce(async (filter, options) => {
      await remove(filter, options);
      throw new Error("failure after deletion");
    });
    try {
      expect(await createMongoTripMemberRepository(database).removeParticipant(membershipId.toHexString() as never,
        tripId.toHexString() as never, userId.toHexString() as never)).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
      expect(await database.collection("trips").findOne({ _id: tripId })).toMatchObject({ destinationOrderRevision: 0 });
      expect(await members.findOne({ _id: membershipId })).not.toBeNull();
    } finally { vi.restoreAllMocks(); }
  });
});
