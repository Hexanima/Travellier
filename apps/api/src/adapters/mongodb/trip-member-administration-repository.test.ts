import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";

import { buildTripNotifications, err, ok, UnknownError, type ObjectId as DomainId, type TripNotificationDraft } from "app-domain";
import { createMongoTripMemberAdministrationRepository } from "./trip-member-administration-repository.js";

const hex = (id: ObjectId) => id.toHexString() as DomainId;
const at = new Date("2026-10-04T12:00:00.789Z");

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
    const first = await repository.withTransaction(hex(tripId), (scope) => scope.removeMember(hex(memberships.admin), hex(admin), notices, at));
    expect(first).toEqual(ok(true));
    expect(await database.collection("tripMembers").findOne({ _id: memberships.admin })).toBeNull();
    expect(await database.collection("outboxEvents").find({ tripId, type: "member.expelled", userId: admin }).toArray()).toHaveLength(1);
    const second = await repository.withTransaction(hex(tripId), (scope) => scope.removeMember(hex(memberships.admin), hex(admin), notices, at));
    expect(second).toEqual(ok(false));
    expect(await database.collection("outboxEvents").find({ tripId, type: "member.expelled" }).toArray()).toHaveLength(1);
  });

  it("does not delete a membership of another Trip or of another user", async () => {
    const { tripId, participant, memberships, repository } = await seed();
    const other = await seed();
    expect(await repository.withTransaction(hex(tripId), (scope) => scope.removeMember(hex(other.memberships.participant), hex(participant), [], at))).toEqual(ok(false));
    expect(await repository.withTransaction(hex(tripId), (scope) => scope.removeMember(hex(memberships.participant), hex(new ObjectId()), [], at))).toEqual(ok(false));
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
      const result = await repository.withTransaction(hex(tripId), (scope) => scope.removeMember(hex(memberships.participant), hex(participant), notices, at));
      expect(result.ok).toBe(false);
      expect(await snapshot(tripId)).toEqual(before);
    } finally { vi.restoreAllMocks(); }
  });

  describe("cleanup of future participations", () => {
    const seedCleanup = async () => {
      const base = await seed();
      const other = await seed();
      const bystander = new ObjectId();
      const activityAt = async (tripId: ObjectId, scheduledAt: Date) => {
        const _id = new ObjectId();
        await database.collection("activities").insertOne({ _id, tripId, scheduledAt, title: "Plan", durationMinutes: null });
        return _id;
      };
      const participation = async (tripId: ObjectId, activityId: ObjectId, userId: ObjectId, status: string, decisionRequired?: object) => {
        const _id = new ObjectId();
        await database.collection("activityParticipations").insertOne({ _id, tripId, activityId, userId, status, ...decisionRequired === undefined ? {} : { decisionRequired } });
        return _id;
      };
      const remove = (userId = base.participant, memberships = base.memberships.participant, notices: readonly TripNotificationDraft[] = []) =>
        base.repository.withTransaction(hex(base.tripId), (scope) => scope.removeMember(hex(memberships), hex(userId), notices, at));
      return { ...base, other, bystander, activityAt, participation, remove };
    };

    it("compares only the start: before the instant and at the instant are kept, after it is deleted", async () => {
      const f = await seedCleanup();
      const before = await f.participation(f.tripId, await f.activityAt(f.tripId, new Date(at.getTime() - 1)), f.participant, "going");
      const equal = await f.participation(f.tripId, await f.activityAt(f.tripId, new Date(at.getTime())), f.participant, "going");
      const after = await f.participation(f.tripId, await f.activityAt(f.tripId, new Date(at.getTime() + 1)), f.participant, "going");
      expect(await f.remove()).toEqual(ok(true));
      expect(await database.collection("activityParticipations").find({ _id: { $in: [before, equal, after] } }).sort({ _id: 1 }).toArray())
        .toMatchObject([{ _id: before }, { _id: equal }]);
    });

    it("deletes going, not_going and pending futures with their decisionRequired and keeps the started ones as they are", async () => {
      const f = await seedCleanup();
      const marked = { reason: "schedule_conflict", at: new Date("2026-10-01T00:00:00.000Z") };
      const future = new Date(at.getTime() + 3_600_000), past = new Date(at.getTime() - 3_600_000);
      const futures = [
        await f.participation(f.tripId, await f.activityAt(f.tripId, future), f.participant, "going"),
        await f.participation(f.tripId, await f.activityAt(f.tripId, future), f.participant, "not_going"),
        await f.participation(f.tripId, await f.activityAt(f.tripId, future), f.participant, "pending", marked),
      ];
      const started = await f.participation(f.tripId, await f.activityAt(f.tripId, past), f.participant, "pending", marked);
      expect(await f.remove()).toEqual(ok(true));
      expect(await database.collection("activityParticipations").countDocuments({ _id: { $in: futures } })).toBe(0);
      expect(await database.collection("activityParticipations").findOne({ _id: started })).toMatchObject({ status: "pending", decisionRequired: marked });
    });

    it("does not touch other users, other Trips, activities, posts, photos, comments, likes or expenses", async () => {
      const f = await seedCleanup();
      const future = new Date(at.getTime() + 3_600_000);
      const activity = await f.activityAt(f.tripId, future);
      const otherActivity = await f.activityAt(f.other.tripId, future);
      await f.participation(f.tripId, activity, f.participant, "going");
      const ofAdmin = await f.participation(f.tripId, activity, f.admin, "going");
      const ofBystander = await f.participation(f.tripId, activity, f.bystander, "pending");
      const ofOtherTrip = await f.participation(f.other.tripId, otherActivity, f.participant, "going");
      const untouched: [string, object][] = [
        ["posts", { tripId: f.tripId, authorId: f.participant, activityId: activity }],
        ["postPhotos", { tripId: f.tripId, userId: f.participant }],
        ["comments", { tripId: f.tripId, authorId: f.participant }],
        ["postLikes", { tripId: f.tripId, userId: f.participant }],
        ["commentLikes", { tripId: f.tripId, userId: f.participant }],
        ["postExpenses", { tripId: f.tripId, payerId: f.participant }],
      ];
      for (const [name, doc] of untouched) await database.collection(name).insertOne({ ...doc });
      const activitiesBefore = await database.collection("activities").find({ tripId: { $in: [f.tripId, f.other.tripId] } }).sort({ _id: 1 }).toArray();
      expect(await f.remove()).toEqual(ok(true));
      expect(await database.collection("activityParticipations").countDocuments({ _id: { $in: [ofAdmin, ofBystander, ofOtherTrip] } })).toBe(3);
      expect(await database.collection("activityParticipations").countDocuments({ tripId: f.tripId, userId: f.participant })).toBe(0);
      expect(await database.collection("activities").find({ tripId: { $in: [f.tripId, f.other.tripId] } }).sort({ _id: 1 }).toArray()).toEqual(activitiesBefore);
      for (const [name, doc] of untouched) expect(await database.collection(name).countDocuments({ ...doc }), name).toBe(1);
    });

    it("does not delete participations when the membership was not deleted", async () => {
      const f = await seedCleanup();
      const kept = await f.participation(f.tripId, await f.activityAt(f.tripId, new Date(at.getTime() + 1_000)), f.participant, "going");
      expect(await f.remove(f.participant, f.other.memberships.participant)).toEqual(ok(false));
      expect(await f.remove(f.admin, f.memberships.participant)).toEqual(ok(false));
      expect(await database.collection("activityParticipations").countDocuments({ _id: kept })).toBe(1);
    });

    it("rolls back membership and participations when the outbox write fails", async () => {
      const f = await seedCleanup();
      const kept = await f.participation(f.tripId, await f.activityAt(f.tripId, new Date(at.getTime() + 1_000)), f.participant, "going");
      const before = await snapshot(f.tripId);
      const outbox = database.collection("outboxEvents"), original = database.collection.bind(database);
      vi.spyOn(database, "collection").mockImplementation((name, options) => name === "outboxEvents" ? outbox : original(name, options));
      vi.spyOn(outbox, "bulkWrite").mockRejectedValueOnce(new Error("outbox failure"));
      try {
        const notices = buildTripNotifications({ type: "member.expelled", tripId: hex(f.tripId), operationRef: hex(f.memberships.participant), actorId: null,
          recipients: [hex(f.participant)], payload: { tripId: hex(f.tripId) }, createdAt: at });
        expect((await f.remove(f.participant, f.memberships.participant, notices)).ok).toBe(false);
      } finally { vi.restoreAllMocks(); }
      expect(await snapshot(f.tripId)).toEqual(before);
      expect(await database.collection("activityParticipations").countDocuments({ _id: kept })).toBe(1);
    });

    it("rolls back the membership when deleting the participations fails", async () => {
      const f = await seedCleanup();
      const kept = await f.participation(f.tripId, await f.activityAt(f.tripId, new Date(at.getTime() + 1_000)), f.participant, "going");
      const before = await snapshot(f.tripId);
      const participations = database.collection("activityParticipations"), original = database.collection.bind(database);
      vi.spyOn(database, "collection").mockImplementation((name, options) => name === "activityParticipations" ? participations : original(name, options));
      vi.spyOn(participations, "deleteMany").mockRejectedValueOnce(new Error("participations failure"));
      try {
        expect((await f.remove()).ok).toBe(false);
      } finally { vi.restoreAllMocks(); }
      expect(await snapshot(f.tripId)).toEqual(before);
      expect(await participations.countDocuments({ _id: kept })).toBe(1);
    });
  });
});
