import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";

import { buildTripNotifications, type ObjectId as DomainId } from "app-domain";
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
    await database.collection("trips").insertOne({ _id: tripId, ownerId: userId, createdBy: userId });
    const repository = createMongoTripMemberRepository(database);

    expect(await repository.findByTripAndUser(tripId.toHexString() as never, userId.toHexString() as never)).toEqual({
      ok: true,
      value: { id: membershipId.toHexString(), tripId: tripId.toHexString(), userId: userId.toHexString(), role: "admin", joinedAt },
    });
    expect(await repository.findByTripAndUser(otherTripId.toHexString() as never, userId.toHexString() as never)).toEqual({ ok: true, value: undefined });
    expect(await repository.listByTrip(tripId.toHexString() as never)).toEqual({
      ok: true,
      value: [{ id: membershipId.toHexString(), userId: userId.toHexString(), name: "Nico", role: "admin", isOwner: true, joinedAt }],
    });
  });

  it("marks only the current owner and never the creator once the ownerId differs", async () => {
    const tripId = new ObjectId(), creator = new ObjectId(), owner = new ObjectId(), participant = new ObjectId();
    await database.collection("users").insertMany([
      { _id: creator, name: "Creador" }, { _id: owner, name: "Titular" }, { _id: participant, name: "Persona" },
    ]);
    await database.collection("trips").insertOne({ _id: tripId, ownerId: owner, createdBy: creator });
    await database.collection("tripMembers").insertMany([
      { _id: new ObjectId(), tripId, userId: creator, role: "admin", joinedAt: new Date("2026-09-24T12:00:00.000Z") },
      { _id: new ObjectId(), tripId, userId: owner, role: "admin", joinedAt: new Date("2026-09-24T12:01:00.000Z") },
      { _id: new ObjectId(), tripId, userId: participant, role: "participant", joinedAt: new Date("2026-09-24T12:02:00.000Z") },
    ]);
    const listed = await createMongoTripMemberRepository(database).listByTrip(tripId.toHexString() as never);
    expect(listed).toMatchObject({ ok: true, value: [
      { userId: creator.toHexString(), isOwner: false },
      { userId: owner.toHexString(), role: "admin", isOwner: true },
      { userId: participant.toHexString(), isOwner: false },
    ] });
  });

  it("marks nobody as owner while the trip has no ownerId and does not write", async () => {
    const tripId = new ObjectId(), user = new ObjectId();
    await database.collection("users").insertOne({ _id: user, name: "Nico" });
    await database.collection("trips").insertOne({ _id: tripId, createdBy: user });
    await database.collection("tripMembers").insertOne({ _id: new ObjectId(), tripId, userId: user, role: "admin", joinedAt: new Date() });
    expect(await createMongoTripMemberRepository(database).listByTrip(tripId.toHexString() as never))
      .toMatchObject({ ok: true, value: [{ isOwner: false }] });
    expect(await database.collection("trips").findOne({ _id: tripId })).not.toHaveProperty("ownerId");
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

    expect(await repository.removeParticipant(participantId.toHexString() as never, otherTripId.toHexString() as never, userId.toHexString() as never, [])).toEqual({ ok: true, value: false });
    expect(await repository.removeParticipant(participantId.toHexString() as never, tripId.toHexString() as never, adminId.toHexString() as never, [])).toEqual({ ok: true, value: false });
    expect(await repository.removeParticipant(adminId.toHexString() as never, tripId.toHexString() as never, adminUserId.toHexString() as never, [])).toEqual({ ok: true, value: false });
    expect(await repository.removeParticipant(participantId.toHexString() as never, tripId.toHexString() as never, userId.toHexString() as never, [])).toEqual({ ok: true, value: true });
    expect(await members.findOne({ _id: participantId })).toBeNull();
    expect(await members.findOne({ _id: adminId })).not.toBeNull();
  });

  it("keeps the owner as an admin member: the current expulsion never removes it", async () => {
    const tripId = new ObjectId(), owner = new ObjectId(), membershipId = new ObjectId();
    await database.collection("trips").insertOne({ _id: tripId, ownerId: owner, destinationOrderRevision: 0 });
    await database.collection("tripMembers").insertOne({ _id: membershipId, tripId, userId: owner, role: "admin", joinedAt: new Date() });
    const repository = createMongoTripMemberRepository(database);
    expect(await repository.removeParticipant(membershipId.toHexString() as never, tripId.toHexString() as never, owner.toHexString() as never, []))
      .toEqual({ ok: true, value: false });
    expect(await database.collection("tripMembers").findOne({ _id: membershipId })).toMatchObject({ role: "admin" });
    expect(await database.collection("trips").findOne({ _id: tripId })).toMatchObject({ ownerId: owner });
  });

  it("increments Trip coordination atomically with participant removal", async () => {
    const tripId = new ObjectId(), userId = new ObjectId(), membershipId = new ObjectId();
    await database.collection("trips").insertOne({ _id: tripId, destinationOrderRevision: 0 });
    await database.collection("tripMembers").insertOne({ _id: membershipId, tripId, userId, role: "participant" });
    const repository = createMongoTripMemberRepository(database);
    expect(await repository.removeParticipant(membershipId.toHexString() as never, tripId.toHexString() as never, userId.toHexString() as never, []))
      .toEqual({ ok: true, value: true });
    expect(await database.collection("trips").findOne({ _id: tripId })).toMatchObject({ destinationOrderRevision: 1 });
    expect(await database.collection("tripMembers").findOne({ _id: membershipId })).toBeNull();
  });

  it("does not remove membership when the Trip no longer exists", async () => {
    const tripId = new ObjectId(), userId = new ObjectId(), membershipId = new ObjectId();
    await database.collection("tripMembers").insertOne({ _id: membershipId, tripId, userId, role: "participant" });
    expect(await createMongoTripMemberRepository(database).removeParticipant(membershipId.toHexString() as never,
      tripId.toHexString() as never, userId.toHexString() as never, [])).toEqual({ ok: true, value: false });
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
        tripId.toHexString() as never, userId.toHexString() as never, [])).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
      expect(await database.collection("trips").findOne({ _id: tripId })).toMatchObject({ destinationOrderRevision: 0 });
      expect(await members.findOne({ _id: membershipId })).not.toBeNull();
    } finally { vi.restoreAllMocks(); }
  });

  describe("member.expelled event (T91)", () => {
    const hex = (id: ObjectId) => id.toHexString() as DomainId;
    const notice = (tripId: ObjectId, membershipId: ObjectId, userId: ObjectId) => buildTripNotifications({ type: "member.expelled", tripId: hex(tripId),
      operationRef: hex(membershipId), actorId: null, recipients: [hex(userId)], payload: { tripId: hex(tripId) }, createdAt: new Date("2026-10-04T12:00:00.789Z") });
    const setup = async () => {
      const tripId = new ObjectId(), userId = new ObjectId(), membershipId = new ObjectId(), admin = new ObjectId();
      await database.collection("trips").insertOne({ _id: tripId, destinationOrderRevision: 0 });
      await database.collection("tripMembers").insertMany([{ _id: membershipId, tripId, userId, role: "participant", joinedAt: new Date() },
        { _id: new ObjectId(), tripId, userId: admin, role: "admin", joinedAt: new Date() }]);
      return { tripId, userId, membershipId, admin };
    };
    const events = (tripId: ObjectId) => database.collection("outboxEvents").find({ tripId }).toArray();

    it("stores the notice of the expelled user alone in the transaction that deletes the membership", async () => {
      const { tripId, userId, membershipId } = await setup();
      expect(await createMongoTripMemberRepository(database).removeParticipant(hex(membershipId), hex(tripId), hex(userId), notice(tripId, membershipId, userId)))
        .toEqual({ ok: true, value: true });
      expect(await events(tripId)).toMatchObject([{ type: "member.expelled", userId, actorId: null, status: "pending", payload: { tripId }, tripId,
        eventKey: `member.expelled:${membershipId}:${userId}`, operationKey: `member.expelled:${membershipId}` }]);
    });

    it("stores nothing when nothing was deleted (wrong role or user, missing Trip)", async () => {
      const { tripId, userId, membershipId, admin } = await setup();
      const repository = createMongoTripMemberRepository(database);
      expect(await repository.removeParticipant(hex(membershipId), hex(tripId), hex(admin), notice(tripId, membershipId, admin))).toEqual({ ok: true, value: false });
      const missing = new ObjectId(), orphan = new ObjectId();
      await database.collection("tripMembers").insertOne({ _id: orphan, tripId: missing, userId, role: "participant", joinedAt: new Date() });
      expect(await repository.removeParticipant(hex(orphan), hex(missing), hex(userId), notice(missing, orphan, userId))).toEqual({ ok: true, value: false });
      expect(await events(tripId)).toEqual([]);
      expect(await events(missing)).toEqual([]);
    });

    it("does not delete the membership when the notice cannot be written", async () => {
      const { tripId, userId, membershipId } = await setup();
      const outbox = database.collection("outboxEvents"), original = database.collection.bind(database);
      vi.spyOn(outbox, "bulkWrite").mockRejectedValueOnce(new Error("forced failure"));
      vi.spyOn(database, "collection").mockImplementation((name, options) => name === "outboxEvents" ? outbox : original(name, options));
      try {
        expect(await createMongoTripMemberRepository(database).removeParticipant(hex(membershipId), hex(tripId), hex(userId), notice(tripId, membershipId, userId)))
          .toMatchObject({ ok: false, error: { tag: "UnknownError" } });
        expect(await database.collection("tripMembers").findOne({ _id: membershipId })).not.toBeNull();
        expect(await events(tripId)).toEqual([]);
        expect(await database.collection("trips").findOne({ _id: tripId })).toMatchObject({ destinationOrderRevision: 0 });
      } finally { vi.restoreAllMocks(); }
    });
  });
});
