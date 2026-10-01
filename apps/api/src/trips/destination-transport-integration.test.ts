import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoClient, ObjectId } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createObjectId } from "app-domain";
import { migrateMongoSchema } from "../adapters/mongodb/migrations.js";
import { createAuthenticationTokenAdapter } from "../auth/authentication-token-adapter.js";
import { createLocalApi } from "../local.js";

describe("local destination and transport API", () => {
  let server: MongoMemoryReplSet;
  beforeAll(async () => { server = await MongoMemoryReplSet.create({ replSet: { count: 1 } }); }, 120_000);
  afterAll(async () => { await server?.stop(); });

  it("keeps destination order unique and rejects a transport for another Trip", async () => {
    const databaseName = "journey_api_test";
    const client = new MongoClient(server.getUri());
    await client.connect();
    const database = client.db(databaseName);
    await migrateMongoSchema(database);
    const local = await createLocalApi({ MONGODB_URI: server.getUri(), MONGODB_DATABASE_NAME: databaseName, JWT_SECRET: "journey-secret" });
    await new Promise<void>((resolve) => local.app.listen(0, resolve));
    const base = `http://127.0.0.1:${(local.app.address() as AddressInfo).port}`;
    const tokens = createAuthenticationTokenAdapter({ jwtSecret: "journey-secret", accessTokenLifetimeMs: 900_000 });
    const headersFor = async (raw: ObjectId) => {
      const parsed = createObjectId(raw.toHexString());
      if (!parsed.ok) throw parsed.error;
      const token = await tokens.createAccessToken(parsed.value);
      if (!token.ok) throw token.error;
      return { authorization: `Bearer ${token.value}`, "content-type": "application/json" };
    };
    const headers = await headersFor(new ObjectId());
    const outsiderHeaders = await headersFor(new ObjectId());
    const post = (url: string, body: unknown, auth = headers) => fetch(`${base}${url}`, { method: "POST", headers: auth, body: JSON.stringify(body) });
    const trip = async (name: string) => {
      const response = await post("/trips", { name, primaryDestination: `${name} principal` });
      expect(response.status).toBe(201);
      return (await response.json() as { trip: { id: string; primaryDestination: { id: string } } }).trip;
    };
    try {
      const first = await trip("Primero");
      const second = await trip("Segundo");
      const path = `/trips/${first.id}/destinations`;
      expect((await fetch(`${base}${path}`, { headers: outsiderHeaders })).status).toBe(404);
      const created = await Promise.all(["Dos", "Tres"].map((name) => post(path, { name })));
      expect(created.map((response) => response.status)).toEqual([201, 201]);
      const thirdId = (await created[1]!.json() as { destination: { id: string } }).destination.id;
      const moved = await fetch(`${base}${path}/${thirdId}`, { method: "PATCH", headers, body: JSON.stringify({ order: 1, name: "Primero ahora" }) });
      expect(moved.status).toBe(200);
      const listed = await fetch(`${base}${path}`, { headers });
      expect((await listed.json() as { destinations: { name: string; order: number }[] }).destinations).toMatchObject([
        { name: "Primero ahora", order: 1 }, { name: "Primero principal", order: 2 }, { name: "Dos", order: 3 },
      ]);

      const transportBody = { direction: "outbound", type: "car", departurePlace: "Origen", departureAt: "2026-09-24T08:00:00Z",
        arrivalPlace: "Destino", arrivalAt: "2026-09-24T09:00:00Z", costPerPerson: null, details: {} };
      const wrongPath = `/trips/${first.id}/destinations/${second.primaryDestination.id}/transports`;
      expect((await post(wrongPath, transportBody)).status).toBe(404);
      expect(await database.collection("transports").countDocuments({})).toBe(0);
      const transportPath = `/trips/${first.id}/destinations/${first.primaryDestination.id}/transports`;
      const saved = await post(transportPath, transportBody);
      expect(saved.status).toBe(201);
      const savedTransport = (await saved.json() as { transport: { id: string } }).transport;
      expect((await post(transportPath, transportBody)).status).toBe(409);
      const updated = await fetch(`${base}${transportPath}/${savedTransport.id}`, { method: "PATCH", headers,
        body: JSON.stringify({ arrivalPlace: "Nuevo destino" }) });
      expect(updated.status).toBe(200);
      expect(await updated.json()).toMatchObject({ transport: { id: savedTransport.id, arrivalPlace: "Nuevo destino",
        departurePlace: transportBody.departurePlace, direction: transportBody.direction } });
      const invalidTime = await fetch(`${base}${transportPath}/${savedTransport.id}`, { method: "PATCH", headers,
        body: JSON.stringify({ arrivalAt: "2026-09-24T07:00:00Z" }) });
      expect(invalidTime.status).toBe(422);
      expect((await fetch(`${base}${transportPath}`, { headers: outsiderHeaders })).status).toBe(404);
      expect(await (await fetch(`${base}${transportPath}`, { headers })).json()).toMatchObject({ transports: [
        { id: savedTransport.id, arrivalPlace: "Nuevo destino", arrivalAt: transportBody.arrivalAt.replace("Z", ".000Z") },
      ] });
      expect((await fetch(`${base}/trips/${second.id}/destinations/${first.primaryDestination.id}/transports/${savedTransport.id}`,
        { method: "PATCH", headers, body: JSON.stringify(transportBody) })).status).toBe(404);
      expect(await database.collection("transports").countDocuments({})).toBe(1);
    } finally {
      await new Promise<void>((resolve, reject) => local.app.close((error) => error ? reject(error) : resolve()));
      await local.close();
      await client.close();
    }
  }, 20_000);
});
