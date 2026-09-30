import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";

import { createMongoTripMemberRepository } from "./trip-member-repository.js";

describe("Mongo trip member repository", () => {
  let server: MongoMemoryServer;
  let client: MongoClient;
  let database: Db;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    client = new MongoClient(server.getUri());
    await client.connect();
    database = client.db("travellier_trip_members_test");
  });

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

  it("removes only a participant matching membership, trip and user", async () => {
    const tripId = new ObjectId();
    const otherTripId = new ObjectId();
    const userId = new ObjectId();
    const adminUserId = new ObjectId();
    const adminId = new ObjectId();
    const participantId = new ObjectId();
    const members = database.collection("tripMembers");
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
});
