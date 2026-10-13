import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { SignJWT } from "jose";
import { createObjectId, ok } from "app-domain";
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

describe("retired vote HTTP API", () => {
  let server: MongoMemoryReplSet, client: MongoClient, db: Db;
  let trip: ObjectId, activity: ObjectId, actor: ObjectId, path: string;
  const legacyRead = vi.fn(async () => ok({ vote: null, activityStatus: "proposed" }));
  const legacyWrite = vi.fn(async () => ok({ vote: null, activityStatus: "voting" }));
  // Even injecting former services must not reactivate the removed routes.
  const injectedApi = () => ({ ...createTripApi(db), getActivityVote: legacyRead, setActivityVote: legacyWrite } as unknown as TripApi);
  const snapshot = () => Promise.all(["trips", "activities", "activityVotes", "activityParticipations"].map((name) => db.collection(name).find().toArray()));
  const jwtSecret = "retired-vote-test-secret";
  const token = () => new SignJWT({ tokenType: "access" }).setSubject(actor.toHexString()).setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(Math.floor(Date.now() / 1000) + 60).sign(new TextEncoder().encode(jwtSecret));
  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    client = new MongoClient(server.getUri()); await client.connect();
    db = client.db("retired_vote_http"); await migrateMongoSchema(db);
  }, 120_000);
  afterAll(async () => { await client?.close(); await server?.stop(); });
  beforeEach(async () => {
    vi.clearAllMocks();
    for (const name of ["trips", "tripMembers", "activities", "activityVotes", "activityParticipations"]) await db.collection(name).deleteMany({});
    trip = new ObjectId(); activity = new ObjectId(); actor = new ObjectId();
    await db.collection("trips").insertOne({ _id: trip, inviteCode: trip.toHexString(), votingEnabled: true, visibility: "public" });
    await db.collection("tripMembers").insertOne({ tripId: trip, userId: actor, role: "participant" });
    await db.collection("activities").insertOne({ _id: activity, tripId: trip, status: "proposed" });
    await db.collection("activityVotes").insertOne({ tripId: trip, activityId: activity, userId: actor, value: "up", createdAt: new Date() });
    path = "/trips/" + trip + "/activities/" + activity + "/vote";
  });
  it("does not expose vote services from the composed API", () => {
    const api = createTripApi(db);
    expect(api).not.toHaveProperty("getActivityVote");
    expect(api).not.toHaveProperty("setActivityVote");
  });
  it.each(["GET", "PUT"])("returns 404 for authenticated %s without calling services or changing historical records", async (method) => {
    const before = await snapshot();
    const response = await handleApiRequest({ method, url: path, authenticatedUserId: id(actor), body: JSON.stringify({ value: "down" }) }, { trips: injectedApi() });
    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body)).toEqual({ error: "NotFound" });
    expect(legacyRead).not.toHaveBeenCalled(); expect(legacyWrite).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(before);
  });
  it("returns 404 through authenticated Lambda and preserves historical records", async () => {
    const before = await snapshot();
    const handler = createLambdaHandler({ loadRuntimeConfig: async () => ({ environment: "dev", jwtSecret,
      mongo: { uri: server.getUri(), databaseName: db.databaseName }, photoBucketName: "unused" }), createTripApi: async () => injectedApi() });
    for (const method of ["GET", "PUT"]) {
      const response = await handler({ rawPath: path, headers: { authorization: "Bearer " + await token() },
        body: JSON.stringify({ value: "down" }), requestContext: { http: { method } } });
      expect(response.statusCode).toBe(404);
    }
    expect(legacyRead).not.toHaveBeenCalled(); expect(legacyWrite).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(before);
  });
  it("returns 404 through the local HTTP server and preserves historical records", async () => {
    const before = await snapshot();
    const http = createApp({ trips: injectedApi() }, createJwtMiddleware({ jwtSecret }));
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    const url = "http://127.0.0.1:" + (http.address() as AddressInfo).port + path;
    try {
      const headers = { authorization: "Bearer " + await token(), "content-type": "application/json" };
      for (const method of ["GET", "PUT"]) {
        const response = await fetch(url, { method, headers, ...(method === "PUT" ? { body: JSON.stringify({ value: "down" }) } : {}) });
        expect(response.status).toBe(404);
      }
      expect(legacyRead).not.toHaveBeenCalled(); expect(legacyWrite).not.toHaveBeenCalled();
      expect(await snapshot()).toEqual(before);
    } finally { await new Promise<void>((resolve, reject) => http.close((error) => error ? reject(error) : resolve())); }
  });
});
