import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Db, MongoClient, ObjectId } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createObjectId, err, generateItineraryDays, UnknownError, type ObjectId as DomainId } from "app-domain";
import { migrateMongoSchema } from "../adapters/mongodb/migrations.js";
import { createMongoTripJourneyRepository } from "../adapters/mongodb/trip-journey-repository.js";
import { createTripApi } from "./trip-api.js";

const domainId = (id: ObjectId): DomainId => {
  const result = createObjectId(id.toHexString());
  if (!result.ok) throw result.error;
  return result.value;
};

describe("persisted itinerary transactions", () => {
  let server: MongoMemoryReplSet, client: MongoClient, database: Db;
  let trip: ObjectId, destination: ObjectId, actor: ObjectId;
  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    client = new MongoClient(server.getUri());
    await client.connect();
    database = client.db("itinerary_transactions");
    await migrateMongoSchema(database);
  }, 120_000);
  afterAll(async () => { await client?.close(); await server?.stop(); });
  beforeEach(async () => {
    vi.restoreAllMocks();
    for (const name of ["trips", "destinations", "transports", "tripMembers", "itineraryDays", "activities", "posts", "postPhotos", "postExpenses"]) {
      await database.collection(name).deleteMany({});
    }
    trip = new ObjectId(); destination = new ObjectId(); actor = new ObjectId();
    await database.collection("trips").insertOne({ _id: trip, inviteCode: trip.toHexString() });
    await database.collection("destinations").insertOne({ _id: destination, tripId: trip, name: "Córdoba", order: 1, createdAt: new Date() });
    await database.collection("tripMembers").insertOne({ tripId: trip, userId: actor, role: "participant", joinedAt: new Date() });
  });
  const context = () => ({ authenticatedUserId: domainId(actor), tripId: domainId(trip), destinationId: domainId(destination) });
  const input = (direction: "outbound" | "return") => ({ ...context(), direction, type: "car" as const,
    departurePlace: "Origen", arrivalPlace: "Destino", costPerPerson: null, details: {},
    departureAt: new Date(direction === "outbound" ? "2026-09-25T08:00:00.123Z" : "2026-09-26T18:00:00.789Z"),
    arrivalAt: new Date(direction === "outbound" ? "2026-09-25T10:00:00.456Z" : "2026-09-26T20:00:00.123Z") });
  const days = () => database.collection("itineraryDays").find({ tripId: trip }).sort({ order: 1 }).toArray();
  const configure = async () => {
    const repository = createMongoTripJourneyRepository(database);
    expect(repository.withTransaction).toBeTypeOf("function");
    const api = createTripApi(database);
    const outbound = await api.createTransport!(input("outbound"));
    expect(outbound.ok).toBe(true);
    const returning = await api.createTransport!(input("return"));
    expect(returning.ok).toBe(true);
    if (!outbound.ok || !returning.ok) throw new Error("Configuration failed");
    return { api, outbound: outbound.value, returning: returning.value };
  };

  it("stores BSON IDs, UTC instants and stable identities on repeated PATCH", async () => {
    const { api, outbound } = await configure();
    const before = await days();
    expect(before.map((day) => day.type)).toEqual(["transit_out", "activity", "activity", "transit_return"]);
    expect(before.every((day) => day._id instanceof ObjectId && day.tripId instanceof ObjectId && day.destinationId instanceof ObjectId)).toBe(true);
    expect(before[1]!.startsAt).toEqual(input("outbound").arrivalAt);
    expect(before[2]!.endsAt).toEqual(input("return").departureAt);
    const patch = { ...context(), transportId: outbound.id, departureAt: new Date("2026-09-24T20:00:00Z") };
    expect((await api.updateTransport!(patch)).ok).toBe(true);
    const expanded = await days();
    expect(expanded).toHaveLength(5);
    expect(expanded.slice(1).map((day) => day._id)).toEqual(before.map((day) => day._id));
    expect((await api.updateTransport!(patch)).ok).toBe(true);
    expect(await days()).toEqual(expanded);
    const read = await createMongoTripJourneyRepository(database).listItineraryDays(domainId(trip));
    expect(read).toMatchObject({ ok: true, value: expanded.map((day) => ({ id: day._id.toHexString(), startsAt: day.startsAt })) });
    expect(await days()).toEqual(expanded);
  });

  it.each(["activities", "posts"])("rejects deleting a day with %s without changing any data", async (collection) => {
    const { api, outbound } = await configure();
    const before = await days();
    const reference = { tripId: trip, dayId: before[1]!._id, scheduledAt: new Date("2026-09-25T12:00:00Z"), createdAt: new Date("2026-10-01T12:00:00Z"), transportId: new ObjectId(outbound.id) };
    await database.collection(collection).insertOne(reference);
    const postId = new ObjectId();
    await database.collection("postPhotos").insertOne({ postId, s3Key: "photo" });
    await database.collection("postExpenses").insertOne({ postId, amount: 42 });
    const dependent = await database.collection(collection).find().toArray();
    expect(await api.updateTransport!({ ...context(), transportId: outbound.id, arrivalAt: new Date("2026-09-26T10:00:00Z") }))
      .toMatchObject({ ok: false, error: { tag: "ItineraryConflictError" } });
    expect(await days()).toEqual(before);
    expect(await database.collection("transports").findOne({ _id: new ObjectId(outbound.id) })).toMatchObject({ arrivalAt: outbound.arrivalAt });
    expect(await database.collection(collection).find().toArray()).toEqual(dependent);
    expect(await database.collection("postPhotos").findOne({ postId })).toMatchObject({ s3Key: "photo" });
    expect(await database.collection("postExpenses").findOne({ postId })).toMatchObject({ amount: 42 });
  });

  it("rejects shrinking past an activity, then accepts a compatible shrink preserving all references", async () => {
    const { api, outbound } = await configure();
    const before = await days();
    await database.collection("activities").insertOne({ tripId: trip, dayId: before[1]!._id, scheduledAt: new Date("2026-09-25T12:00:00Z") });
    await database.collection("posts").insertOne({ tripId: trip, dayId: before[1]!._id, createdAt: new Date("2026-10-01T12:00:00Z") });
    expect(await api.updateTransport!({ ...context(), transportId: outbound.id, arrivalAt: new Date("2026-09-25T12:00:00.001Z") }))
      .toMatchObject({ ok: false, error: { tag: "ItineraryConflictError" } });
    expect(await days()).toEqual(before);
    expect((await api.updateTransport!({ ...context(), transportId: outbound.id, arrivalAt: new Date("2026-09-25T11:00:00Z") })).ok).toBe(true);
    expect((await days()).map((day) => day._id)).toEqual(before.map((day) => day._id));
    expect(await database.collection("activities").findOne({ tripId: trip })).toMatchObject({ dayId: before[1]!._id });
    expect(await database.collection("posts").findOne({ tripId: trip })).toMatchObject({ dayId: before[1]!._id });
  });

  it("aborts Result.err after writes instead of committing the transaction", async () => {
    const repository = createMongoTripJourneyRepository(database);
    expect(repository.withTransaction).toBeTypeOf("function");
    const result = await repository.withTransaction(domainId(trip), async (journeys) => {
      const saved = await journeys.insertTransport({ ...input("outbound"), id: domainId(new ObjectId()) });
      expect(saved.ok).toBe(true);
      return err(new UnknownError("Injected rejection"));
    });
    expect(result).toMatchObject({ ok: false, error: { tag: "UnknownError", message: "Injected rejection" } });
    expect(await database.collection("transports").countDocuments({})).toBe(0);
    expect(await database.collection("trips").findOne({ _id: trip })).not.toHaveProperty("destinationOrderRevision");
  });

  it.each(["create", "update"])("rolls back %s and all days after an injected database failure", async (operation) => {
    const { outbound } = await configure();
    const before = await days();
    const collection = database.collection("itineraryDays");
    const realCollection = database.collection.bind(database);
    vi.spyOn(database, "collection").mockImplementation(((name: string) => name === "itineraryDays" ? collection : realCollection(name)) as typeof database.collection);
    vi.spyOn(collection, "bulkWrite").mockRejectedValue(new Error("Injected write failure"));
    const failingApi = createTripApi(database);
    let result;
    if (operation === "update") result = await failingApi.updateTransport!({ ...context(), transportId: outbound.id, arrivalPlace: "Changed" });
    else {
      const target = new ObjectId();
      await realCollection("destinations").insertOne({ _id: target, tripId: trip, name: "Segundo", order: 2, createdAt: new Date() });
      result = await failingApi.createTransport!({ ...input("outbound"), destinationId: domainId(target), departureAt: new Date("2026-09-27T08:00:00Z"), arrivalAt: new Date("2026-09-27T10:00:00Z") });
    }
    expect(result).toMatchObject({ ok: false, error: { tag: "UnknownError" } });
    vi.restoreAllMocks();
    expect(await days()).toEqual(before);
    expect(await database.collection("transports").countDocuments({})).toBe(2);
    expect(await database.collection("transports").findOne({ _id: new ObjectId(outbound.id) })).toMatchObject({ arrivalPlace: outbound.arrivalPlace });
  });

  it("rolls back already written projection rows when removal fails", async () => {
    const { outbound } = await configure();
    const before = await days();
    const collection = database.collection("itineraryDays");
    const realCollection = database.collection.bind(database);
    vi.spyOn(database, "collection").mockImplementation(((name: string) => name === "itineraryDays" ? collection : realCollection(name)) as typeof database.collection);
    vi.spyOn(collection, "deleteMany").mockRejectedValue(new Error("Injected removal failure"));
    expect(await createTripApi(database).updateTransport!({ ...context(), transportId: outbound.id, departureAt: new Date("2026-09-24T20:00:00Z") }))
      .toMatchObject({ ok: false, error: { tag: "UnknownError" } });
    vi.restoreAllMocks();
    expect(await days()).toEqual(before);
    expect(await database.collection("transports").findOne({ _id: new ObjectId(outbound.id) })).toMatchObject({ departureAt: outbound.departureAt });
  });

  it("removes only obsolete unreferenced rows of the target Trip", async () => {
    const { api, outbound } = await configure();
    const before = await days();
    const otherTrip = new ObjectId();
    const foreignDay = { ...before[1]!, _id: new ObjectId(), tripId: otherTrip };
    await database.collection("itineraryDays").insertOne(foreignDay);
    expect((await api.updateTransport!({ ...context(), transportId: outbound.id, arrivalAt: new Date("2026-09-26T10:00:00Z") })).ok).toBe(true);
    expect(await database.collection("itineraryDays").findOne({ _id: before[1]!._id })).toBeNull();
    expect(await database.collection("itineraryDays").findOne({ _id: foreignDay._id })).toEqual(foreignDay);
    expect((await days()).filter((day) => day.type === "activity")).toHaveLength(1);
  });

  it("regenerates every destination and serializes reordering with transport changes", async () => {
    const { api, outbound } = await configure();
    const second = new ObjectId(), empty = new ObjectId();
    await database.collection("destinations").insertMany([
      { _id: second, tripId: trip, name: "Carlos Paz", order: 2, createdAt: new Date() },
      { _id: empty, tripId: trip, name: "Sin configurar", order: 3, createdAt: new Date() },
    ]);
    expect((await api.createTransport!({ ...input("outbound"), destinationId: domainId(second),
      departureAt: new Date("2026-09-26T18:00:00.789Z"), arrivalAt: new Date("2026-09-26T20:00:00.123Z") })).ok).toBe(true);
    expect((await api.createTransport!({ ...input("return"), destinationId: domainId(second),
      departureAt: new Date("2026-09-27T18:00:00Z"), arrivalAt: new Date("2026-09-27T20:00:00Z") })).ok).toBe(true);
    const before = await days();
    expect(before).toHaveLength(8);
    expect(before.filter((day) => day.date.toISOString() === "2026-09-26T00:00:00.000Z" && day.type === "activity")).toHaveLength(2);
    const destinationSnapshot = await database.collection("destinations").find({ tripId: trip }).sort({ order: 1 }).toArray();
    expect(await api.updateDestination!({ ...context(), destinationId: domainId(second), order: 1 }))
      .toMatchObject({ ok: false, error: { tag: "ValidationError" } });
    expect(await database.collection("destinations").find({ tripId: trip }).sort({ order: 1 }).toArray()).toEqual(destinationSnapshot);
    expect(await days()).toEqual(before);
    const results = await Promise.all([
      api.updateDestination!({ ...context(), destinationId: domainId(empty), order: 1 }),
      api.updateTransport!({ ...context(), transportId: outbound.id, departureAt: new Date("2026-09-24T20:00:00Z") }),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    const repository = createMongoTripJourneyRepository(database);
    const destinations = await repository.listDestinations(domainId(trip));
    const transports = await repository.listTransports(domainId(trip));
    const persisted = await repository.listItineraryDays(domainId(trip));
    if (!destinations.ok || !transports.ok || !persisted.ok) throw new Error("Read failed");
    const generated = await generateItineraryDays.execute({}, { tripId: domainId(trip), destinations: destinations.value, transports: transports.value });
    expect(generated.ok).toBe(true);
    expect(persisted.value.map((day) => ({ tripId: day.tripId, destinationId: day.destinationId, date: day.date,
      type: day.type, startsAt: day.startsAt, endsAt: day.endsAt, order: day.order })))
      .toEqual(generated.ok ? generated.value : []);
    expect((await days()).slice(1).map((day) => day._id)).toEqual(before.map((day) => day._id));
  });

  it("reads the same canonical references regardless of the presentation timezone", async () => {
    await configure();
    const before = await days();
    const repository = createMongoTripJourneyRepository(database);
    const canonical = await repository.listItineraryDays(domainId(trip));
    for (const timeZone of ["America/Argentina/Buenos_Aires", "Asia/Tokyo", "America/New_York"]) {
      const result = await repository.listItineraryDays(domainId(trip));
      expect(result).toEqual(canonical);
      if (!result.ok) throw new Error("Read failed");
      for (const day of result.value) new Intl.DateTimeFormat("es-AR", { timeZone }).format(day.startsAt);
    }
    expect(await days()).toEqual(before);
  });

  it("serializes simultaneous complementary creates and partial PATCHes without lost updates", async () => {
    const repository = createMongoTripJourneyRepository(database);
    expect(repository.withTransaction).toBeTypeOf("function");
    const api = createTripApi(database);
    const results = await Promise.all([api.createTransport!(input("outbound")), api.createTransport!(input("return"))]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(await days()).toHaveLength(4);
    const outbound = results[0]!;
    if (!outbound.ok) throw new Error("Creation failed");
    const patches = await Promise.all([
      api.updateTransport!({ ...context(), transportId: outbound.value.id, arrivalPlace: "Nuevo destino" }),
      api.updateTransport!({ ...context(), transportId: outbound.value.id, costPerPerson: 42, departureAt: new Date("2026-09-24T20:00:00Z") }),
    ]);
    expect(patches.every((result) => result.ok)).toBe(true);
    expect(await database.collection("transports").findOne({ _id: new ObjectId(outbound.value.id) }))
      .toMatchObject({ arrivalPlace: "Nuevo destino", costPerPerson: 42, departureAt: new Date("2026-09-24T20:00:00Z") });
    expect(await days()).toHaveLength(5);
    expect((await days()).map((day) => day.order)).toEqual([1, 2, 3, 4, 5]);
  });
});
