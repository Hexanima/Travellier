import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { SignJWT } from "jose";
import { createObjectId, err, UnknownError } from "app-domain";
import { createApp, handleApiRequest, type TripApi } from "../app.js";
import { createLambdaHandler } from "../lambda.js";
import { createJwtMiddleware } from "../auth/jwt-middleware.js";
import { createTripApi } from "./trip-api.js";
import { migrateMongoSchema } from "../adapters/mongodb/migrations.js";

const id = (value: ObjectId) => {
  const parsed = createObjectId(value.toHexString());
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};

describe("vote HTTP API", () => {
  let server: MongoMemoryReplSet, client: MongoClient, db: Db, api: TripApi;
  let trip: ObjectId, activity: ObjectId, actor: ObjectId, other: ObjectId, path: string;
  const request = (method: string, body?: unknown, user: ObjectId | null = actor, url = path) =>
    handleApiRequest({ method, url, ...(user === null ? {} : { authenticatedUserId: id(user) }),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, { trips: api });

  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    client = new MongoClient(server.getUri()); await client.connect();
    db = client.db("vote_http"); await migrateMongoSchema(db);
  }, 120_000);
  afterAll(async () => { await client?.close(); await server?.stop(); });
  beforeEach(async () => {
    for (const name of ["trips", "tripMembers", "activities", "activityVotes", "activityParticipations"]) await db.collection(name).deleteMany({});
    trip = new ObjectId(); activity = new ObjectId(); actor = new ObjectId(); other = new ObjectId();
    await db.collection("trips").insertOne({ _id: trip, inviteCode: trip.toHexString(), votingEnabled: true, visibility: "public" });
    await db.collection("tripMembers").insertMany([
      { tripId: trip, userId: actor, role: "participant", joinedAt: new Date() },
      { tripId: trip, userId: other, role: "admin", joinedAt: new Date() },
    ]);
    await db.collection("activities").insertOne({ _id: activity, tripId: trip, dayId: new ObjectId(), title: "Paseo", status: "proposed",
      scheduledAt: new Date(), createdBy: other, createdAt: new Date(), description: null, mapsUrl: null });
    api = createTripApi(db); path = `/trips/${trip}/activities/${activity}/vote`;
  });

  it.each(["admin", "participant"])("lets %s read and replace the own vote with stable identity and creation time", async (role) => {
    await db.collection("tripMembers").updateOne({ tripId: trip, userId: actor }, { $set: { role } });
    const empty = await request("GET");
    expect(empty.statusCode).toBe(200); expect(JSON.parse(empty.body)).toEqual({ vote: null, activityStatus: "proposed" });
    let identity: string | undefined, creationTime: string | undefined;
    for (const value of ["up", "down", "down", "up"]) {
      const response = await request("PUT", { value });
      expect(response.statusCode).toBe(200);
      const record = JSON.parse(response.body).vote;
      expect(JSON.parse(response.body).activityStatus).toBe("voting");
      expect(record).toMatchObject({ tripId: trip.toHexString(), activityId: activity.toHexString(), userId: actor.toHexString(), value });
      expect(record.id).toMatch(/^[a-f0-9]{24}$/);
      expect(record.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      identity ??= record.id; creationTime ??= record.createdAt;
      expect(record.id).toBe(identity); expect(record.createdAt).toBe(creationTime);
      const read = await request("GET");
      expect(read.statusCode).toBe(200); expect(JSON.parse(read.body)).toEqual(JSON.parse(response.body));
    }
    expect(await db.collection("activityVotes").countDocuments()).toBe(1);
  });
  it("ignores forged identities, references, timestamps and activity status and preserves other votes", async () => {
    const otherResponse = await request("PUT", { value: "up" }, other);
    expect(otherResponse.statusCode).toBe(200);
    const otherRecord = JSON.parse(otherResponse.body).vote;
    const forgedId = new ObjectId().toHexString();
    const response = await request("PUT", { value: "down", id: forgedId, tripId: forgedId, activityId: forgedId,
      userId: other.toHexString(), authenticatedUserId: other.toHexString(), createdAt: "2000-01-01T00:00:00.000Z", status: "confirmed" });
    expect(response.statusCode).toBe(200);
    const record = JSON.parse(response.body).vote;
    expect(record).toMatchObject({ tripId: trip.toHexString(), activityId: activity.toHexString(), userId: actor.toHexString(), value: "down" });
    expect(record.id).not.toBe(forgedId); expect(record.createdAt).not.toBe("2000-01-01T00:00:00.000Z");
    expect(JSON.parse((await request("GET", undefined, other)).body).vote).toEqual(otherRecord);
    expect(await db.collection("activities").findOne({ _id: activity })).toMatchObject({ status: "voting" });
  });
  it("returns 409 for disabled voting without altering stored votes, status or coordination", async () => {
    expect((await request("PUT", { value: "up" })).statusCode).toBe(200);
    await db.collection("trips").updateOne({ _id: trip }, { $set: { votingEnabled: false } });
    const before = await Promise.all(["trips", "activities", "activityVotes"].map((name) => db.collection(name).find().toArray()));
    const response = await request("PUT", { value: "down" });
    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body)).toMatchObject({ error: { code: "ActivityVotingDisabledError" } });
    expect((await request("GET")).statusCode).toBe(200);
    expect(await Promise.all(["trips", "activities", "activityVotes"].map((name) => db.collection(name).find().toArray()))).toEqual(before);
  });
  it("returns 409 for confirmed activities and permits reading their existing votes", async () => {
    await db.collection("activities").updateOne({ _id: activity }, { $set: { status: "confirmed" } });
    const response = await request("PUT", { value: "up" });
    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body)).toMatchObject({ error: { code: "ActivityVotingClosedError" } });
    expect(JSON.parse((await request("GET")).body)).toEqual({ vote: null, activityStatus: "confirmed" });
    expect(await db.collection("activityVotes").countDocuments()).toBe(0);
  });
  it("hides votes from outsiders and expelled members on public Trips", async () => {
    expect((await request("PUT", { value: "up" })).statusCode).toBe(200);
    const before = await db.collection("activityVotes").find().toArray();
    for (const user of [new ObjectId(), actor]) {
      if (user === actor) await db.collection("tripMembers").deleteOne({ tripId: trip, userId: actor });
      for (const method of ["GET", "PUT"]) expect((await request(method, { value: "down" }, user)).statusCode).toBe(404);
    }
    expect(await db.collection("activityVotes").find().toArray()).toEqual(before);
  });
  it("returns 404 for missing Trips and activities or an activity in a different Trip", async () => {
    const foreign = new ObjectId();
    await db.collection("activities").insertOne({ _id: foreign, tripId: new ObjectId() });
    for (const method of ["GET", "PUT"]) {
      for (const url of [`/trips/${new ObjectId()}/activities/${activity}/vote`,
        `/trips/${trip}/activities/${new ObjectId()}/vote`, `/trips/${trip}/activities/${foreign}/vote`]) {
        const response = await request(method, { value: "up" }, actor, url);
        expect(response.statusCode).toBe(404);
        expect(JSON.parse(response.body)).toMatchObject({ error: { code: url.startsWith(`/trips/${trip}/`)
          ? "ActivityNotFoundError" : "TripNotFoundError" } });
      }
    }
    expect(await db.collection("activityVotes").countDocuments()).toBe(0);
  });
  it("returns 400 for malformed identifiers or bodies without writes", async () => {
    for (const method of ["GET", "PUT"]) {
      for (const url of [`/trips/invalid/activities/${activity}/vote`, `/trips/${trip}/activities/invalid/vote`]) {
        expect((await request(method, { value: "up" }, actor, url)).statusCode).toBe(400);
      }
    }
    for (const body of [undefined, null, [], "invalid", 123]) expect((await request("PUT", body)).statusCode).toBe(400);
    expect((await handleApiRequest({ method: "PUT", url: path, authenticatedUserId: id(actor), body: "{" }, { trips: api })).statusCode).toBe(400);
    expect(await db.collection("activityVotes").countDocuments()).toBe(0);
  });
  it.each([{}, { value: null }, { value: "going" }, { value: "UP" }, { value: 1 }, { value: {} }, { value: [] }])(
    "returns field validation for invalid value %s without changing an existing vote", async (body) => {
      expect((await request("PUT", { value: "up" })).statusCode).toBe(200);
      const before = await db.collection("activityVotes").find().toArray();
      const response = await request("PUT", body);
      expect(response.statusCode).toBe(422);
      expect(JSON.parse(response.body)).toMatchObject({ error: { code: "ValidationError", fields: [{ field: "value" }] } });
      expect(await db.collection("activityVotes").find().toArray()).toEqual(before);
    });
  it("returns 503 if vote services are missing and 500 for a persistence failure", async () => {
    for (const method of ["GET", "PUT"]) {
      const response = await handleApiRequest({ method, url: path, authenticatedUserId: id(actor), body: { value: "up" } });
      expect(response.statusCode).toBe(503);
    }
    const response = await handleApiRequest({ method: "PUT", url: path, authenticatedUserId: id(actor), body: { value: "up" } },
      { trips: { ...api, setActivityVote: async () => err(new UnknownError("private driver details")) } });
    expect(response.statusCode).toBe(500); expect(response.body).not.toContain("private driver details");
  });
  it("authenticates both routes through Lambda and derives ownership from the access JWT", async () => {
    const jwtSecret = "vote-test-secret", key = new TextEncoder().encode(jwtSecret);
    const now = Math.floor(Date.now() / 1000);
    const token = (expires: number, tokenType = "access") => new SignJWT({ tokenType }).setSubject(actor.toHexString())
      .setProtectedHeader({ alg: "HS256" }).setExpirationTime(expires).sign(key);
    const handler = createLambdaHandler({ loadRuntimeConfig: async () => ({ environment: "dev", jwtSecret,
      mongo: { uri: server.getUri(), databaseName: db.databaseName }, photoBucketName: "unused" }), createTripApi: async () => api });
    for (const jwt of [undefined, "invalid", await token(now - 60), await token(now + 60, "refresh")]) {
      for (const method of ["GET", "PUT"]) {
        const response = await handler({ rawPath: path, headers: jwt ? { authorization: `Bearer ${jwt}` } : {},
          body: JSON.stringify({ value: "up" }), requestContext: { http: { method } } });
        expect(response.statusCode).toBe(401);
      }
    }
    expect(await db.collection("activityVotes").countDocuments()).toBe(0);
    const headers = { authorization: `Bearer ${await token(now + 60)}` };
    const response = await handler({ rawPath: path, headers, body: JSON.stringify({ value: "down", userId: other.toHexString() }),
      requestContext: { http: { method: "PUT" } } });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ vote: { userId: actor.toHexString(), value: "down" }, activityStatus: "voting" });
    const read = await handler({ rawPath: path, headers, requestContext: { http: { method: "GET" } } });
    expect(read.statusCode).toBe(200); expect(JSON.parse(read.body)).toEqual(JSON.parse(response.body));
  });
  it("serves authenticated vote routes through the local HTTP server", async () => {
    const jwtSecret = "local-vote-secret";
    const token = await new SignJWT({ tokenType: "access" }).setSubject(actor.toHexString()).setProtectedHeader({ alg: "HS256" })
      .setExpirationTime(Math.floor(Date.now() / 1000) + 60).sign(new TextEncoder().encode(jwtSecret));
    const http = createApp({ trips: api }, createJwtMiddleware({ jwtSecret }));
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}${path}`;
    try {
      expect((await fetch(url)).status).toBe(401);
      const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
      const write = await fetch(url, { method: "PUT", headers, body: JSON.stringify({ value: "up" }) });
      expect(write.status).toBe(200);
      const record = await write.json();
      const read = await fetch(url, { headers });
      expect(read.status).toBe(200); expect(await read.json()).toEqual(record);
    } finally { await new Promise<void>((resolve, reject) => http.close((error) => error ? reject(error) : resolve())); }
  });
});
