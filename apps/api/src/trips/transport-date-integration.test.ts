import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoClient, ObjectId } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createObjectId } from "app-domain";
import { handleApiRequest, type TripApi } from "../app.js";
import { migrateMongoSchema } from "../adapters/mongodb/migrations.js";
import { createTripApi } from "./trip-api.js";

describe("transport boundary HTTP dates", () => {
  let server: MongoMemoryReplSet, client: MongoClient, api: TripApi;
  let actor: string, path: string;
  const database = () => client.db("transport_date_regression");
  const request = (method: string, url: string, body: unknown) => {
    const id = createObjectId(actor);
    if (!id.ok) throw id.error;
    return handleApiRequest({ method, url, authenticatedUserId: id.value, body: JSON.stringify(body) }, { trips: api });
  };
  const input = (date: string, zone = "Z") => ({
    direction: "outbound", type: "car", departurePlace: "A", arrivalPlace: "B",
    departureAt: `${date}T08:00:00.123${zone}`, arrivalAt: `${date}T11:00:00.456${zone}`,
    costPerPerson: null, details: {},
  });
  const snapshot = async () => ({
    trips: await database().collection("trips").find().toArray(),
    transports: await database().collection("transports").find().toArray(),
    days: await database().collection("itineraryDays").find().toArray(),
  });
  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    client = new MongoClient(server.getUri());
    await client.connect();
    await migrateMongoSchema(database());
    api = createTripApi(database());
  }, 120_000);
  afterAll(async () => { await client?.close(); await server?.stop(); });
  beforeEach(async () => {
    for (const name of ["trips", "tripMembers", "destinations", "transports", "itineraryDays"]) {
      await database().collection(name).deleteMany({});
    }
    actor = new ObjectId().toHexString();
    const response = await request("POST", "/trips", { name: "Date validation", primaryDestination: "Córdoba" });
    expect(response.statusCode).toBe(201);
    const trip = JSON.parse(response.body).trip;
    path = `/trips/${trip.id}/destinations/${trip.primaryDestination.id}/transports`;
  });

  const invalidDates = [
    { invalid: "2026-02-30", normalized: "2026-03-02", zone: "Z" },
    { invalid: "2026-02-29", normalized: "2026-03-01", zone: "Z" },
    { invalid: "2026-04-31", normalized: "2026-05-01", zone: "Z" },
    { invalid: "1900-02-29", normalized: "1900-03-01", zone: "Z" },
    { invalid: "2026-02-30", normalized: "2026-03-02", zone: "-03:00" },
  ];
  const invalidCases = invalidDates.flatMap((date) =>
    (["POST", "PATCH"] as const).flatMap((method) =>
      (["departureAt", "arrivalAt"] as const).map((field) => ({ ...date, method, field }))));
  it.each(invalidCases)("rejects $method $field=$invalid ($zone) without changing stored data", async ({ method, field, invalid, normalized, zone }) => {
    const valid = input(normalized, zone);
    let url = path;
    if (method === "PATCH") {
      const saved = await request("POST", path, valid);
      expect(saved.statusCode).toBe(201);
      url = `${path}/${JSON.parse(saved.body).transport.id}`;
    }
    const before = await snapshot();
    const value = input(invalid, zone)[field];
    const response = await request(method, url, method === "POST" ? { ...valid, [field]: value } : { [field]: value });
    expect(response.statusCode).toBe(422);
    expect(JSON.parse(response.body)).toMatchObject({ error: { fields: [{ field, code: "invalid" }] } });
    expect(await snapshot()).toEqual(before);
  });

  it.each([
    ["2028-02-29T08:00:00.123Z", "2028-02-29T11:00:00.456Z"],
    ["2000-02-29T08:00:00.123Z", "2000-02-29T11:00:00.456Z"],
    ["2026-03-01T00:30:00.123+09:00", "2026-03-01T01:30:00.456+09:00"],
    ["2026-03-01T23:30:00.123-03:00", "2026-03-02T00:30:00.456-03:00"],
    ["2026-03-01T08:00:00Z", "2026-03-01T11:00:00Z"],
    ["2026-03-01T08:00Z", "2026-03-01T11:00Z"],
    ["2026-03-01T08:00:00.1+0300", "2026-03-01T11:00:00.45+0300"],
  ])("preserves valid instants and milliseconds on POST and PATCH: %s", async (departureAt, arrivalAt) => {
    const saved = await request("POST", path, { ...input("2026-03-01"), departureAt, arrivalAt });
    expect(saved.statusCode).toBe(201);
    const transport = JSON.parse(saved.body).transport;
    const expected = { departureAt: new Date(departureAt).toISOString(), arrivalAt: new Date(arrivalAt).toISOString() };
    expect(transport).toMatchObject(expected);
    const updated = await request("PATCH", `${path}/${transport.id}`, { departureAt, arrivalAt });
    expect(updated.statusCode).toBe(200);
    expect(JSON.parse(updated.body).transport).toMatchObject(expected);
    expect(await database().collection("transports").findOne({ _id: new ObjectId(transport.id) }))
      .toMatchObject({ departureAt: new Date(departureAt), arrivalAt: new Date(arrivalAt) });
  });
});
