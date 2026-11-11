import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";

import { buildTripNotifications, err, ok, UnknownError, type ObjectId as DomainId } from "app-domain";
import { createMongoTripMemberAdministrationRepository } from "./trip-member-administration-repository.js";

const hex = (id: ObjectId) => id.toHexString() as DomainId;

describe("Mongo trip member administration repository", () => {
  let server: MongoMemoryReplSet;
  let client: MongoClient;
  let database: Db;

  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    client = new MongoClient(server.getUri());
    await client.connect();
    database = client.db("travellier_trip_member_administration_test");
  }, 120_000);

  afterAll(async () => {
    await client?.close();
    await server?.stop();
  });

  const seed = async () => {
    const tripId = new ObjectId(), owner = new ObjectId(), admin = new ObjectId(), participant = new ObjectId();
    const memberships = { owner: new ObjectId(), admin: new ObjectId(), participant: new ObjectId() };
    await database.collection("trips").insertOne({ _id: tripId, ownerId: owner, destinationOrderRevision: 0 });
    await database.collection("tripMembers").insertMany([
      { _id: memberships.owner, tripId, userId: owner, role: "admin", joinedAt: new Date() },
      { _id: memberships.admin, tripId, userId: admin, role: "admin", joinedAt: new Date() },
      { _id: memberships.participant, tripId, userId: participant, role: "participant", joinedAt: new Date() },
    ]);
    return { tripId, owner, admin, participant, memberships, repository: createMongoTripMemberAdministrationRepository(database) };
  };
  const snapshot = async (tripId: ObjectId) => ({
    trip: await database.collection("trips").findOne({ _id: tripId }),
    members: await database.collection("tripMembers").find({ tripId }).sort({ _id: 1 }).toArray(),
    events: await database.collection("outboxEvents").find({ tripId }).toArray(),
  });

  it("reads members and the owner inside the transaction and sets roles", async () => {
    const { tripId, owner, admin, participant, memberships, repository } = await seed();
    const result = await repository.withTransaction(hex(tripId), async (scope) => {
      expect(await scope.findMember(hex(participant))).toEqual(ok({ id: memberships.participant.toHexString(), role: "participant" }));
      expect(await scope.findMember(hex(new ObjectId()))).toEqual(ok(undefined));
      expect(await scope.findOwnerId()).toEqual(ok(owner.toHexString()));
      expect(await scope.setRole(hex(participant), "admin")).toEqual(ok(undefined));
      return scope.setRole(hex(admin), "participant");
    });
    expect(result).toEqual(ok(undefined));
    expect(await database.collection("tripMembers").findOne({ userId: participant, tripId })).toMatchObject({ role: "admin" });
    expect(await database.collection("tripMembers").findOne({ userId: admin, tripId })).toMatchObject({ role: "participant" });
    expect(await database.collection("trips").findOne({ _id: tripId })).toMatchObject({ ownerId: owner, destinationOrderRevision: 1 });
  });

  it("reports a Trip without ownerId as undefined owner", async () => {
    const tripId = new ObjectId();
    await database.collection("trips").insertOne({ _id: tripId });
    const result = await createMongoTripMemberAdministrationRepository(database).withTransaction(hex(tripId), (scope) => scope.findOwnerId());
    expect(result).toEqual(ok(undefined));
  });

  it("transfers the ownership: new owner admin, previous owner stays admin", async () => {
    const { tripId, owner, participant, repository } = await seed();
    const result = await repository.withTransaction(hex(tripId), (scope) => scope.transferOwnership(hex(owner), hex(participant)));
    expect(result).toEqual(ok(undefined));
    expect(await database.collection("trips").findOne({ _id: tripId })).toMatchObject({ ownerId: participant, destinationOrderRevision: 1 });
    expect(await database.collection("tripMembers").findOne({ tripId, userId: participant })).toMatchObject({ role: "admin" });
    expect(await database.collection("tripMembers").findOne({ tripId, userId: owner })).toMatchObject({ role: "admin" });
  });

  it("aborts a transfer whose previous owner is stale, without writing anything", async () => {
    const { tripId, admin, participant, repository } = await seed();
    const before = await snapshot(tripId);
    const result = await repository.withTransaction(hex(tripId), (scope) => scope.transferOwnership(hex(admin), hex(participant)));
    expect(result.ok).toBe(false);
    expect(await snapshot(tripId)).toEqual(before);
  });

  it("aborts a transfer to a non-member without writing anything", async () => {
    const { tripId, owner, repository } = await seed();
    const before = await snapshot(tripId);
    const result = await repository.withTransaction(hex(tripId), (scope) => scope.transferOwnership(hex(owner), hex(new ObjectId())));
    expect(result.ok).toBe(false);
    expect(await snapshot(tripId)).toEqual(before);
  });

  it("rolls back every write, including the Trip lock, when the work returns an error", async () => {
    const { tripId, participant, repository } = await seed();
    const before = await snapshot(tripId);
    const failure = new UnknownError("business rejection");
    const result = await repository.withTransaction(hex(tripId), async (scope) => {
      await scope.setRole(hex(participant), "admin");
      return err(failure);
    });
    expect(result).toEqual(err(failure));
    expect(await snapshot(tripId)).toEqual(before);
  });

  it("returns TripNotFoundError for a missing Trip", async () => {
    const { repository } = await seed();
    const work = vi.fn();
    expect(await repository.withTransaction(hex(new ObjectId()), work)).toMatchObject({ ok: false, error: { tag: "TripNotFoundError" } });
    expect(work).not.toHaveBeenCalled();
  });

  it("removes the membership of an admin and writes the notice only when it deleted", async () => {
    const { tripId, admin, memberships, repository } = await seed();
    const notices = buildTripNotifications({ type: "member.expelled", tripId: hex(tripId), operationRef: hex(memberships.admin), actorId: null,
      recipients: [hex(admin)], payload: { tripId: hex(tripId) }, createdAt: new Date("2026-10-04T12:00:00.000Z") });
    const first = await repository.withTransaction(hex(tripId), (scope) => scope.removeMember(hex(memberships.admin), hex(admin), notices));
    expect(first).toEqual(ok(true));
    expect(await database.collection("tripMembers").findOne({ _id: memberships.admin })).toBeNull();
    expect(await database.collection("outboxEvents").find({ tripId, type: "member.expelled", userId: admin }).toArray()).toHaveLength(1);
    const second = await repository.withTransaction(hex(tripId), (scope) => scope.removeMember(hex(memberships.admin), hex(admin), notices));
    expect(second).toEqual(ok(false));
    expect(await database.collection("outboxEvents").find({ tripId, type: "member.expelled" }).toArray()).toHaveLength(1);
  });

  it("does not delete a membership of another Trip or of another user", async () => {
    const { tripId, participant, memberships, repository } = await seed();
    const other = await seed();
    expect(await repository.withTransaction(hex(tripId), (scope) => scope.removeMember(hex(other.memberships.participant), hex(participant), []))).toEqual(ok(false));
    expect(await repository.withTransaction(hex(tripId), (scope) => scope.removeMember(hex(memberships.participant), hex(new ObjectId()), []))).toEqual(ok(false));
    expect(await database.collection("tripMembers").countDocuments({ tripId })).toBe(3);
  });

  it("rolls back the deletion when the outbox write fails", async () => {
    const { tripId, participant, memberships, repository } = await seed();
    const before = await snapshot(tripId);
    const outbox = database.collection("outboxEvents"), original = database.collection.bind(database);
    vi.spyOn(database, "collection").mockImplementation((name, options) => name === "outboxEvents" ? outbox : original(name, options));
    vi.spyOn(outbox, "bulkWrite").mockRejectedValueOnce(new Error("outbox failure"));
    try {
      const notices = buildTripNotifications({ type: "member.expelled", tripId: hex(tripId), operationRef: hex(memberships.participant), actorId: null,
        recipients: [hex(participant)], payload: { tripId: hex(tripId) }, createdAt: new Date() });
      const result = await repository.withTransaction(hex(tripId), (scope) => scope.removeMember(hex(memberships.participant), hex(participant), notices));
      expect(result.ok).toBe(false);
      expect(await snapshot(tripId)).toEqual(before);
    } finally { vi.restoreAllMocks(); }
  });
});
