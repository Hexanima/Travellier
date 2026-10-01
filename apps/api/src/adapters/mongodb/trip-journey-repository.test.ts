import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Db, MongoClient, ObjectId } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createObjectId, type TripDestination, type Transport } from "app-domain";
import { migrateMongoSchema } from "./migrations.js";
import { createMongoTripJourneyRepository } from "./trip-journey-repository.js";

const domainId = (value: ObjectId) => {
  const result = createObjectId(value.toHexString());
  if (!result.ok) throw result.error;
  return result.value;
};

describe("Mongo Trip journey repository", () => {
  let server: MongoMemoryReplSet;
  let client: MongoClient;
  let database: Db;
  let tripId: ObjectId;
  let otherTripId: ObjectId;
  let firstId: ObjectId;

  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    client = new MongoClient(server.getUri());
    await client.connect();
    database = client.db("journey_repository_test");
    await migrateMongoSchema(database);
  }, 120_000);
  afterAll(async () => { await client?.close(); await server?.stop(); });
  beforeEach(async () => {
    await Promise.all(["trips", "destinations", "transports"].map((name) => database.collection(name).deleteMany({})));
    tripId = new ObjectId();
    otherTripId = new ObjectId();
    firstId = new ObjectId();
    await database.collection("trips").insertMany([{ _id: tripId, inviteCode: `TRIP-${tripId.toHexString()}` }, { _id: otherTripId, inviteCode: `TRIP-${otherTripId.toHexString()}` }]);
    await database.collection("destinations").insertOne({ _id: firstId, tripId, name: "Primero", order: 1, createdAt: new Date() });
  });

  const destination = (trip: ObjectId, name: string): TripDestination => ({ id: domainId(new ObjectId()), tripId: domainId(trip), name, order: 1, createdAt: new Date() });
  const transport = (trip: ObjectId, target: ObjectId): Transport => ({ id: domainId(new ObjectId()), tripId: domainId(trip), destinationId: domainId(target),
    direction: "outbound", type: "car", departurePlace: "Origen", departureAt: new Date("2026-09-24T08:00:00Z"), arrivalPlace: "Destino",
    arrivalAt: new Date("2026-09-24T09:00:00Z"), costPerPerson: null, details: {} });

  it("appends concurrent destinations with distinct contiguous orders", async () => {
    const repository = createMongoTripJourneyRepository(database);
    const results = await Promise.all(["Segundo", "Tercero"].map((name) => repository.appendDestination(destination(tripId, name))));
    expect(results.every((result) => result.ok)).toBe(true);
    expect(await repository.listDestinations(domainId(tripId))).toMatchObject({ ok: true, value: [{ order: 1 }, { order: 2 }, { order: 3 }] });
    expect((await database.collection("destinations").find({ tripId }).toArray()).length).toBe(3);
  });

  it("moves a destination and shifts the other positions atomically", async () => {
    const repository = createMongoTripJourneyRepository(database);
    const second = destination(tripId, "Segundo");
    const third = destination(tripId, "Tercero");
    await repository.appendDestination(second);
    await repository.appendDestination(third);
    const moved = await repository.updateDestination(domainId(tripId), third.id, { name: "Nuevo tercero", order: 1 });
    expect(moved).toMatchObject({ ok: true, value: { id: third.id, name: "Nuevo tercero", order: 1 } });
    expect(await repository.listDestinations(domainId(tripId))).toMatchObject({ ok: true, value: [
      { name: "Nuevo tercero", order: 1 }, { name: "Primero", order: 2 }, { name: "Segundo", order: 3 },
    ] });
    expect(await repository.updateDestination(domainId(tripId), third.id, { order: 4 })).toMatchObject({ ok: false, error: { tag: "ValidationError" } });
  });

  it("rejects cross-Trip transport insertion and scoped updates", async () => {
    const repository = createMongoTripJourneyRepository(database);
    const wrong = transport(otherTripId, firstId);
    expect(await repository.insertTransport(wrong)).toEqual({ ok: true, value: undefined });
    expect(await database.collection("transports").countDocuments({})).toBe(0);
    const valid = transport(tripId, firstId);
    expect(await repository.insertTransport(valid)).toMatchObject({ ok: true, value: { id: valid.id } });
    expect(await repository.replaceTransport({ ...valid, tripId: domainId(otherTripId) })).toEqual({ ok: true, value: undefined });
    expect(await repository.listTransports(domainId(tripId), domainId(firstId))).toMatchObject({ ok: true, value: [{ id: valid.id }] });
    expect(await repository.findDestination(domainId(otherTripId), domainId(firstId))).toEqual({ ok: true, value: undefined });
  });

  it("allows only one transport per direction and destination", async () => {
    const repository = createMongoTripJourneyRepository(database);
    expect(await repository.insertTransport(transport(tripId, firstId))).toMatchObject({ ok: true });
    expect(await repository.insertTransport(transport(tripId, firstId))).toMatchObject({ ok: false, error: { tag: "JourneyConflictError" } });
  });
});
