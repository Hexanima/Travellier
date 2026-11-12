import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoClient, ObjectId } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createObjectId } from "app-domain";
import { handleApiRequest, type TripApi } from "../app.js";
import { migrateMongoSchema } from "../adapters/mongodb/migrations.js";
import { createTripApi } from "./trip-api.js";

describe("Mis viajes: fechas derivadas de los transportes", () => {
  let server: MongoMemoryReplSet, client: MongoClient, api: TripApi;
  const database = () => client.db("trip_list_dates");
  const request = (user: string, method: string, url: string, body?: unknown) => {
    const id = createObjectId(user);
    if (!id.ok) throw id.error;
    return handleApiRequest({ method, url, authenticatedUserId: id.value, body: body === undefined ? undefined : JSON.stringify(body) }, { trips: api });
  };
  const json = (response: { body: string }) => JSON.parse(response.body);
  const transport = (direction: "outbound" | "return", departureAt: string, arrivalAt: string) => ({
    direction, type: "car", departurePlace: "A", arrivalPlace: "B", departureAt, arrivalAt, costPerPerson: null, details: {},
  });
  let actor: string, outsider: string;

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
    outsider = new ObjectId().toHexString();
  });

  it("lists null dates, then derived dates, and updates them after editing a transport", async () => {
    const created = json(await request(actor, "POST", "/trips", { name: "Fechas", primaryDestination: "CÃ³rdoba" })).trip;
    const base = `/trips/${created.id}/destinations/${created.primaryDestination.id}/transports`;
    expect(json(await request(actor, "GET", "/trips")).trips).toMatchObject([{ id: created.id, startAt: null, endAt: null }]);

    const outbound = await request(actor, "POST", base, transport("outbound", "2026-10-01T08:00:00.123Z", "2026-10-01T11:00:00.456Z"));
    expect(outbound.statusCode).toBe(201);
    const back = await request(actor, "POST", base, transport("return", "2026-10-09T15:00:00.000Z", "2026-10-09T18:00:00.999Z"));
    expect(back.statusCode).toBe(201);
    expect(json(await request(actor, "GET", "/trips")).trips).toMatchObject([
      { id: created.id, startAt: "2026-10-01T08:00:00.123Z", endAt: "2026-10-09T18:00:00.999Z" },
    ]);

    const edited = await request(actor, "PATCH", `${base}/${json(back).transport.id}`, { departureAt: "2026-10-12T15:00:00.000Z", arrivalAt: "2026-10-12T20:00:00.000Z" });
    expect(edited.statusCode).toBe(200);
    expect(json(await request(actor, "GET", "/trips")).trips).toMatchObject([
      { startAt: "2026-10-01T08:00:00.123Z", endAt: "2026-10-12T20:00:00.000Z" },
    ]);
  });

  it("keeps the end empty with only an outbound transport and sets it once the return exists", async () => {
    const created = json(await request(actor, "POST", "/trips", { name: "Fechas", primaryDestination: "Córdoba" })).trip;
    const base = `/trips/${created.id}/destinations/${created.primaryDestination.id}/transports`;
    expect((await request(actor, "POST", base, transport("outbound", "2026-10-01T08:00:00.000Z", "2026-10-01T11:00:00.000Z"))).statusCode).toBe(201);
    expect(json(await request(actor, "GET", "/trips")).trips).toMatchObject([{ id: created.id, startAt: "2026-10-01T08:00:00.000Z", endAt: null }]);
    expect((await request(actor, "POST", base, transport("return", "2026-10-09T15:00:00.000Z", "2026-10-09T18:00:00.000Z"))).statusCode).toBe(201);
    expect(json(await request(actor, "GET", "/trips")).trips).toMatchObject([{ id: created.id, endAt: "2026-10-09T18:00:00.000Z" }]);
  });

  it("keeps the end empty when a second destination has no return", async () => {
    const created = json(await request(actor, "POST", "/trips", { name: "Fechas", primaryDestination: "Córdoba" })).trip;
    const base = `/trips/${created.id}/destinations/${created.primaryDestination.id}/transports`;
    await request(actor, "POST", base, transport("outbound", "2026-10-01T08:00:00.000Z", "2026-10-01T11:00:00.000Z"));
    await request(actor, "POST", base, transport("return", "2026-10-09T15:00:00.000Z", "2026-10-09T18:00:00.000Z"));
    await database().collection("destinations").insertOne({ _id: new ObjectId(), tripId: new ObjectId(created.id), name: "Salta", order: 2, createdAt: new Date() });
    expect(json(await request(actor, "GET", "/trips")).trips).toMatchObject([{ id: created.id, startAt: "2026-10-01T08:00:00.000Z", endAt: null }]);
  });

  it("answers 200 with null dates and destination for a trip without a primary destination", async () => {
    const created = json(await request(actor, "POST", "/trips", { name: "Sin destino", primaryDestination: "Córdoba" })).trip;
    await database().collection("destinations").deleteMany({ tripId: new ObjectId(created.id) });
    const response = await request(actor, "GET", "/trips");
    expect(response.statusCode).toBe(200);
    expect(json(response).trips).toMatchObject([{ id: created.id, primaryDestination: null, startAt: null, endAt: null }]);
  });

  it("does not list a foreign trip and does not widen the detail or public preview", async () => {
    const created = json(await request(actor, "POST", "/trips", { name: "Fechas", primaryDestination: "CÃ³rdoba" })).trip;
    const base = `/trips/${created.id}/destinations/${created.primaryDestination.id}/transports`;
    await request(actor, "POST", base, transport("outbound", "2026-10-01T08:00:00.000Z", "2026-10-01T11:00:00.000Z"));
    expect(json(await request(outsider, "GET", "/trips")).trips).toEqual([]);

    expect(json(await request(actor, "GET", `/trips/${created.id}`)).trip).not.toHaveProperty("startAt");
    expect(json(await request(actor, "GET", `/trips/${created.id}`)).trip).not.toHaveProperty("endAt");
    await request(actor, "PATCH", `/trips/${created.id}/config`, { visibility: "public" });
    const preview = json(await request(outsider, "GET", `/trips/${created.id}`)).trip;
    expect(preview).not.toHaveProperty("startAt");
    expect(preview).not.toHaveProperty("endAt");
    for (const trip of json(await request(outsider, "GET", "/trips/public")).trips) {
      expect(trip).not.toHaveProperty("startAt");
      expect(trip).not.toHaveProperty("endAt");
    }
  });
});
