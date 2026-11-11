import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
});
