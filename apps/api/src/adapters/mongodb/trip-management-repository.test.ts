import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";

import { createObjectId, type TripCreationRecord } from "app-domain";
import { migrateMongoSchema } from "./migrations.js";
import { createMongoTripManagementRepository } from "./trip-management-repository.js";

const domainId = (id: ObjectId) => {
  const result = createObjectId(id.toHexString());
  if (!result.ok) throw result.error;
  return result.value;
};

describe("Mongo Trip management repository", () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  let database: Db;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    client = new MongoClient(replSet.getUri());
    await client.connect();
    database = client.db("travellier_trip_management_test");
    await migrateMongoSchema(database);
  });

  beforeEach(async () => {
    await Promise.all([
      database.collection("trips").deleteMany({}),
      database.collection("tripMembers").deleteMany({}),
      database.collection("destinations").deleteMany({}),
    ]);
  });

  afterAll(async () => {
    await client?.close();
    await replSet?.stop();
  });

  const record = (code = "VIAJE-X7K2", creator = new ObjectId()): TripCreationRecord => {
    const tripId = domainId(new ObjectId());
    const creatorId = domainId(creator);
    const createdAt = new Date("2026-09-24T12:00:00.000Z");
    return {
      trip: {
        id: tripId, name: "Patagonia", description: null, visibility: "private", inviteCode: code,
        votingEnabled: false, expenseMode: "register", createdBy: creatorId, createdAt,
      },
      creatorMembership: {
        id: domainId(new ObjectId()), tripId, userId: creatorId, role: "admin", joinedAt: createdAt,
      },
      primaryDestination: {
        id: domainId(new ObjectId()), tripId, name: "Bariloche", order: 1, createdAt,
      },
    };
  };

  it("persists a trip, its first destination and admin membership atomically", async () => {
    const repository = createMongoTripManagementRepository(database);
    const input = record();
    expect(await repository.createWithAdminAndDestination(input)).toMatchObject({ ok: true });
    expect(await database.collection("trips").findOne({ _id: new ObjectId(input.trip.id) })).toMatchObject({ inviteCode: input.trip.inviteCode });
    expect(await database.collection("tripMembers").findOne({ tripId: new ObjectId(input.trip.id) })).toMatchObject({ role: "admin", userId: new ObjectId(input.trip.createdBy) });
    expect(await database.collection("destinations").findOne({ tripId: new ObjectId(input.trip.id) })).toMatchObject({ name: "Bariloche", order: 1 });
  });

  it("rolls back the trip and destination if its membership cannot be inserted", async () => {
    const repository = createMongoTripManagementRepository(database);
    const input = record();
    await database.collection("tripMembers").insertOne({
      _id: new ObjectId(input.creatorMembership.id), tripId: new ObjectId(), userId: new ObjectId(), role: "participant", joinedAt: new Date(),
    });
    expect(await repository.createWithAdminAndDestination(input)).toMatchObject({ ok: false });
    expect(await database.collection("trips").countDocuments({ _id: new ObjectId(input.trip.id) })).toBe(0);
    expect(await database.collection("destinations").countDocuments({ tripId: new ObjectId(input.trip.id) })).toBe(0);
  });

  it("reports a collision only for the invitation index", async () => {
    const repository = createMongoTripManagementRepository(database);
    expect(await repository.createWithAdminAndDestination(record("VIAJE-X7K2"))).toMatchObject({ ok: true });
    expect(await repository.createWithAdminAndDestination(record("VIAJE-X7K2"))).toMatchObject({ ok: false, error: { tag: "InviteCodeConflictError" } });
    expect(await database.collection("trips").countDocuments({})).toBe(1);
  });

  it("only reads and lists trips for members, excluding a private stranger's trip", async () => {
    const repository = createMongoTripManagementRepository(database);
    const owner = new ObjectId();
    const outsider = new ObjectId();
    const ownTrip = record("VIAJE-X7K2", owner);
    const otherTrip = record("VIAJE-Y8L3", outsider);
    await repository.createWithAdminAndDestination(ownTrip);
    await repository.createWithAdminAndDestination(otherTrip);

    expect(await repository.findByIdForMember(ownTrip.trip.id, domainId(owner))).toMatchObject({ ok: true, value: { id: ownTrip.trip.id, primaryDestination: { name: "Bariloche" } } });
    expect(await repository.findByIdForMember(otherTrip.trip.id, domainId(owner))).toEqual({ ok: true, value: undefined });
    expect(await repository.listForMember(domainId(owner))).toMatchObject({ ok: true, value: [{ id: ownTrip.trip.id }] });
  });

  it("updates configuration only when the user is a member", async () => {
    const repository = createMongoTripManagementRepository(database);
    const input = record();
    await repository.createWithAdminAndDestination(input);
    const outsider = domainId(new ObjectId());
    expect(await repository.updateConfigurationForMember(input.trip.id, outsider, { visibility: "public" })).toEqual({ ok: true, value: undefined });
    expect(await repository.updateConfigurationForMember(input.trip.id, input.trip.createdBy, { visibility: "public", votingEnabled: true, expenseMode: "balance" })).toMatchObject({
      ok: true, value: { visibility: "public", votingEnabled: true, expenseMode: "balance" },
    });
  });
});
