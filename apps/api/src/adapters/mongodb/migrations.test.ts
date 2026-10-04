import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { MongoClient, type Db, type IndexDescription } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";

import {
  MONGO_MIGRATION_ID,
  JOURNEY_MIGRATION_ID,
  ITINERARY_MIGRATION_ID,
  migrateMongoSchema,
} from "./migrations.js";

const prdCollections = [
  "users",
  "refreshTokens",
  "trips",
  "tripMembers",
  "destinations",
  "transports",
  "itineraryDays",
  "activities",
  "activityParticipations",
  "activityVotes",
  "posts",
  "postPhotos",
  "postExpenses",
  "postLikes",
  "comments",
  "commentLikes",
] as const;

const expectedIndexes: Record<string, IndexDescription[]> = {
  users: [{ key: { email: 1 }, name: "email_unique", unique: true }],
  refreshTokens: [
    { key: { token: 1 }, name: "token" },
    { key: { userId: 1 }, name: "userId" },
    {
      key: { expiresAt: 1 },
      name: "expiresAt_ttl",
      expireAfterSeconds: 0,
    },
  ],
  trips: [
    { key: { inviteCode: 1 }, name: "inviteCode_unique", unique: true },
    { key: { visibility: 1 }, name: "visibility" },
  ],
  tripMembers: [
    {
      key: { tripId: 1, userId: 1 },
      name: "tripId_userId_unique",
      unique: true,
    },
    { key: { userId: 1 }, name: "userId" },
  ],
  destinations: [{ key: { tripId: 1, order: 1 }, name: "tripId_order" }],
  transports: [
    { key: { tripId: 1 }, name: "tripId" },
    { key: { destinationId: 1 }, name: "destinationId" },
  ],
  itineraryDays: [{ key: { tripId: 1, order: 1 }, name: "tripId_order" }],
  activities: [
    { key: { tripId: 1 }, name: "tripId" },
    { key: { dayId: 1 }, name: "dayId" },
  ],
  activityParticipations: [
    {
      key: { activityId: 1, userId: 1 },
      name: "activityId_userId_unique",
      unique: true,
    },
  ],
  activityVotes: [
    {
      key: { activityId: 1, userId: 1 },
      name: "activityId_userId_unique",
      unique: true,
    },
  ],
  posts: [
    { key: { tripId: 1 }, name: "tripId" },
    { key: { dayId: 1 }, name: "dayId" },
    { key: { activityId: 1 }, name: "activityId" },
    { key: { parentPostId: 1 }, name: "parentPostId" },
    { key: { transportId: 1 }, name: "transportId" },
  ],
  postPhotos: [{ key: { postId: 1 }, name: "postId" }],
  postExpenses: [
    { key: { postId: 1 }, name: "postId_unique", unique: true },
  ],
  postLikes: [
    {
      key: { postId: 1, userId: 1 },
      name: "postId_userId_unique",
      unique: true,
    },
  ],
  comments: [{ key: { postId: 1, createdAt: 1 }, name: "postId_createdAt" }],
  commentLikes: [
    {
      key: { commentId: 1, userId: 1 },
      name: "commentId_userId_unique",
      unique: true,
    },
  ],
};

let server: MongoMemoryServer;
let client: MongoClient | undefined;
let database: Db;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  database = client.db("travellier_test");
}, 120_000);

afterEach(async () => {
  await database.dropDatabase();
});

afterAll(async () => {
  await client?.close();
  await server?.stop();
});

describe("MongoDB schema migration", () => {
  it("creates every PRD collection and records its version", async () => {
    await migrateMongoSchema(database);

    const collections = await database
      .listCollections({}, { nameOnly: true })
      .toArray();

    expect(collections.map(({ name }) => name).sort()).toEqual(
      [...prdCollections, "_migrations"].sort(),
    );
    expect((await database.collection("_migrations").find().toArray()).map(({ id }) => id).sort()).toEqual(
      [MONGO_MIGRATION_ID, JOURNEY_MIGRATION_ID, ITINERARY_MIGRATION_ID].sort(),
    );
  });

  it("applies every PRD index, including refresh-token TTL", async () => {
    await migrateMongoSchema(database);

    for (const [collectionName, expected] of Object.entries(expectedIndexes)) {
      const indexes = await database.collection(collectionName).listIndexes().toArray();

      for (const index of expected) {
        expect(indexes).toContainEqual(expect.objectContaining(index));
      }
    }
  });

  it("enforces each PRD unique index", async () => {
    await migrateMongoSchema(database);

    for (const [collectionName, indexes] of Object.entries(expectedIndexes)) {
      for (const index of indexes.filter(({ unique }) => unique)) {
        const document = Object.fromEntries(
          Object.keys(index.key).map((field) => [field, `${collectionName}-${field}`]),
        );
        const collection = database.collection(collectionName);

        await collection.insertOne(document);
        await expect(collection.insertOne(document)).rejects.toMatchObject({
          code: 11000,
        });
      }
    }
  });

  it("is idempotent after its version was applied", async () => {
    await migrateMongoSchema(database);
    await migrateMongoSchema(database);

    expect(
      await database.collection("_migrations").countDocuments({
        id: MONGO_MIGRATION_ID,
      }),
    ).toBe(1);
    expect(await database.collection("_migrations").countDocuments({ id: JOURNEY_MIGRATION_ID })).toBe(1);
    expect(await database.collection("_migrations").countDocuments({ id: ITINERARY_MIGRATION_ID })).toBe(1);
  });

  it("enforces itinerary identity while allowing different types and destinations on one date", async () => {
    await migrateMongoSchema(database);
    const collection = database.collection("itineraryDays");
    const day = { tripId: "trip", destinationId: "destination", date: new Date("2026-09-25T00:00:00Z"), type: "activity", order: 1 };
    await collection.insertOne({ ...day });
    await expect(collection.insertOne({ ...day, order: 2 })).rejects.toMatchObject({ code: 11000 });
    await collection.insertOne({ ...day, type: "transit_out", order: 2 });
    await collection.insertOne({ ...day, destinationId: "other", order: 3 });
    expect(await collection.countDocuments({})).toBe(3);
  });

  it("refuses historical duplicate itinerary identities without deleting their references", async () => {
    await migrateMongoSchema(database);
    const collection = database.collection("itineraryDays");
    const indexes = await collection.listIndexes().toArray();
    for (const index of indexes.filter((index) => index.unique && index.name !== "_id_")) await collection.dropIndex(index.name!);
    await database.collection("_migrations").deleteOne({ id: "0003-unique-itinerary-identity" });
    const day = { tripId: "trip", destinationId: "destination", date: new Date("2026-09-25T00:00:00Z"), type: "activity" };
    const inserted = await collection.insertMany([{ ...day }, { ...day }]);
    await database.collection("posts").insertOne({ dayId: inserted.insertedIds[0] });
    await expect(migrateMongoSchema(database)).rejects.toThrow("Duplicate itinerary identities");
    expect(await collection.countDocuments({})).toBe(2);
    expect(await database.collection("posts").countDocuments({})).toBe(1);
    expect(await database.collection("_migrations").countDocuments({ id: "0003-unique-itinerary-identity" })).toBe(0);
  });

  it("enforces unique destination positions per Trip and transport directions per destination", async () => {
    await migrateMongoSchema(database);
    const destinations = database.collection("destinations");
    await destinations.insertOne({ tripId: "trip-a", order: 1 });
    await expect(destinations.insertOne({ tripId: "trip-a", order: 1 })).rejects.toMatchObject({ code: 11000 });
    await destinations.insertOne({ tripId: "trip-b", order: 1 });
    const transports = database.collection("transports");
    await transports.insertOne({ destinationId: "destination-a", direction: "outbound" });
    await expect(transports.insertOne({ destinationId: "destination-a", direction: "outbound" })).rejects.toMatchObject({ code: 11000 });
    await transports.insertOne({ destinationId: "destination-a", direction: "return" });
  });

  it("does not replace the old destination index when existing positions collide", async () => {
    await migrateMongoSchema(database);
    await database.collection("_migrations").deleteOne({ id: JOURNEY_MIGRATION_ID });
    await database.collection("destinations").dropIndex("tripId_order");
    await database.collection("destinations").createIndex({ tripId: 1, order: 1 }, { name: "tripId_order" });
    await database.collection("destinations").insertMany([{ tripId: "trip-a", order: 1 }, { tripId: "trip-a", order: 1 }]);
    await expect(migrateMongoSchema(database)).rejects.toThrow("Duplicate destination positions");
    expect((await database.collection("destinations").listIndexes().toArray()).find((index) => index.name === "tripId_order")?.unique).not.toBe(true);
  });
});
