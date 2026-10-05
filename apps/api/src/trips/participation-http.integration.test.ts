import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { SignJWT } from "jose";
import { createObjectId, err, UnknownError } from "app-domain";
import { handleApiRequest, type TripApi } from "../app.js";
import { createLambdaHandler } from "../lambda.js";
import { createTripApi } from "./trip-api.js";
import { migrateMongoSchema } from "../adapters/mongodb/migrations.js";

const id = (value: ObjectId) => {
  const parsed = createObjectId(value.toHexString());
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};

describe("participation HTTP API", () => {
  let server: MongoMemoryReplSet, client: MongoClient, db: Db, api: TripApi;
  let trip: ObjectId, activity: ObjectId, actor: ObjectId, other: ObjectId, path: string;
  const request = (method: string, body?: unknown, user: ObjectId | null = actor, url = path) =>
    handleApiRequest({ method, url, ...(user === null ? {} : { authenticatedUserId: id(user) }),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, { trips: api });

  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    client = new MongoClient(server.getUri()); await client.connect();
    db = client.db("participation_http"); await migrateMongoSchema(db);
  }, 120_000);
  afterAll(async () => { await client?.close(); await server?.stop(); });
  beforeEach(async () => {
    for (const name of ["trips", "tripMembers", "activities", "activityParticipations"]) await db.collection(name).deleteMany({});
    trip = new ObjectId(); activity = new ObjectId(); actor = new ObjectId(); other = new ObjectId();
    await db.collection("trips").insertOne({ _id: trip, inviteCode: trip.toHexString(), votingEnabled: false, visibility: "public" });
    await db.collection("tripMembers").insertMany([
      { tripId: trip, userId: actor, role: "participant", joinedAt: new Date() },
      { tripId: trip, userId: other, role: "admin", joinedAt: new Date() },
    ]);
    await db.collection("activities").insertOne({ _id: activity, tripId: trip, dayId: new ObjectId(), title: "Paseo", status: "confirmed",
      scheduledAt: new Date(), createdBy: other, createdAt: new Date(), description: null, mapsUrl: null });
    api = createTripApi(db); path = `/trips/${trip}/activities/${activity}/participation`;
  });

  it.each(["admin", "participant"])("lets %s read and replace the own state with a stable identity", async (role) => {
    await db.collection("tripMembers").updateOne({ tripId: trip, userId: actor }, { $set: { role } });
    const empty = await request("GET");
    expect(empty.statusCode).toBe(200); expect(JSON.parse(empty.body)).toEqual({ participation: null });
    let identity: string | undefined;
    for (const status of ["going", "not_going", "pending", "pending"]) {
      const response = await request("PUT", { status });
      expect(response.statusCode).toBe(200);
      const record = JSON.parse(response.body).participation;
      expect(record).toMatchObject({ tripId: trip.toHexString(), activityId: activity.toHexString(), userId: actor.toHexString(), status });
      expect(record.id).toMatch(/^[a-f0-9]{24}$/);
      expect(record.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      identity ??= record.id;
      expect(record.id).toBe(identity);
      const read = await request("GET");
      expect(read.statusCode).toBe(200); expect(JSON.parse(read.body)).toEqual({ participation: record });
    }
    expect(await db.collection("activityParticipations").countDocuments()).toBe(1);
  });
  it("ignores forged identities, references and timestamps and preserves other members' responses", async () => {
    const otherResponse = await request("PUT", { status: "going" }, other);
    expect(otherResponse.statusCode).toBe(200);
    const otherRecord = JSON.parse(otherResponse.body).participation;
    const activityBefore = await db.collection("activities").findOne({ _id: activity });
    const forgedId = new ObjectId().toHexString();
    const response = await request("PUT", { status: "not_going", id: forgedId, tripId: forgedId, activityId: forgedId,
      userId: other.toHexString(), authenticatedUserId: other.toHexString(), updatedAt: "2000-01-01T00:00:00.000Z" });
    expect(response.statusCode).toBe(200);
    const record = JSON.parse(response.body).participation;
    expect(record).toMatchObject({ tripId: trip.toHexString(), activityId: activity.toHexString(), userId: actor.toHexString(), status: "not_going" });
    expect(record.id).not.toBe(forgedId); expect(record.updatedAt).not.toBe("2000-01-01T00:00:00.000Z");
    expect(JSON.parse((await request("GET", undefined, other)).body)).toEqual({ participation: otherRecord });
    expect(await db.collection("activities").findOne({ _id: activity })).toEqual(activityBefore);
    expect(await db.collection("activityParticipations").countDocuments()).toBe(2);
  });
  it.each(["GET", "PUT"])("requires authentication for %s", async (method) => {
    expect((await request(method, { status: "going" }, null)).statusCode).toBe(401);
  });
  it("hides participation from outsiders and expelled members on public Trips", async () => {
    expect((await request("PUT", { status: "going" })).statusCode).toBe(200);
    const before = await db.collection("activityParticipations").find().toArray();
    for (const user of [new ObjectId(), actor]) {
      if (user === actor) await db.collection("tripMembers").deleteOne({ tripId: trip, userId: actor });
      for (const method of ["GET", "PUT"]) expect((await request(method, { status: "pending" }, user)).statusCode).toBe(404);
    }
    expect(await db.collection("activityParticipations").find().toArray()).toEqual(before);
  });
  it("returns 404 for missing Trips and activities or an activity in a different Trip", async () => {
    const foreign = new ObjectId();
    await db.collection("activities").insertOne({ _id: foreign, tripId: new ObjectId() });
    for (const method of ["GET", "PUT"]) {
      for (const url of [`/trips/${new ObjectId()}/activities/${activity}/participation`,
        `/trips/${trip}/activities/${new ObjectId()}/participation`, `/trips/${trip}/activities/${foreign}/participation`]) {
        expect((await request(method, { status: "going" }, actor, url)).statusCode).toBe(404);
      }
    }
    expect(await db.collection("activityParticipations").countDocuments()).toBe(0);
  });
  it("returns 400 for malformed identifiers or bodies without writes", async () => {
    for (const method of ["GET", "PUT"]) {
      for (const url of [`/trips/invalid/activities/${activity}/participation`, `/trips/${trip}/activities/invalid/participation`]) {
        expect((await request(method, { status: "going" }, actor, url)).statusCode).toBe(400);
      }
    }
    for (const body of [undefined, null, [], "invalid", 123]) expect((await request("PUT", body)).statusCode).toBe(400);
    expect((await handleApiRequest({ method: "PUT", url: path, authenticatedUserId: id(actor), body: "{" }, { trips: api })).statusCode).toBe(400);
    expect(await db.collection("activityParticipations").countDocuments()).toBe(0);
  });
  it.each([{}, { status: null }, { status: "confirmed" }, { status: "GOING" }, { status: 1 }, { status: {} }, { status: [] }])(
    "returns field validation for invalid status %s without changing an existing response", async (body) => {
      expect((await request("PUT", { status: "going" })).statusCode).toBe(200);
      const before = await db.collection("activityParticipations").find().toArray();
      const response = await request("PUT", body);
      expect(response.statusCode).toBe(422);
      expect(JSON.parse(response.body)).toMatchObject({ error: { code: "ValidationError", fields: [{ field: "status" }] } });
      expect(await db.collection("activityParticipations").find().toArray()).toEqual(before);
    });
  it("returns 503 if participation services are missing and 500 for a persistence failure", async () => {
    for (const method of ["GET", "PUT"]) {
      const response = await handleApiRequest({ method, url: path, authenticatedUserId: id(actor), body: { status: "going" } });
      expect(response.statusCode).toBe(503);
    }
    const response = await handleApiRequest({ method: "PUT", url: path, authenticatedUserId: id(actor), body: { status: "going" } },
      { trips: { ...api, setActivityParticipation: async () => err(new UnknownError("private driver details")) } });
    expect(response.statusCode).toBe(500); expect(response.body).not.toContain("private driver details");
  });
  it("authenticates both routes through Lambda and derives ownership from the access JWT", async () => {
    const jwtSecret = "participation-test-secret", key = new TextEncoder().encode(jwtSecret);
    const now = Math.floor(Date.now() / 1000);
    const token = (expires: number, tokenType = "access") => new SignJWT({ tokenType }).setSubject(actor.toHexString())
      .setProtectedHeader({ alg: "HS256" }).setExpirationTime(expires).sign(key);
    const handler = createLambdaHandler({ loadRuntimeConfig: async () => ({ environment: "dev", jwtSecret,
      mongo: { uri: server.getUri(), databaseName: db.databaseName }, photoBucketName: "unused" }), createTripApi: async () => api });
    for (const jwt of [undefined, "invalid", await token(now - 60), await token(now + 60, "refresh")]) {
      for (const method of ["GET", "PUT"]) {
        const response = await handler({ rawPath: path, headers: jwt ? { authorization: `Bearer ${jwt}` } : {},
          body: JSON.stringify({ status: "going" }), requestContext: { http: { method } } });
        expect(response.statusCode).toBe(401);
      }
    }
    const headers = { authorization: `Bearer ${await token(now + 60)}` };
    const response = await handler({ rawPath: path, headers, body: JSON.stringify({ status: "pending", userId: other.toHexString() }),
      requestContext: { http: { method: "PUT" } } });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).participation).toMatchObject({ userId: actor.toHexString(), status: "pending" });
    const read = await handler({ rawPath: path, headers, requestContext: { http: { method: "GET" } } });
    expect(read.statusCode).toBe(200); expect(JSON.parse(read.body)).toEqual(JSON.parse(response.body));
  });
});
