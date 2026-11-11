import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
  }, 120_000);

  beforeEach(async () => {
    await Promise.all([
      database.collection("trips").deleteMany({}),
      database.collection("tripMembers").deleteMany({}),
      database.collection("destinations").deleteMany({}),
      database.collection("transports").deleteMany({}),
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
        expenseMode: "register", ownerId: creatorId, createdBy: creatorId, createdAt,
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
    expect(await database.collection("trips").findOne({ _id: new ObjectId(input.trip.id) })).toMatchObject({
      inviteCode: input.trip.inviteCode,
      ownerId: new ObjectId(input.trip.ownerId),
      createdBy: new ObjectId(input.trip.createdBy),
    });
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

    expect(await repository.findByIdForViewer(ownTrip.trip.id, domainId(owner))).toMatchObject({ ok: true, value: { id: ownTrip.trip.id, primaryDestination: { name: "Bariloche" } } });
    expect(await repository.findByIdForViewer(otherTrip.trip.id, domainId(owner))).toEqual({ ok: true, value: undefined });
    expect(await repository.listForMember(domainId(owner))).toMatchObject({ ok: true, value: [{ id: ownTrip.trip.id }] });
  });

  it("returns a limited public preview to a non-member", async () => {
    const repository = createMongoTripManagementRepository(database);
    const input = record();
    input.trip.visibility = "public";
    expect(await repository.createWithAdminAndDestination(input)).toMatchObject({ ok: true });

    const outsider = domainId(new ObjectId());
    expect(await repository.findByIdForViewer(input.trip.id, outsider)).toEqual({
      ok: true,
      value: {
        id: input.trip.id,
        name: "Patagonia",
        description: null,
        visibility: "public",
        primaryDestination: { name: "Bariloche" },
      },
    });
    expect(await repository.listForMember(outsider)).toEqual({ ok: true, value: [] });
    expect(await repository.findByIdForViewer(input.trip.id, input.trip.createdBy)).toMatchObject({
      ok: true,
      value: { inviteCode: input.trip.inviteCode, ownerId: input.trip.ownerId, createdBy: input.trip.createdBy },
    });
  });

  it("exposes the owner to members in the detail and in the listing, but never in the public preview", async () => {
    const repository = createMongoTripManagementRepository(database);
    const creator = new ObjectId();
    const input = record("VIAJE-OWN1", creator);
    input.trip.visibility = "public";
    await repository.createWithAdminAndDestination(input);
    await database.collection("trips").updateOne({ _id: new ObjectId(input.trip.id) }, { $set: { ownerId: new ObjectId() } });
    const stored = await database.collection("trips").findOne({ _id: new ObjectId(input.trip.id) });
    const ownerHex = (stored!.ownerId as ObjectId).toHexString();

    expect(await repository.findByIdForViewer(input.trip.id, domainId(creator))).toMatchObject({ ok: true, value: { ownerId: ownerHex, createdBy: input.trip.createdBy } });
    expect(await repository.listForMember(domainId(creator))).toMatchObject({ ok: true, value: [{ ownerId: ownerHex }] });
    const preview = await repository.findByIdForViewer(input.trip.id, domainId(new ObjectId()));
    expect(preview).toMatchObject({ ok: true });
    expect(preview.ok && preview.value).not.toHaveProperty("ownerId");
    const publicList = await repository.listPublic();
    expect(publicList.ok && publicList.value[0]).not.toHaveProperty("ownerId");
  });

  it("reads a not yet migrated trip with createdBy as the displayed owner without writing", async () => {
    const repository = createMongoTripManagementRepository(database);
    const creator = new ObjectId();
    const input = record("VIAJE-OWN2", creator);
    await repository.createWithAdminAndDestination(input);
    await database.collection("trips").updateOne({ _id: new ObjectId(input.trip.id) }, { $unset: { ownerId: "" } });
    expect(await repository.findByIdForViewer(input.trip.id, domainId(creator))).toMatchObject({ ok: true, value: { ownerId: input.trip.createdBy } });
    expect(await database.collection("trips").findOne({ _id: new ObjectId(input.trip.id) })).not.toHaveProperty("ownerId");
  });

  it("lists only public trips with decision fields", async () => {
    const repository = createMongoTripManagementRepository(database);
    expect(repository.listPublic).toBeTypeOf("function");
    const first = record("VIAJE-PUBLIC1");
    first.trip.visibility = "public";
    const second = record("VIAJE-PRIVATE");
    const third = record("VIAJE-PUBLIC2");
    third.trip.visibility = "public";
    third.trip.createdAt = new Date("2026-09-25T12:00:00.000Z");
    await repository.createWithAdminAndDestination(first);
    await repository.createWithAdminAndDestination(second);
    await repository.createWithAdminAndDestination(third);

    expect(await repository.listPublic()).toEqual({ ok: true, value: [
      { id: third.trip.id, name: "Patagonia", description: null, visibility: "public", primaryDestination: { name: "Bariloche" } },
      { id: first.trip.id, name: "Patagonia", description: null, visibility: "public", primaryDestination: { name: "Bariloche" } },
    ] });
  });

  it("updates configuration only when the user is a member", async () => {
    const repository = createMongoTripManagementRepository(database);
    const input = record();
    await repository.createWithAdminAndDestination(input);
    const outsider = domainId(new ObjectId());
    expect(await repository.updateConfigurationForMember(input.trip.id, outsider, { visibility: "public" })).toEqual({ ok: true, value: undefined });
    expect(await repository.updateConfigurationForMember(input.trip.id, input.trip.createdBy, { visibility: "public", expenseMode: "balance" })).toMatchObject({
      ok: true, value: { visibility: "public", expenseMode: "balance" },
    });
  });

  describe("derived trip dates in the listing", () => {
    const at = (value: string) => new Date(value);
    const seedTransport = async (tripId: string, destinationId: string, departureAt: unknown, arrivalAt: unknown) => {
      const taken = await database.collection("transports").countDocuments({ destinationId: new ObjectId(destinationId) });
      await database.collection("transports").insertOne({
        _id: new ObjectId(), tripId: new ObjectId(tripId), destinationId: new ObjectId(destinationId),
        direction: taken === 0 ? "outbound" : "return", type: "plane", departureAt, arrivalAt, createdAt: new Date(),
      });
    };
    const seedTrip = async (code: string, creator = new ObjectId(), createdAt?: Date) => {
      const repository = createMongoTripManagementRepository(database);
      const input = record(code, creator);
      if (createdAt !== undefined) input.trip.createdAt = createdAt;
      await repository.createWithAdminAndDestination(input);
      return input;
    };
    const listed = async (userId: ObjectId) => {
      const result = await createMongoTripManagementRepository(database).listForMember(domainId(userId));
      if (!result.ok) throw result.error;
      return result.value;
    };

    it("returns null bounds for a trip without transports", async () => {
      const owner = new ObjectId();
      await seedTrip("VIAJE-A1", owner);
      expect(await listed(owner)).toMatchObject([{ startAt: null, endAt: null }]);
    });

    it("derives min and max across several destinations and unordered transports", async () => {
      const owner = new ObjectId();
      const input = await seedTrip("VIAJE-A2", owner);
      const second = new ObjectId();
      await database.collection("destinations").insertOne({ _id: second, tripId: new ObjectId(input.trip.id), name: "Ushuaia", order: 2, createdAt: new Date() });
      await seedTransport(input.trip.id, second.toHexString(), at("2026-10-20T08:00:00.000Z"), at("2026-10-20T10:00:00.000Z"));
      await seedTransport(input.trip.id, input.primaryDestination.id, at("2026-10-05T08:00:00.000Z"), at("2026-10-05T10:00:00.000Z"));
      await seedTransport(input.trip.id, second.toHexString(), at("2026-10-25T08:00:00.000Z"), at("2026-10-25T18:00:00.000Z"));
      const [item] = await listed(owner);
      expect(item!.startAt).toEqual(at("2026-10-05T08:00:00.000Z"));
      expect(item!.endAt).toEqual(at("2026-10-25T18:00:00.000Z"));
    });

    it("keeps only known dates for incomplete or legacy transports", async () => {
      const owner = new ObjectId();
      const input = await seedTrip("VIAJE-A3", owner);
      await seedTransport(input.trip.id, input.primaryDestination.id, at("2026-10-05T08:00:00.000Z"), null);
      await seedTransport(input.trip.id, input.primaryDestination.id, "2026-09-01T00:00:00.000Z", undefined);
      const [item] = await listed(owner);
      expect(item!.startAt).toEqual(at("2026-10-05T08:00:00.000Z"));
      expect(item!.endAt).toEqual(at("2026-10-05T08:00:00.000Z"));
    });

    it("returns null bounds when every stored date is unusable", async () => {
      const owner = new ObjectId();
      const input = await seedTrip("VIAJE-A4", owner);
      await seedTransport(input.trip.id, input.primaryDestination.id, null, "2026-09-01");
      expect(await listed(owner)).toMatchObject([{ startAt: null, endAt: null }]);
    });

    it("preserves millisecond precision", async () => {
      const owner = new ObjectId();
      const input = await seedTrip("VIAJE-A5", owner);
      await seedTransport(input.trip.id, input.primaryDestination.id, at("2026-10-05T08:00:00.123Z"), at("2026-10-09T08:00:00.999Z"));
      const [item] = await listed(owner);
      expect(item!.startAt?.toISOString()).toBe("2026-10-05T08:00:00.123Z");
      expect(item!.endAt?.toISOString()).toBe("2026-10-09T08:00:00.999Z");
    });

    it("reflects edited transport dates on the next listing", async () => {
      const owner = new ObjectId();
      const input = await seedTrip("VIAJE-A6", owner);
      await seedTransport(input.trip.id, input.primaryDestination.id, at("2026-10-05T08:00:00.000Z"), at("2026-10-09T08:00:00.000Z"));
      expect(await listed(owner)).toMatchObject([{ endAt: at("2026-10-09T08:00:00.000Z") }]);
      await database.collection("transports").updateOne({ tripId: new ObjectId(input.trip.id) }, { $set: { arrivalAt: at("2026-10-12T08:00:00.000Z"), departureAt: at("2026-10-01T08:00:00.000Z") } });
      expect(await listed(owner)).toMatchObject([{ startAt: at("2026-10-01T08:00:00.000Z"), endAt: at("2026-10-12T08:00:00.000Z") }]);
    });

    it("isolates trips, keeps createdAt order and hides foreign trips from non-members", async () => {
      const owner = new ObjectId();
      const older = await seedTrip("VIAJE-B1", owner, at("2026-09-01T00:00:00.000Z"));
      const newer = await seedTrip("VIAJE-B2", owner, at("2026-09-02T00:00:00.000Z"));
      const foreign = await seedTrip("VIAJE-B3", new ObjectId());
      await seedTransport(older.trip.id, older.primaryDestination.id, at("2026-10-01T00:00:00.000Z"), at("2026-10-02T00:00:00.000Z"));
      await seedTransport(foreign.trip.id, foreign.primaryDestination.id, at("2026-01-01T00:00:00.000Z"), at("2027-01-01T00:00:00.000Z"));
      const items = await listed(owner);
      expect(items.map((item) => item.id)).toEqual([newer.trip.id, older.trip.id]);
      expect(items[0]).toMatchObject({ startAt: null, endAt: null });
      expect(items[1]).toMatchObject({ startAt: at("2026-10-01T00:00:00.000Z"), endAt: at("2026-10-02T00:00:00.000Z") });
      expect(await listed(new ObjectId())).toEqual([]);
    });

    it("reads transports with a single grouped aggregation for many trips", async () => {
      const owner = new ObjectId();
      for (const code of ["VIAJE-C1", "VIAJE-C2", "VIAJE-C3"]) {
        const input = await seedTrip(code, owner);
        await seedTransport(input.trip.id, input.primaryDestination.id, at("2026-10-01T00:00:00.000Z"), at("2026-10-02T00:00:00.000Z"));
      }
      const original = database.collection.bind(database);
      const calls = { aggregate: 0, find: 0 };
      const spy = vi.spyOn(database, "collection").mockImplementation(((name: string) => {
        const collection = original(name);
        if (name !== "transports") return collection;
        const aggregate = collection.aggregate.bind(collection);
        const find = collection.find.bind(collection);
        collection.aggregate = ((...args: unknown[]) => { calls.aggregate += 1; return (aggregate as (...a: unknown[]) => unknown)(...args); }) as never;
        collection.find = ((...args: unknown[]) => { calls.find += 1; return (find as (...a: unknown[]) => unknown)(...args); }) as never;
        return collection;
      }) as never);
      try {
        const result = await createMongoTripManagementRepository(database).listForMember(domainId(owner));
        expect(result).toMatchObject({ ok: true });
        expect(calls).toEqual({ aggregate: 1, find: 0 });
      } finally {
        spy.mockRestore();
      }
    });

    it("fails without partial data when the transports read fails", async () => {
      const owner = new ObjectId();
      await seedTrip("VIAJE-D1", owner);
      const original = database.collection.bind(database);
      const spy = vi.spyOn(database, "collection").mockImplementation(((name: string) => {
        if (name !== "transports") return original(name);
        return { aggregate: () => { throw new Error("boom"); } };
      }) as never);
      try {
        const result = await createMongoTripManagementRepository(database).listForMember(domainId(owner));
        expect(result).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
        expect(result).not.toHaveProperty("value");
      } finally {
        spy.mockRestore();
      }
    });
  });
});
