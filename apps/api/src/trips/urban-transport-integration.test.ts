import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoClient, ObjectId } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createObjectId } from "app-domain";
import { handleApiRequest, type TripApi } from "../app.js";
import { migrateMongoSchema } from "../adapters/mongodb/migrations.js";
import { createTripApi } from "./trip-api.js";

describe("urban transport HTTP validation", () => {
  let server: MongoMemoryReplSet, client: MongoClient, api: TripApi;
  let tripId: string, destinationId: string, actor: string, path: string;
  const database = () => client.db("urban_transport_regression");
  const step = (estimatedAt: string) => ({ line: "1", fromStop: "A", toStop: "B", estimatedAt });
  const input = () => ({ direction: "outbound", type: "bus_local", departurePlace: "A", arrivalPlace: "B",
    departureAt: "2026-10-03T23:30:00.123Z", arrivalAt: "2026-10-04T01:00:00.456Z", costPerPerson: null,
    details: { steps: [step("2026-10-04T00:30:00.345Z")] } });
  const request = (method: string, url: string, body?: unknown) => {
    const id = createObjectId(actor);
    if (!id.ok) throw id.error;
    return handleApiRequest({ method, url, authenticatedUserId: id.value,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, { trips: api });
  };
  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    client = new MongoClient(server.getUri()); await client.connect();
    await migrateMongoSchema(database()); api = createTripApi(database());
  }, 120_000);
  afterAll(async () => { await client?.close(); await server?.stop(); });
  beforeEach(async () => {
    for (const name of ["trips", "tripMembers", "destinations", "transports", "itineraryDays"]) {
      await database().collection(name).deleteMany({});
    }
    actor = new ObjectId().toHexString();
    const response = await request("POST", "/trips", { name: "Audit", primaryDestination: "Córdoba" });
    const trip = JSON.parse(response.body).trip;
    tripId = trip.id; destinationId = trip.primaryDestination.id;
    path = `/trips/${tripId}/destinations/${destinationId}/transports`;
  });
  const snapshot = async () => ({
    transports: await database().collection("transports").find().toArray(),
    days: await database().collection("itineraryDays").find().toArray(),
  });

  it("rejects the audited clock-only request without persisting a transport or days", async () => {
    const response = await request("POST", path, { ...input(),
      details: { steps: ["19:00", "18:00"].map((estimatedTime) => ({ line: "1", fromStop: "A", toStop: "B", estimatedTime })) } });
    expect(response.statusCode).toBe(422);
    expect(JSON.parse(response.body)).toMatchObject({ error: { fields: [{ field: "details.steps[0].estimatedAt" }] } });
    expect(await snapshot()).toEqual({ transports: [], days: [] });
  });
  it("stores step instants as BSON dates and returns UTC in both GET contracts", async () => {
    const response = await request("POST", path, input());
    expect(response.statusCode).toBe(201);
    expect((await database().collection("transports").findOne({}))?.details.steps[0].estimatedAt)
      .toEqual(new Date(input().details.steps[0].estimatedAt));
    expect(JSON.parse((await request("GET", path)).body).transports[0].details).toEqual(input().details);
    const itinerary = JSON.parse((await request("GET", `/trips/${tripId}/itinerary`)).body).itinerary;
    expect(itinerary.transports[0].details).toEqual(input().details);
    expect(itinerary.days.length).toBeGreaterThan(0);
  });
  it.each([
    ["2026-10-03T23:30:00.122Z"], ["2026-10-04T01:00:00.457Z"], ["tomorrow"], ["2026-10-04"],
    ["2026-10-04T00:45:00.000Z", "2026-10-04T00:30:00.000Z"],
  ])("rejects invalid POST and PATCH steps %j without modifying the itinerary", async (...times: string[]) => {
    const invalid = { ...input(), details: { steps: times.map(step) } };
    expect((await request("POST", path, invalid)).statusCode).toBe(422);
    expect(await snapshot()).toEqual({ transports: [], days: [] });
    const saved = await request("POST", path, input());
    expect(saved.statusCode).toBe(201);
    const id = JSON.parse(saved.body).transport.id, before = await snapshot();
    expect((await request("PATCH", `${path}/${id}`, { details: invalid.details })).statusCode).toBe(422);
    expect(await snapshot()).toEqual(before);
    expect((await request("PATCH", `${path}/${id}`, { arrivalAt: "2026-10-04T00:00:00.000Z" })).statusCode).toBe(422);
    expect(await snapshot()).toEqual(before);
  });
  it("reads legacy steps without conversion, but requires explicit UTC steps on editing", async () => {
    const legacy = { ...input(), _id: new ObjectId(), tripId: new ObjectId(tripId), destinationId: new ObjectId(destinationId),
      departureAt: new Date(input().departureAt), arrivalAt: new Date(input().arrivalAt),
      details: { steps: [{ line: "1", fromStop: "A", toStop: "B", estimatedTime: "00:30" }] } };
    await database().collection("transports").insertOne(legacy);
    expect(JSON.parse((await request("GET", path)).body).transports[0].details).toEqual(legacy.details);
    // An unrelated destination can still be configured while a legacy segment awaits reconfirmation.
    const added = await request("POST", `/trips/${tripId}/destinations`, { name: "Otro" });
    const nextId = JSON.parse(added.body).destination.id;
    const nextPath = `/trips/${tripId}/destinations/${nextId}/transports`;
    expect((await request("POST", nextPath, { ...input(), type: "car", details: {},
      departureAt: "2026-10-05T08:00:00.000Z", arrivalAt: "2026-10-05T09:00:00.000Z" })).statusCode).toBe(201);
    expect(JSON.parse((await request("GET", `/trips/${tripId}/itinerary`)).body).itinerary.transports[0].details).toEqual(legacy.details);
    const before = await snapshot();
    expect((await request("PATCH", `${path}/${legacy._id}`, { arrivalPlace: "C" })).statusCode).toBe(422);
    expect(await snapshot()).toEqual(before);
    expect((await request("PATCH", `${path}/${legacy._id}`, { details: input().details })).statusCode).toBe(200);
  });
});
