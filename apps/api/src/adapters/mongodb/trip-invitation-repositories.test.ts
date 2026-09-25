import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";

import { createMongoTripInvitationRepositories } from "./trip-invitation-repositories.js";

describe("Mongo trip invitation repositories", () => {
  let server: MongoMemoryServer;
  let client: MongoClient;
  let database: Db;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    client = new MongoClient(server.getUri());
    await client.connect();
    database = client.db("travellier_trip_invitation_test");
    await database.collection("tripMembers").createIndex({ tripId: 1, userId: 1 }, { unique: true });
  });

  afterAll(async () => {
    await client?.close();
    await server?.stop();
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
    await database.collection("tripMembers").insertOne({ tripId, userId, role: "admin", joinedAt: new Date() });
    const { members } = createMongoTripInvitationRepositories(database);

    expect(await members.addParticipant(tripId.toHexString() as never, userId.toHexString() as never)).toEqual({ ok: true, value: false });
    expect(await database.collection("tripMembers").findOne({ tripId, userId })).toMatchObject({ role: "admin" });
  });
});
